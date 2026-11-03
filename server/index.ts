import { existsSync } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import type { WebSocket } from "ws";
import { checkConfig, config } from "./config.ts";
import { Hub, type HubEvent } from "./hub.ts";
import { LoginGuard, Sessions } from "./auth.ts";
import { MUTATING, can, filterLive, permissionFor, sees, summarize, type Args, type PanelUser } from "./perms.ts";

const problems = checkConfig();
if (problems.length) {
  for (const p of problems) console.error(`config: ${p}`);
  process.exit(1);
}

const COOKIE = "fxl_sid";
const hub = new Hub(config.dataDir);
const sessions = new Sessions(config.sessionHours);
const guard = new LoginGuard();

const app = Fastify({ logger: { level: "info" }, trustProxy: config.trustProxy, bodyLimit: 256 * 1024 });
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
await app.register(websocket, { options: { maxPayload: 16 * 1024 * 1024 } });

app.addHook("onSend", async (_req, reply, payload) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  reply.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (config.cookieSecure) reply.header("Strict-Transport-Security", "max-age=31536000");
  return payload;
});

app.addHook("onRequest", async (req, reply) => {
  if (req.method !== "GET" && req.url.startsWith("/api/") && req.headers["x-fxl"] !== "1") {
    return reply.code(403).send({ error: { key: "errors.webForbidden", params: {} } });
  }
});

function currentUser(req: FastifyRequest): PanelUser | undefined {
  const userId = sessions.touch(req.cookies[COOKIE]);
  return hub.user(userId);
}

function requireUser(req: FastifyRequest, reply: FastifyReply): PanelUser | undefined {
  const user = currentUser(req);
  if (!user) {
    reply.code(401).send({ error: { key: "errors.webUnauthorized", params: {} } });
    return undefined;
  }
  return user;
}

function publicUser(u: PanelUser) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, permissions: u.permissions, servers: u.servers };
}

function visibleServers(u: PanelUser) {
  return can(u, "servers.view") ? hub.servers.filter((s) => sees(u, String(s.id))) : [];
}

app.post(
  "/api/login",
  { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const keys = [`ip:${req.ip}`, `user:${username}`];
    if (keys.some((k) => guard.locked(k))) {
      return reply.code(429).send({ error: { key: "errors.webLocked", params: {} } });
    }
    if (!hub.online) {
      return reply.code(503).send({ error: { key: "errors.webLauncherOffline", params: {} } });
    }
    let user: PanelUser | undefined;
    try {
      const res = (await hub.request("", "login", { username, password })) as { user: PanelUser };
      hub.remember(res.user);
      user = hub.user(res.user.id);
    } catch (error) {
      const key = (error as { key?: string }).key;
      if (key !== "errors.webBadLogin") return reply.code(503).send({ error: { key: key ?? "errors.generic", params: {} } });
    }
    if (!user) {
      keys.forEach((k) => guard.fail(k));
      hub.audit({ user: username || "?", action: "login", summary: "failed", ok: false, ip: req.ip });
      return reply.code(401).send({ error: { key: "errors.webBadLogin", params: {} } });
    }
    keys.forEach((k) => guard.clear(k));
    const sid = sessions.create(user.id);
    reply.setCookie(COOKIE, sid, { httpOnly: true, secure: config.cookieSecure, sameSite: "strict", path: "/", maxAge: sessions.ttlSeconds });
    hub.audit({ user: user.username, action: "login", summary: "", ok: true, ip: req.ip });
    return { user: publicUser(user), online: hub.online };
  },
);

app.post("/api/logout", async (req, reply) => {
  sessions.destroy(req.cookies[COOKIE]);
  reply.clearCookie(COOKIE, { path: "/" });
  return { ok: true };
});

app.get("/api/me", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return;
  return { user: publicUser(user), online: hub.online, version: hub.version, project: hub.project, servers: visibleServers(user) };
});

app.get("/api/locales", async (req, reply) => {
  if (!requireUser(req, reply)) return;
  return hub.locales ?? {};
});

app.get("/api/audit", async (req, reply) => {
  const user = requireUser(req, reply);
  if (!user) return;
  if (!can(user, "audit.view")) return reply.code(403).send({ error: { key: "errors.webForbidden", params: {} } });
  const limit = Math.min(1000, Math.max(1, Number((req.query as { limit?: string }).limit ?? 300)));
  return hub.readAudit(limit);
});

