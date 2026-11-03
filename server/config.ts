import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;

export function agentUrl(base: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  const match = /^(https?|wss?):\/\/[^/\s]+$/i.exec(trimmed);
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const ws = scheme === "https" ? "wss" : scheme === "http" ? "ws" : scheme;
  return `${ws}${trimmed.slice(match[1].length)}/agent`;
}

export const config = {
  host: env.HOST ?? "127.0.0.1",
  port: Number(env.PORT ?? 8080),
  launcherUrl: agentUrl(env.LAUNCHER_URL ?? ""),
  launcherToken: (env.LAUNCHER_TOKEN ?? "").trim(),
  cookieSecure: env.COOKIE_SECURE !== "false",
  trustProxy: env.TRUST_PROXY === "true",
  dataDir: resolve(env.DATA_DIR ?? "./data"),
  sessionHours: Math.max(1, Number(env.SESSION_HOURS ?? 12)),
  distDir: resolve("dist"),
};

export function checkConfig(): string[] {
  const problems: string[] = [];
  if (!config.launcherUrl) problems.push("LAUNCHER_URL is missing or invalid (e.g. ws://192.168.1.20:47801).");
  if (config.launcherToken.length < 24) problems.push("LAUNCHER_TOKEN is missing or shorter than 24 characters (copy it from the launcher's Web panel page).");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push("PORT is invalid.");
  return problems;
}
