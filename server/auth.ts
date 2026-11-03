import { randomBytes } from "node:crypto";

export interface Session {
  userId: string;
  ticket: string;
  epoch: string;
  expires: number;
  created: number;
}

const MAX_LIFETIME = 7 * 24 * 3600_000;

export class Sessions {
  #map = new Map<string, Session>();
  #ttl: number;

  constructor(hours: number) {
    this.#ttl = hours * 3600_000;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(userId: string, ticket: string, epoch: string): string {
    const sid = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.#map.set(sid, { userId, ticket, epoch, created: now, expires: now + this.#ttl });
    return sid;
  }

  peek(sid: string | undefined): Session | null {
    if (!sid) return null;
    const s = this.#map.get(sid);
    if (!s) return null;
    const now = Date.now();
    if (s.expires < now || now - s.created > MAX_LIFETIME) {
      this.#map.delete(sid);
      return null;
    }
    return s;
  }

  touch(sid: string | undefined): Session | null {
    const s = this.peek(sid);
    if (s) s.expires = Date.now() + this.#ttl;
    return s;
  }

  destroy(sid: string | undefined): Session | null {
    if (!sid) return null;
    const s = this.#map.get(sid) ?? null;
    this.#map.delete(sid);
    return s;
  }

  prune(keep: (s: Session) => boolean): string[] {
    const ended: string[] = [];
    for (const [sid, s] of this.#map) {
      if (!keep(s)) {
        this.#map.delete(sid);
        ended.push(sid);
      }
    }
    return ended;
  }

  sweep() {
    const now = Date.now();
    for (const [sid, s] of this.#map) if (s.expires < now || now - s.created > MAX_LIFETIME) this.#map.delete(sid);
  }

  get ttlSeconds() {
    return Math.floor(this.#ttl / 1000);
  }
}

export class TrustedLogins {
  #seen = new Map<string, number>();
  #ttl: number;
  #max: number;

  constructor(ttlMs = 30 * 24 * 3600_000, max = 10_000) {
    this.#ttl = ttlMs;
    this.#max = max;
  }

  add(username: string, ip: string) {
    if (this.#seen.size >= this.#max) {
      const now = Date.now();
      for (const [k, at] of this.#seen) if (now - at > this.#ttl) this.#seen.delete(k);
      if (this.#seen.size >= this.#max) this.#seen.delete(this.#seen.keys().next().value!);
    }
    this.#seen.set(`${username}|${ip}`, Date.now());
  }

  has(username: string, ip: string): boolean {
    const at = this.#seen.get(`${username}|${ip}`);
    return at !== undefined && Date.now() - at <= this.#ttl;
  }
}

export class LoginGuard {
  #fails = new Map<string, { count: number; until: number }>();
  maxFails: number;
  lockMs: number;
  maxKeys: number;

  constructor(maxFails = 8, lockMs = 10 * 60_000, maxKeys = 50_000) {
    this.maxFails = maxFails;
    this.lockMs = lockMs;
    this.maxKeys = maxKeys;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  locked(key: string): boolean {
    const f = this.#fails.get(key);
    return !!f && f.count >= this.maxFails && f.until > Date.now();
  }

  delayMs(key: string): number {
    const f = this.#fails.get(key);
    const now = Date.now();
    if (!f || f.until < now || f.count < 3) return 0;
    const backoff = Math.min(1000 * 2 ** (f.count - 3), 30_000);
    return Math.max(0, f.until - this.lockMs + backoff - now);
  }

  fail(key: string) {
    const f = this.#fails.get(key);
    const expired = !f || f.until < Date.now();
    if (expired && this.#fails.size >= this.maxKeys) this.sweep();
    if (expired && this.#fails.size >= this.maxKeys) return;
    const count = expired ? 1 : f.count + 1;
    this.#fails.set(key, { count, until: Date.now() + this.lockMs });
  }

  clear(key: string) {
    this.#fails.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, f] of this.#fails) if (f.until < now) this.#fails.delete(key);
  }

  get size() {
    return this.#fails.size;
  }
}