app.post(
  "/api/action",
  { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    const body = (req.body ?? {}) as { action?: unknown; args?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const args = (body.args && typeof body.args === "object" ? body.args : {}) as Args;
    const rule = permissionFor(action, args);
    const server = typeof args.server === "string" ? args.server : "";
    const name = hub.servers.find((s) => s.id === server)?.name;
    if (!rule || !can(user, rule.perm) || (rule.scoped && (!server || !sees(user, server)))) {
      if (!rule || MUTATING.has(action)) {
        hub.audit({ user: user.username, action: action || "?", server: name ? String(name) : server, summary: summarize(action, args), ok: false, error: "errors.webForbidden", ip: req.ip });
      }
      return reply.code(403).send({ error: { key: "errors.webForbidden", params: {} } });
    }
    try {
      const data = await hub.request(user.id, action, args);
      if (MUTATING.has(action)) hub.audit({ user: user.username, action, server: name ? String(name) : server, summary: summarize(action, args), ok: true, ip: req.ip });
      return { data };
    } catch (error) {
      const err = error as { key?: string; params?: Record<string, string> };
      if (MUTATING.has(action)) hub.audit({ user: user.username, action, server: name ? String(name) : server, summary: summarize(action, args), ok: false, error: err.key, ip: req.ip });
      return reply.code(400).send({ error: { key: err.key ?? "errors.generic", params: err.params ?? {} } });
    }
  },
);

interface Client {
  socket: WebSocket;
  sid: string;
  userId: string;
  subs: Set<string>;
}

const clients = new Set<Client>();

function send(c: Client, data: unknown) {
  if (c.socket.readyState === 1) c.socket.send(JSON.stringify(data));
}

function deliver(c: Client, e: HubEvent) {
  const user = hub.user(c.userId);
  if (!user) {
    c.socket.close(4001, "signed out");
    return;
  }
  switch (e.t) {
    case "agent":
      send(c, { t: "agent", online: e.online });
      break;
    case "locales":
      send(c, { t: "locales" });
      break;
    case "users":
      send(c, { t: "me", user: publicUser(user) });
      send(c, { t: "state", project: hub.project, servers: visibleServers(user) });
      break;
    case "state":
      send(c, { t: "state", project: hub.project, servers: visibleServers(user) });
      break;
    case "status": {
      const view = e.view as { id: string };
      if (can(user, "servers.view") && sees(user, view.id)) send(c, { t: "status", view });
      break;
    }
    case "logs": {
      if (!can(user, "console.read")) break;
      const batches = (e.batches as { id: string }[]).filter((b) => c.subs.has(b.id) && sees(user, b.id));
      if (batches.length) send(c, { t: "logs", batches });
      break;
    }
    case "live": {
      const id = String(e.id);
      if (sees(user, id)) send(c, { t: "live", id, live: filterLive(user, e.live as Record<string, unknown>) });
      break;
    }
  }
}

hub.on((e) => {
  if (e.t === "users") sessions.prune((id) => !!hub.user(id));
  for (const c of clients) deliver(c, e);
});

app.get("/ws", { websocket: true }, (raw, req) => {
  const socket = raw as unknown as WebSocket;
  const sid = req.cookies[COOKIE] ?? "";
  const userId = sessions.touch(sid);
  const user = hub.user(userId);
  if (!user || !userId) {
    socket.close(4001, "signed out");
    return;
  }
  const client: Client = { socket, sid, userId, subs: new Set() };
  clients.add(client);
  send(client, { t: "agent", online: hub.online });
  send(client, { t: "state", project: hub.project, servers: visibleServers(user) });
  for (const [id, view] of hub.status) if (can(user, "servers.view") && sees(user, id)) send(client, { t: "status", view });
  socket.on("message", (msg) => {
    let p: { t?: string; server?: string };
    try {
      p = JSON.parse(String(msg));
    } catch {
      return;
    }
    const current = hub.user(sessions.touch(client.sid));
    if (!current || typeof p.server !== "string") return;
    if (p.t === "sub" && sees(current, p.server)) {
      client.subs.add(p.server);
      const live = hub.live.get(p.server);
      if (live) send(client, { t: "live", id: p.server, live: filterLive(current, live) });
    } else if (p.t === "unsub") {
      client.subs.delete(p.server);
    }
  });
  socket.on("close", () => clients.delete(client));
});

setInterval(() => {
  for (const c of clients) {
    if (!hub.user(sessions.touch(c.sid))) c.socket.close(4001, "signed out");
  }
}, 60_000).unref();

if (existsSync(config.distDir)) {
  await app.register(fstatic, { root: config.distDir });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    const isPage = !path.startsWith("/api/") && !path.startsWith("/assets/") && !path.startsWith("/ws") &&!/\.[a-z0-9]+$/i.test(path);
    if (req.method === "GET" && isPage) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: { key: "errors.generic", params: { detail: "not found" } } });
  });
} else {
  app.log.warn("dist/ is missing – run `npm run build` to serve the web UI");
}

await app.listen({ host: config.host, port: config.port });
hub.connect(config.launcherUrl!, config.launcherToken, { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) });
