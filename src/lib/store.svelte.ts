import { api, ApiError } from "./api";
import { i18n, t, tm } from "./i18n.svelte";
import type { LiveView, LogLine, Me, RuntimeView, ServerBrief } from "./types";

export type Page = { name: "servers" } | { name: "server"; id: string; tab?: string } | { name: "audit" };

interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

const LOG_CAP = 4000;
const THEME_KEY = "fxl-web-theme";
const HISTORY_RETRY_MS = 5000;

function mergeLive(current: LogLine[], lines: LogLine[]): LogLine[] {
  if (!lines.length) return current;
  if (!current.length) return lines.slice();
  const tail = current[current.length - 1];
  const first = lines[0];
  if (first.seq > tail.seq) return current.concat(lines);
  const same = current.find((l) => l.seq === first.seq);
  const reset = same ? same.ts !== first.ts : first.ts >= tail.ts;
  return reset ? lines.slice() : current.concat(lines.filter((l) => l.seq > tail.seq));
}

function mergeHistory(history: LogLine[], current: LogLine[]): LogLine[] {
  if (!history.length) return current;
  const head = history[0];
  const tail = history[history.length - 1];
  const known = new Map(history.map((l) => [l.seq, l.ts]));
  const sameRun = current.some((l) => known.get(l.seq) === l.ts);
  const before = sameRun ? current.filter((l) => l.seq < head.seq) : [];
  const after = current.filter((l) => l.seq > tail.seq && l.ts >= tail.ts);
  return before.concat(history, after).slice(-LOG_CAP);
}

class Store {
  ready = $state(false);
  me = $state<Me | null>(null);
  online = $state(false);
  version = $state("");
  project = $state<string | null>(null);
  servers = $state<ServerBrief[]>([]);
  status = $state<Record<string, RuntimeView>>({});
  live = $state.raw<Record<string, LiveView>>({});
  logs = $state.raw<Record<string, LogLine[]>>({});
  page = $state<Page>({ name: "servers" });
  toasts = $state<Toast[]>([]);
  theme = $state<"light" | "dark" | "system">("system");
  #ws: WebSocket | null = null;
  #retry = 1000;
  #subs = new Set<string>();
  #toastId = 1;
  #connected = false;
  #loading = new Map<string, number>();
  #stale = new Map<string, number>();
  #token = 1;

