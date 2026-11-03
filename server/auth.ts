import { randomBytes } from "node:crypto";

interface Session {
  userId: string;
  expires: number;
  created: number;
}

export class Sessions {
  #map = new Map<string, Session>();
  #ttl: number;

  constructor(hours: number) {
    this.#ttl = hours * 3600_000;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(userId: string): string {
    const sid = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.#map.set(sid, { userId, created: now, expires: now + this.#ttl });
    return sid;
  }

  touch(sid: string | undefined): string | null {
    if (!sid) return null;
    const s = this.#map.get(sid);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.#map.delete(sid);
      return null;
    }
    s.expires = Date.now() + this.#ttl;
    return s.userId;
  }

  destroy(sid: string | undefined) {
    if (sid) this.#map.delete(sid);
  }

  prune(keep: (userId: string) => boolean): string[] {
    const ended: string[] = [];
    for (const [sid, s] of this.#map) {
      if (!keep(s.userId)) {
        this.#map.delete(sid);
        ended.push(sid);
      }
    }
    return ended;
  }

  sweep() {
    const now = Date.now();
    for (const [sid, s] of this.#map) if (s.expires < now) this.#map.delete(sid);
  }

  get ttlSeconds() {
    return Math.floor(this.#ttl / 1000);
  }
}

export class LoginGuard {
  #fails = new Map<string, { count: number; until: number }>();
  maxFails: number;
  lockMs: number;

  constructor(maxFails = 8, lockMs = 10 * 60_000) {
    this.maxFails = maxFails;
    this.lockMs = lockMs;
  }

  locked(key: string): boolean {
    const f = this.#fails.get(key);
    return !!f && f.count >= this.maxFails && f.until > Date.now();
  }

  fail(key: string) {
    const f = this.#fails.get(key);
    const expired = !f || f.until < Date.now();
    const count = expired ? 1 : f.count + 1;
    this.#fails.set(key, { count, until: Date.now() + this.lockMs });
  }

  clear(key: string) {
    this.#fails.delete(key);
  }
}
