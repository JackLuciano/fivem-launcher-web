import type { Msg } from "./types";

export class ApiError extends Error {
  msg: Msg;
  status: number;

  constructor(msg: Msg, status: number) {
    super(msg.key);
    this.msg = msg;
    this.status = status;
  }
}

function toMsg(raw: unknown, res: Response): Msg {
  if (raw && typeof raw === "object" && typeof (raw as Msg).key === "string") {
    const params = (raw as Msg).params;
    return { key: (raw as Msg).key, params: params && typeof params === "object" ? params : {} };
  }
  const detail = typeof raw === "string" && raw ? raw : res.statusText || String(res.status);
  return { key: res.status === 429 ? "errors.webRateLimited" : "errors.generic", params: { detail } };
}

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", "x-fxl": "1" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(toMsg(data && typeof data === "object" ? (data as { error?: unknown }).error : undefined, res), res.status);
  return data as T;
}

export const api = {
  login: (username: string, password: string) => call<{ user: unknown; online: boolean }>("POST", "/api/login", { username, password }),
  logout: () => call<void>("POST", "/api/logout", {}),
  me: () => call<{ user: unknown; online: boolean; version: string; project: unknown; servers: unknown[] }>("GET", "/api/me"),
  locales: () => call<Record<string, unknown>>("GET", "/api/locales"),
  audit: (limit = 300) => call<unknown[]>("GET", `/api/audit?limit=${limit}`),
  action: async <T = unknown>(action: string, args: Record<string, unknown> = {}) => (await call<{ data: T }>("POST", "/api/action", { action, args })).data,
};
