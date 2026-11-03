import { existsSync } from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import type { WebSocket } from "ws";
import { checkConfig, config } from "./config.ts";
import { Hub, type HubEvent } from "./hub.ts";
import { LoginGuard, Sessions, TrustedLogins, type Session } from "./auth.ts";
import { MAX_COMMAND, MUTATING, can, filterLive, permissionFor, sees, summarize, type Args, type PanelUser } from "./perms.ts";

const problems = checkConfig();
if (problems.length) {
  for (const p of problems) console.error(`config: ${p}`);
  process.exit(1);
}

const COOKIE = "fxl_sid";
const LOGIN_CONCURRENCY = 4;
const SOFT_BUFFER = 1024 * 1024;
const HARD_BUFFER = 8 * 1024 * 1024;
const MAX_SUBS = 64;
const hub = new Hub(config.dataDir);
const sessions = new Sessions(config.sessionHours);
const guard = new LoginGuard();
const trusted = new TrustedLogins();
const loginIps = new Set<string>();
let loginsInFlight = 0;

const app = Fastify({ logger: { level: "info" }, trustProxy: config.trustProxy, bodyLimit: 256 * 1024 });
await app.register(cookie);
await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
await app.register(websocket, { options: { maxPayload: 4096 } });

type Problem = { key: string; params: Record<string, string> };
const fail = (reply: FastifyReply, code: number, key: string, params: Record<string, string> = {}) => reply.code(code).send({ error: { key, params } satisfies Problem });

app.setErrorHandler((err: { statusCode?: number; message?: string }, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) req.log.error(err);
  if (status === 429) return fail(reply, 429, "errors.webRateLimited");
  return fail(reply, status, "errors.generic", { detail: status >= 500 ? "internal error" : String(err.message ?? "") });
});

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

function originAllowed(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const expected = config.publicOrigin ?? `${req.protocol}://${req.host}`;
  return origin === expected;
}

app.addHook("onRequest", async (req, reply) => {
  const isWs = req.url === "/ws" || req.url.startsWith("/ws?");
  const mutating = req.method !== "GET" && req.url.startsWith("/api/");
  if (mutating && req.headers["x-fxl"] !== "1") return fail(reply, 403, "errors.webForbidden");
  if ((mutating || isWs) && !originAllowed(req)) return fail(reply, 403, "errors.webForbidden");
});

function setSessionCookie(reply: FastifyReply, sid: string) {
  reply.setCookie(COOKIE, sid, { httpOnly: true, secure: config.cookieSecure, sameSite: "strict", path: "/", maxAge: sessions.ttlSeconds });
}

function sessionUser(s: Session | null): PanelUser | undefined {
  if (!s) return undefined;
  const user = hub.user(s.userId);
  return user && user.epoch === s.epoch ? user : undefined;
}

function requireUser(req: FastifyRequest, reply: FastifyReply): { user: PanelUser; session: Session; sid: string } | undefined {
  const sid = req.cookies[COOKIE] ?? "";
  const session = sessions.touch(sid);
  const user = sessionUser(session);
  if (!session || !user) {
    if (session) sessions.destroy(sid);
    fail(reply, 401, "errors.webUnauthorized");
    return undefined;
  }
  setSessionCookie(reply, sid);
  return { user, session, sid };
}

function publicUser(u: PanelUser) {
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, permissions: u.permissions, allServers: u.allServers, servers: u.servers };
}

function visibleServers(u: PanelUser) {
  return can(u, "servers.view") ? hub.servers.filter((s) => sees(u, String(s.id))) : [];
}

function closeSession(sid: string) {
  for (const c of clients) if (c.sid === sid) c.socket.close(4001, "signed out");
}

