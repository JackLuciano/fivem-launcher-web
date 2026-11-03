import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
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

const LOG_CAP = 3000;
const REQUEST_TIMEOUT = 30_000;
const PING_EVERY = 30_000;

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

  version = "";
  locales: unknown = null;
  users: PanelUser[] = [];
  project: unknown = null;
  servers: Record<string, unknown>[] = [];
  status = new Map<string, unknown>();
  live = new Map<string, Record<string, unknown>>();
  logs = new Map<string, unknown[]>();
  connectedAt = 0;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#auditFile = join(dataDir, "audit.jsonl");
    this.#localesFile = join(dataDir, "locales.json");
    this.locales = readJson(this.#localesFile, null);
  }

  connect(url: string, token: string, log: Log) {
    let delay = 1000;
    let lastProblem = "";
    const report = (problem: string) => {
      if (problem !== lastProblem) log.warn(`launcher ${url}: ${problem}`);
      lastProblem = problem;
    };
    const open = () => {
      let refused = 0;
      const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` }, handshakeTimeout: 10_000, maxPayload: 16 * 1024 * 1024 });
      socket.on("unexpected-response", (_req, res) => {
        refused = res.statusCode ?? 0;
        socket.terminate();
      });
      socket.on("open", () => {
        delay = 1000;
        lastProblem = "";
        log.info(`connected to the launcher at ${url}`);
        this.#attach(socket);
      });
      socket.on("error", (e) => report(refused === 401 ? "refused the token – check LAUNCHER_TOKEN" : refused ? `refused (HTTP ${refused})` : e.message));
      socket.on("close", () => {
        setTimeout(open, delay).unref();
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
    for (const l of this.#listeners) l(e);
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
      let packet: Record<string, unknown>;
      try {
        packet = JSON.parse(String(raw));
      } catch {
        return;
      }
      this.#onPacket(packet);
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
          writeJson(this.#localesFile, p.locales);
          this.#emit({ t: "locales" });
        }
        break;
      case "users":
        this.users = Array.isArray(p.users) ? (p.users as PanelUser[]) : [];
        this.#emit({ t: "users" });
        break;
      case "state":
        this.project = p.project ?? null;
        this.servers = Array.isArray(p.servers) ? (p.servers as Record<string, unknown>[]) : [];
        this.#emit({ t: "state" });
        break;
      case "status": {
        const view = p.view as { id?: string } | undefined;
        if (view?.id) {
          this.status.set(view.id, view);
          this.#emit({ t: "status", view });
        }
        break;
      }
      case "logs": {
        const batches = (Array.isArray(p.batches) ? p.batches : []) as { id: string; lines: unknown[] }[];
        for (const b of batches) {
          const list = this.logs.get(b.id) ?? [];
          list.push(...b.lines);
          if (list.length > LOG_CAP) list.splice(0, list.length - LOG_CAP);
          this.logs.set(b.id, list);
        }
        this.#emit({ t: "logs", batches });
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

  request(userId: string, action: string, args: Args): Promise<unknown> {
    const agent = this.#agent;
    if (!agent) return Promise.reject({ key: "errors.webLauncherOffline", params: {} });
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject({ key: "errors.webTimeout", params: {} });
      }, REQUEST_TIMEOUT);
      this.#pending.set(id, { resolve, reject, timer });
      agent.send(JSON.stringify({ t: "req", id, user: userId, action, args }));
    });
  }

  audit(entry: { user: string; action: string; server?: string; summary: string; ok: boolean; error?: string; ip: string }) {
    appendFileSync(this.#auditFile, JSON.stringify({ ts: Date.now(), ...entry }) + "\n", { mode: 0o600 });
  }

  readAudit(limit: number): unknown[] {
    if (!existsSync(this.#auditFile)) return [];
    const lines = readFileSync(this.#auditFile, "utf8").trim().split("\n").filter(Boolean);
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