  constructor() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark") this.theme = v;
    } catch {}
    this.applyTheme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
    window.addEventListener("hashchange", () => this.#fromHash());
  }

  can(perm: string) {
    return !!this.me?.permissions.includes(perm);
  }

  server(id: string) {
    return this.servers.find((s) => s.id === id);
  }

  async boot() {
    try {
      const res = await api.me();
      this.#applyMe(res);
      await this.#loadLocales();
      this.#connect();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) this.toast(this.errorText(e), "error");
    } finally {
      this.#fromHash();
      this.ready = true;
    }
  }

  async login(username: string, password: string) {
    await api.login(username, password);
    const res = await api.me();
    this.#applyMe(res);
    await this.#loadLocales();
    this.#connect();
  }

  async logout() {
    await api.logout().catch(() => {});
    this.#ws?.close();
    this.#ws = null;
    this.#reset();
    this.go({ name: "servers" });
  }

  #reset() {
    this.me = null;
    this.servers = [];
    this.status = {};
    this.logs = {};
    this.live = {};
    this.#connected = false;
    this.#loading.clear();
    this.#stale.clear();
  }

  #applyMe(res: { user: unknown; online: boolean; version: string; project: unknown; servers: unknown[] }) {
    this.me = res.user as Me;
    this.online = res.online;
    this.version = res.version;
    this.project = (res.project as string) ?? null;
    this.servers = res.servers as ServerBrief[];
  }

  async #loadLocales() {
    try {
      i18n.launcher = (await api.locales()) as typeof i18n.launcher;
    } catch {}
  }

  #connect() {
    if (this.#ws) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.#ws = ws;
    ws.onopen = () => {
      this.#retry = 1000;
      for (const id of this.#subs) ws.send(JSON.stringify({ t: "sub", server: id }));
      if (this.#connected) this.#refill();
      this.#connected = true;
    };
    ws.onmessage = (ev) => {
      try {
        this.#onPacket(JSON.parse(ev.data));
      } catch {}
    };
    ws.onclose = (ev) => {
      this.#ws = null;
      if (ev.code === 4001) {
        this.#reset();
        return;
      }
      if (!this.me) return;
      setTimeout(() => this.#connect(), this.#retry);
      this.#retry = Math.min(this.#retry * 2, 15000);
    };
  }

  #onPacket(p: Record<string, unknown>) {
    switch (p.t) {
      case "agent": {
        const was = this.online;
        this.online = !!p.online;
        if (this.online) this.#loadLocales();
        if (this.online && !was) this.#resync();
        break;
      }
      case "locales":
        this.#loadLocales();
        break;
      case "me":
        this.me = p.user as Me;
        break;
      case "state":
        this.project = (p.project as string) ?? null;
        this.servers = (p.servers as ServerBrief[]) ?? [];
        break;
      case "status": {
        const view = p.view as RuntimeView;
        this.status = { ...this.status, [view.id]: view };
        break;
      }
      case "live":
        this.live = { ...this.live, [String(p.id)]: p.live as LiveView };
        break;
      case "logs": {
        let next: Record<string, LogLine[]> | null = null;
        for (const b of p.batches as { id: string; lines: LogLine[] }[]) {
          if (!this.logs[b.id]) continue;
          next ??= { ...this.logs };
          const merged = mergeLive(next[b.id], b.lines);
          next[b.id] = merged.length > LOG_CAP ? merged.slice(-LOG_CAP) : merged;
        }
        if (next) this.logs = next;
        break;
      }
    }
  }

  async watch(id: string) {
    const cached = this.logs[id];
    const fresh = !this.#subs.has(id);
    if (fresh) {
      this.#subs.add(id);
      this.#ws?.readyState === 1 && this.#ws.send(JSON.stringify({ t: "sub", server: id }));
    }
    if (!this.can("console.read") || this.#loading.has(id)) return;
    const stale = this.#stale.get(id);
    if (cached && stale === undefined && !fresh) return;
    if (stale !== undefined && Date.now() < stale) return;
    await this.#history(id, stale !== undefined);
  }

  unwatch(id: string) {
    this.#subs.delete(id);
    if (this.#stale.has(id)) this.#stale.set(id, 0);
    this.#ws?.readyState === 1 && this.#ws.send(JSON.stringify({ t: "unsub", server: id }));
  }

  async #history(id: string, quiet: boolean) {
    const token = this.#token++;
    this.#loading.set(id, token);
    this.#stale.delete(id);
    if (!this.logs[id]) this.logs = { ...this.logs, [id]: [] };
    try {
      const history = await api.action<LogLine[]>("log_history", { server: id });
      const current = this.logs[id];
      if (this.#loading.get(id) !== token || !current) return;
      this.logs = { ...this.logs, [id]: mergeHistory(Array.isArray(history) ? history : [], current) };
    } catch (e) {
      if (this.#loading.get(id) !== token) return;
      this.#stale.set(id, Date.now() + HISTORY_RETRY_MS);
      if (!quiet) this.toast(this.errorText(e), "error");
    } finally {
      if (this.#loading.get(id) === token) this.#loading.delete(id);
    }
  }

  #refill() {
    if (!this.can("console.read")) return;
    for (const id of this.#subs) this.#history(id, true);
  }

  #resync() {
    const ids = [...this.#subs].filter((id) => this.logs[id]);
    if (!ids.length) return;
    const next = { ...this.logs };
    for (const id of ids) {
      delete next[id];
      this.#loading.delete(id);
      this.#stale.delete(id);
    }
    this.logs = next;
    for (const id of ids) this.watch(id);
  }

  runtime(id: string): { status: string; tx: string; step: unknown } {
    const s = this.status[id];
    const b = this.server(id);
    return { status: s?.status ?? b?.status ?? "stopped", tx: s?.tx ?? b?.txAdmin ?? "offline", step: s?.step ?? b?.step ?? null };
  }

  async act(action: string, args: Record<string, unknown>, success?: string) {
    try {
      const data = await api.action(action, args);
      if (success) this.toast(success);
      return data;
    } catch (e) {
      this.toast(this.errorText(e), "error");
      return undefined;
    }
  }

  errorText(e: unknown) {
    if (e instanceof ApiError) return tm(e.msg);
    return e instanceof Error ? e.message : String(e);
  }

  toast(text: string, kind: Toast["kind"] = "success") {
    const id = this.#toastId++;
    this.toasts = [...this.toasts, { id, kind, text }];
    setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== id)), kind === "error" ? 8000 : 4000);
  }

  go(page: Page) {
    this.page = page;
    const hash = page.name === "server" ? `#/server/${page.id}${page.tab ? `/${page.tab}` : ""}` : page.name === "audit" ? "#/audit" : "#/";
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  #fromHash() {
    const parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "server" && parts[1]) this.page = { name: "server", id: parts[1], tab: parts[2] };
    else if (parts[0] === "audit") this.page = { name: "audit" };
    else this.page = { name: "servers" };
  }

  setTheme(v: "light" | "dark" | "system") {
    this.theme = v;
    try {
      localStorage.setItem(THEME_KEY, v);
    } catch {}
    this.applyTheme();
  }

  applyTheme() {
    const dark = this.theme === "dark" || (this.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }
}

export const store = new Store();
export { t };
