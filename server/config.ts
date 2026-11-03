import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";

try {
  if (existsSync(".env")) process.loadEnvFile(".env");
} catch (err) {
  console.warn(`config: ignoring ./.env (${(err as Error).message}); using the process environment`);
}

const env = process.env;

export function agentUrl(base: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  const match = /^(?:(?:https?|wss?):\/\/)?([^/\s:[\]]+|\[[0-9a-f:.]+\]):(\d{1,5})$/i.exec(trimmed);
  if (!match) return null;
  return `wss://${match[1]}:${match[2]}/agent`;
}

export function trustProxyValue(raw: string | undefined): string | false {
  const value = (raw ?? "").trim();
  if (!value || value === "false") return false;
  if (value === "true") return "loopback";
  return value;
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

function originOf(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return "invalid";
  }
}

export function effectiveTrustProxy(raw: string | undefined, host: string): string | false {
  const value = trustProxyValue(raw);
  if (value === "loopback" && !isLoopback(host)) {
    console.warn("config: TRUST_PROXY=true only trusts a proxy on 127.0.0.1, but HOST is not a loopback address – ignoring X-Forwarded-For. List the proxy's address in TRUST_PROXY instead.");
    return false;
  }
  return value;
}

const host = env.HOST ?? "127.0.0.1";

export const config = {
  host,
  port: Number(env.PORT ?? 8080),
  launcherUrl: agentUrl(env.LAUNCHER_URL ?? ""),
  launcherToken: (env.LAUNCHER_TOKEN ?? "").trim(),
  cookieSecure: env.COOKIE_SECURE !== "false",
  trustProxy: effectiveTrustProxy(env.TRUST_PROXY, host),
  publicOrigin: originOf(env.PUBLIC_ORIGIN),
  dataDir: resolve(env.DATA_DIR ?? "./data"),
  sessionHours: Number(env.SESSION_HOURS || 12),
  distDir: resolve("dist"),
};

export function checkConfig(): string[] {
  const problems: string[] = [];
  if (!config.launcherUrl) problems.push("LAUNCHER_URL is missing or invalid (the launcher's address and port, e.g. wss://192.168.1.20:47801).");
  if (config.launcherToken.length < 24) problems.push("LAUNCHER_TOKEN is missing or shorter than 24 characters (copy it from the launcher's Web panel page).");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push("PORT is invalid.");
  if (!Number.isFinite(config.sessionHours) || config.sessionHours < 1 || config.sessionHours > 720) problems.push("SESSION_HOURS must be a number between 1 and 720.");
  if (config.publicOrigin === "invalid") problems.push("PUBLIC_ORIGIN is not a valid URL (e.g. https://panel.example.com).");
  return problems;
}