app.post(
  "/api/login",
  { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const hardKeys = [`ip:${req.ip}`, `pair:${req.ip}|${username}`];
    const userKey = `user:${username}`;
    if (hardKeys.some((k) => guard.locked(k))) return fail(reply, 429, "errors.webLocked");
    if (!hub.online) return fail(reply, 503, "errors.webLauncherOffline");
    const wait = trusted.has(username, req.ip) ? 0 : guard.delayMs(userKey);
    if (wait) {
      const seconds = Math.ceil(wait / 1000);
      reply.header("Retry-After", String(seconds));
      return fail(reply, 429, "errors.webRetryLater", { seconds: String(seconds) });
    }
    if (loginsInFlight >= LOGIN_CONCURRENCY || loginIps.has(req.ip)) {
      guard.fail(hardKeys[0]);
      return fail(reply, 503, "errors.webBusy");
    }
    loginsInFlight++;
    loginIps.add(req.ip);
    let user: PanelUser | undefined;
    let ticket = "";
    try {
      const res = (await hub.request("", "login", { username, password })) as { user: PanelUser; ticket: string };
      hub.remember(res.user);
      user = hub.user(res.user.id);
      ticket = typeof res.ticket === "string" ? res.ticket : "";
    } catch (error) {
      const key = (error as { key?: string }).key;
      if (key !== "errors.webBadLogin") return fail(reply, 503, key ?? "errors.generic");
    } finally {
      loginsInFlight--;
      loginIps.delete(req.ip);
    }
    if (!user || !ticket) {
      [...hardKeys, userKey].forEach((k) => guard.fail(k));
      hub.audit({ user: username || "?", action: "login", summary: "failed", ok: false, ip: req.ip });
      return fail(reply, 401, "errors.webBadLogin");
    }
    [...hardKeys, userKey].forEach((k) => guard.clear(k));
    trusted.add(username, req.ip);
    const sid = sessions.create(user.id, ticket, user.epoch);
    setSessionCookie(reply, sid);
    hub.audit({ user: user.username, action: "login", summary: "", ok: true, ip: req.ip });
    return { user: publicUser(user), online: hub.online };
  },
);

app.post("/api/logout", async (req, reply) => {
  const sid = req.cookies[COOKIE] ?? "";
  const session = sessions.destroy(sid);
  if (session) {
    closeSession(sid);
    hub.request(session.ticket, "logout", {}).catch(() => {});
  }
  reply.clearCookie(COOKIE, { path: "/" });
  return { ok: true };
});

app.get("/api/me", async (req, reply) => {
  const auth = requireUser(req, reply);
  if (!auth) return;
  return { user: publicUser(auth.user), online: hub.online, version: hub.version, project: hub.project, servers: visibleServers(auth.user) };
});

app.get("/api/locales", async (req, reply) => {
  if (!requireUser(req, reply)) return;
  return hub.locales ?? {};
});

app.get("/api/audit", async (req, reply) => {
  const auth = requireUser(req, reply);
  if (!auth) return;
  if (!can(auth.user, "audit.view")) return fail(reply, 403, "errors.webForbidden");
  const n = Number.parseInt(String((req.query as { limit?: string }).limit ?? "300"), 10);
  const limit = Number.isFinite(n) ? Math.min(1000, Math.max(1, n)) : 300;
  return hub.readAudit(limit);
});

app.post(
  "/api/action",
  { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } },
  async (req, reply) => {
    const auth = requireUser(req, reply);
    if (!auth) return;
    const { user, session, sid } = auth;
    const body = (req.body ?? {}) as { action?: unknown; args?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const args = (body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {}) as Args;
    const rule = permissionFor(action, args);
    const server = typeof args.server === "string" ? args.server : "";
    const name = hub.servers.find((s) => s.id === server)?.name;
    const audit = (ok: boolean, error?: string) =>
      hub.audit({ user: user.username, action: action || "?", server: name ? String(name) : server, summary: summarize(action, args), ok, error, ip: req.ip });
    if (!rule || !can(user, rule.perm) || (rule.scoped && !sees(user, server))) {
      if (!rule || MUTATING.has(action)) audit(false, "errors.webForbidden");
      return fail(reply, 403, "errors.webForbidden");
    }
    if (action === "send_console_command" && (typeof args.command !== "string" || args.command.length > MAX_COMMAND)) {
      audit(false, "errors.webCommandTooLong");
      return fail(reply, 400, "errors.webCommandTooLong", { max: String(MAX_COMMAND) });
    }
    try {
      const data = await hub.request(session.ticket, action, args);
      if (MUTATING.has(action)) audit(true);
      if (action === "send_console_command" && !can(user, "console.read") && data && typeof data === "object") delete (data as Record<string, unknown>).output;
      return { data };
    } catch (error) {
      const err = error as { key?: string; params?: Record<string, string> };
      if (MUTATING.has(action)) audit(false, err.key);
      if (err.key === "errors.webUnauthorized") {
        sessions.destroy(sid);
        closeSession(sid);
        reply.clearCookie(COOKIE, { path: "/" });
        return fail(reply, 401, "errors.webUnauthorized");
      }
      return fail(reply, 400, err.key ?? "errors.generic", err.params ?? {});
    }
  },
);

interface Client {
  socket: WebSocket;
  sid: string;
  userId: string;
  subs: Set<string>;
  alive: boolean;
}

const clients = new Set<Client>();

