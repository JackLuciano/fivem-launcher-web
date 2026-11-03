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

async function call<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "content-type": "application/json", "x-fxl": "1" } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: Msg }).error ?? { key: "errors.generic", params: { detail: res.statusText } };
    throw new ApiError({ key: err.key, params: err.params ?? {} }, res.status);
  }
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
