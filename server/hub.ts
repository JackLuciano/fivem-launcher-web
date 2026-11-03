import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { TLSSocket } from "node:tls";
import WebSocket from "ws";
import type { Args, PanelUser } from "./perms.ts";

interface Log {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface HubEvent {
  t: "agent" | "state" | "status" | "logs" | "live" | "users" | "locales";
  [key: string]: unknown;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: unknown) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT = 30_000;
const PING_EVERY = 30_000;
const AUTH_TIMEOUT = 10_000;
const STABLE_AFTER = 30_000;
const REPLACED_BACKOFF = 5 * 60_000;
const AUDIT_MAX_BYTES = 10 * 1024 * 1024;
const AUDIT_TAIL_BYTES = 4 * 1024 * 1024;
const EXPORTER_LABEL = "EXPORTER-fxl-agent";
export const CLOSE_REPLACED = 4009;
export const CLOSE_AUTH = 4401;

export function agentProof(token: string, role: "panel" | "launcher", launcherNonce: string, panelNonce: string, binding: string): string {
  return createHmac("sha256", token).update(`${role}|${launcherNonce}|${panelNonce}|${binding}`).digest("base64");
}

function sameProof(a: string, b: string): boolean {
  const x = Buffer.from(a, "base64");
  const y = Buffer.from(b, "base64");
  return x.length === 32 && x.length === y.length && timingSafeEqual(x, y);
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export class Hub {
  #agent: WebSocket | null = null;
  #pending = new Map<string, Pending>();
  #listeners = new Set<(e: HubEvent) => void>();
  #auditFile: string;
  #localesFile: string;
  #log: Log = { info: () => {}, warn: () => {} };

  version = "";
  locales: unknown = null;
  users: PanelUser[] = [];
  project: unknown = null;
  servers: Record<string, unknown>[] = [];
  status = new Map<string, unknown>();
  live = new Map<string, Record<string, unknown>>();
  connectedAt = 0;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.#auditFile = join(dataDir, "audit.jsonl");
    this.#localesFile = join(dataDir, "locales.json");
    this.locales = readJson(this.#localesFile, null);
  }

  connect(url: string, token: string, log: Log) {
    this.#log = log;
    let delay = 1000;
    let lastProblem = "";
    const report = (problem: string) => {
      if (problem !== lastProblem) log.warn(`launcher ${url}: ${problem}`);
      lastProblem = problem;
    };
    const open = () => {
      let refused = 0;
      let binding = "";
      let launcherNonce = "";
      let panelNonce = "";
      let ready = false;
      let openedAt = 0;
      const socket = new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: 16 * 1024 * 1024, rejectUnauthorized: false, perMessageDeflate: false });
      const authTimer = setTimeout(() => {
        if (!ready) {
          report("did not finish the handshake in time");
          socket.terminate();
        }
      }, AUTH_TIMEOUT + 10_000);
      socket.on("unexpected-response", (_req, res) => {
        refused = res.statusCode ?? 0;
        socket.terminate();
      });
      socket.on("upgrade", (res) => {
        const tls = res.socket as TLSSocket;
        try {
          binding = typeof tls.exportKeyingMaterial === "function" ? tls.exportKeyingMaterial(32, EXPORTER_LABEL, Buffer.alloc(0)).toString("base64") : "";
        } catch {
          binding = "";
        }
      });
      socket.on("open", () => {
        openedAt = Date.now();
        if (!binding) {
          report("the connection is not encrypted – LAUNCHER_URL must point straight at the launcher (no HTTP proxy in between)");
          socket.terminate();
        }
      });
      socket.on("message", (raw) => {
        if (ready) return;
        let p: Record<string, unknown>;
        try {
          p = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (p.t === "challenge" && typeof p.nonce === "string" && !launcherNonce) {
          launcherNonce = p.nonce;
          panelNonce = randomBytes(32).toString("base64");
          socket.send(JSON.stringify({ t: "auth", nonce: panelNonce, proof: agentProof(token, "panel", launcherNonce, panelNonce, binding) }));
        } else if (p.t === "auth" && launcherNonce && typeof p.proof === "string") {
          if (!sameProof(p.proof, agentProof(token, "launcher", launcherNonce, panelNonce, binding))) {
            report("the launcher could not prove it knows the token – check LAUNCHER_URL and LAUNCHER_TOKEN");
            socket.terminate();
            return;
          }
          ready = true;
          clearTimeout(authTimer);
          lastProblem = "";
          log.info(`connected to the launcher at ${url}`);
          this.#attach(socket);
        }
      });
      socket.on("error", (e) => report(refused ? `refused (HTTP ${refused})` : e.message));
      socket.on("close", (code) => {
        clearTimeout(authTimer);
        if (openedAt && Date.now() - openedAt > STABLE_AFTER) delay = 1000;
        let wait = delay;
        if (code === CLOSE_REPLACED) {
          report("another panel took over the launcher connection – only one panel can be connected");
          wait = REPLACED_BACKOFF;
        } else if (code === CLOSE_AUTH) {
          report("refused the token – check LAUNCHER_TOKEN");
          wait = Math.max(delay, 15_000);
        }
        setTimeout(open, wait).unref();
        delay = Math.min(delay * 2, 15_000);
      });
    };
    open();
  }

  get online() {
    return this.#agent !== null;
  }

  on(listener: (e: HubEvent) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(e: HubEvent) {
    for (const l of this.#listeners) {
      try {
        l(e);
      } catch (err) {
        this.#log.warn(`listener failed: ${(err as Error).message}`);
      }
    }
  }

  user(id: string | null | undefined): PanelUser | undefined {
    return id ? this.users.find((u) => u.id === id && !u.disabled) : undefined;
  }

  remember(user: PanelUser) {
    if (!this.users.some((u) => u.id === user.id)) this.users = [...this.users, user];
  }

  #attach(socket: WebSocket) {
    this.#agent = socket;
    this.connectedAt = Date.now();
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, PING_EVERY);
    socket.on("pong", () => (alive = true));
    socket.on("message", (raw) => {
      alive = true;
      try {
        this.#onPacket(JSON.parse(String(raw)));
      } catch (err) {
        this.#log.warn(`bad packet from the launcher: ${(err as Error).message}`);
      }
    });
    socket.on("close", () => {
      clearInterval(ping);
      if (this.#agent !== socket) return;
      this.#agent = null;
      for (const [id, p] of this.#pending) {
        clearTimeout(p.timer);
        p.reject({ key: "errors.webLauncherOffline", params: {} });
        this.#pending.delete(id);
      }
      this.#emit({ t: "agent", online: false });
    });
    this.#emit({ t: "agent", online: true });
  }

  #onPacket(p: Record<string, unknown>) {
    switch (p.t) {
      case "hello":
        this.version = String(p.version ?? "");
        if (p.locales && typeof p.locales === "object") {
          this.locales = p.locales;
          try {
            writeJson(this.#localesFile, p.locales);
          } catch (err) {
            this.#log.warn(`could not cache the translations: ${(err as Error).message}`);
          }
          this.#emit({ t: "locales" });
        }
        break;
      case "users":
        this.users = Array.isArray(p.users) ? (p.users as PanelUser[]) : [];
        this.#emit({ t: "users" });
        break;
      case "state": {
        this.project = p.project ?? null;
        this.servers = Array.isArray(p.servers) ? (p.servers as Record<string, unknown>[]) : [];
        const ids = new Set(this.servers.map((s) => String(s.id)));
        for (const id of [...this.status.keys()]) if (!ids.has(id)) this.status.delete(id);
        for (const id of [...this.live.keys()]) if (!ids.has(id)) this.live.delete(id);
        this.#emit({ t: "state" });
        break;
      }
      case "status": {
        const view = p.view as { id?: string } | undefined;
        if (view?.id) {
          this.status.set(view.id, view);
          this.#emit({ t: "status", view });
        }
        break;
      }
      case "logs": {
        const batches = (Array.isArray(p.batches) ? p.batches : []).filter(
          (b: { id?: unknown; lines?: unknown }) => typeof b?.id === "string" && Array.isArray(b.lines),
        );
        if (batches.length) this.#emit({ t: "logs", batches });
        break;
      }
      case "live":
        if (typeof p.id === "string" && p.live && typeof p.live === "object") {
          this.live.set(p.id, p.live as Record<string, unknown>);
          this.#emit({ t: "live", id: p.id, live: p.live });
        }
        break;
      case "res": {
        const pending = this.#pending.get(String(p.id));
        if (!pending) break;
        clearTimeout(pending.timer);
        this.#pending.delete(String(p.id));
        if (p.ok) pending.resolve(p.data);
        else pending.reject(p.error ?? { key: "errors.generic", params: { detail: "unknown error" } });
        break;
      }
    }
  }

  request(ticket: string, action: string, args: Args): Promise<unknown> {
    const agent = this.#agent;
    if (!agent) return Promise.reject({ key: "errors.webLauncherOffline", params: {} });
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject({ key: "errors.webTimeout", params: {} });
      }, REQUEST_TIMEOUT);
      this.#pending.set(id, { resolve, reject, timer });
      agent.send(JSON.stringify({ t: "req", id, ticket, action, args }));
    });
  }

  audit(entry: { user: string; action: string; server?: string; summary: string; ok: boolean; error?: string; ip: string }) {
    try {
      if (existsSync(this.#auditFile) && statSync(this.#auditFile).size > AUDIT_MAX_BYTES) renameSync(this.#auditFile, `${this.#auditFile}.1`);
      appendFileSync(this.#auditFile, JSON.stringify({ ts: Date.now(), ...entry }) + "\n", { mode: 0o600 });
    } catch (err) {
      this.#log.warn(`could not write the audit log: ${(err as Error).message}`);
    }
  }

  readAudit(limit: number): unknown[] {
    if (!existsSync(this.#auditFile)) return [];
    const size = statSync(this.#auditFile).size;
    const length = Math.min(size, AUDIT_TAIL_BYTES);
    const buf = Buffer.alloc(length);
    const fd = openSync(this.#auditFile, "r");
    try {
      readSync(fd, buf, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    if (length < size) lines.shift();
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}