function send(c: Client, data: { t: string }) {
  if (c.socket.readyState !== 1) return;
  const buffered = c.socket.bufferedAmount;
  if (buffered > HARD_BUFFER) {
    c.socket.terminate();
    clients.delete(c);
    return;
  }
  if (buffered > SOFT_BUFFER && (data.t === "logs" || data.t === "live")) return;
  c.socket.send(JSON.stringify(data));
}

function clientUser(c: Client): PanelUser | undefined {
  const user = sessionUser(sessions.peek(c.sid));
  return user && user.id === c.userId ? user : undefined;
}

function deliver(c: Client, e: HubEvent) {
  const user = clientUser(c);
  if (!user) {
    c.socket.close(4001, "signed out");
    return;
  }
  switch (e.t) {
    case "agent":
      send(c, { t: "agent", online: e.online } as { t: string });
      break;
    case "locales":
      send(c, { t: "locales" });
      break;
    case "users":
      send(c, { t: "me", user: publicUser(user) } as { t: string });
      send(c, { t: "state", project: hub.project, servers: visibleServers(user) } as { t: string });
      break;
    case "state":
      send(c, { t: "state", project: hub.project, servers: visibleServers(user) } as { t: string });
      break;
    case "status": {
      const view = e.view as { id: string };
      if (can(user, "servers.view") && sees(user, view.id)) send(c, { t: "status", view } as { t: string });
      break;
    }
    case "logs": {
      if (!can(user, "console.read")) break;
      const batches = (e.batches as { id: string }[]).filter((b) => c.subs.has(b.id) && sees(user, b.id));
      if (batches.length) send(c, { t: "logs", batches } as { t: string });
      break;
    }
    case "live": {
      const id = String(e.id);
      if (sees(user, id)) send(c, { t: "live", id, live: filterLive(user, e.live as Record<string, unknown>) } as { t: string });
      break;
    }
  }
}

hub.on((e) => {
  if (e.t === "users") sessions.prune((s) => !!sessionUser(s));
  for (const c of clients) deliver(c, e);
});

app.get("/ws", { websocket: true }, (raw, req) => {
  const socket = raw as unknown as WebSocket;
  const sid = req.cookies[COOKIE] ?? "";
  const session = sessions.touch(sid);
  const user = sessionUser(session);
  if (!session || !user) {
    socket.close(4001, "signed out");
    return;
  }
  const client: Client = { socket, sid, userId: user.id, subs: new Set(), alive: true };
  clients.add(client);
  send(client, { t: "agent", online: hub.online } as { t: string });
  send(client, { t: "state", project: hub.project, servers: visibleServers(user) } as { t: string });
  for (const [id, view] of hub.status) if (can(user, "servers.view") && sees(user, id)) send(client, { t: "status", view } as { t: string });
  socket.on("pong", () => (client.alive = true));
  socket.on("message", (msg) => {
    client.alive = true;
    let p: { t?: string; server?: string };
    try {
      p = JSON.parse(String(msg));
    } catch {
      return;
    }
    const current = clientUser(client);
    if (!current || typeof p.server !== "string" || p.server.length > 64) return;
    if (p.t === "sub" && sees(current, p.server) && client.subs.size < MAX_SUBS) {
      client.subs.add(p.server);
      const live = hub.live.get(p.server);
      if (live) send(client, { t: "live", id: p.server, live: filterLive(current, live) } as { t: string });
    } else if (p.t === "unsub") {
      client.subs.delete(p.server);
    }
  });
  socket.on("close", () => clients.delete(client));
});

setInterval(() => {
  for (const c of clients) {
    if (!clientUser(c)) {
      c.socket.close(4001, "signed out");
      continue;
    }
    if (!c.alive) {
      c.socket.terminate();
      clients.delete(c);
      continue;
    }
    c.alive = false;
    c.socket.ping();
  }
}, 30_000).unref();

if (existsSync(config.distDir)) {
  await app.register(fstatic, { root: config.distDir });
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    const isPage = !path.startsWith("/api/") && !path.startsWith("/assets/") && !path.startsWith("/ws") && !/\.[a-z0-9]+$/i.test(path);
    if (req.method === "GET" && isPage) {
      return reply.sendFile("index.html");
    }
    return fail(reply, 404, "errors.generic", { detail: "not found" });
  });
} else {
  app.log.warn("dist/ is missing – run `npm run build` to serve the web UI");
}

await app.listen({ host: config.host, port: config.port });
hub.connect(config.launcherUrl!, config.launcherToken, { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) });
