export interface PanelUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  servers: string[];
  disabled: boolean;
}

export type Args = Record<string, unknown>;

export const MUTATING = new Set([
  "send_console_command",
  "start_server",
  "stop_server",
  "restart_server",
  "git_pull",
  "git_switch_branch",
  "run_macro",
  "set_config_values",
  "player_action",
  "resource_action",
]);

export function permissionFor(action: string, args: Args): { perm: string; scoped: boolean } | null {
  switch (action) {
    case "overview":
      return { perm: "servers.view", scoped: false };
    case "get_server":
    case "git_status":
      return { perm: "servers.view", scoped: true };
    case "log_history":
      return { perm: "console.read", scoped: true };
    case "send_console_command":
      return { perm: "console.write", scoped: true };
    case "start_server":
    case "stop_server":
    case "restart_server":
      return { perm: "servers.control", scoped: true };
    case "git_pull":
    case "git_switch_branch":
    case "list_branches":
      return { perm: "git", scoped: true };
    case "run_macro":
      return { perm: "macros.run", scoped: true };
    case "list_config_files":
      return { perm: "config.view", scoped: true };
    case "set_config_values":
      return args.server !== undefined ? { perm: "config.edit", scoped: true } : { perm: "global.edit", scoped: false };
    case "get_players":
      return { perm: "players.view", scoped: true };
    case "player_action":
      return { perm: args.action === "ban" ? "players.ban" : "players.manage", scoped: true };
    case "get_health":
      return { perm: "health.view", scoped: true };
    case "resource_action":
      return { perm: "resources.manage", scoped: true };
    case "get_action_log":
      return { perm: "actionlog.view", scoped: true };
    default:
      return null;
  }
}

export function can(user: PanelUser, perm: string): boolean {
  return !user.disabled && user.permissions.includes(perm);
}

export function sees(user: PanelUser, server: string): boolean {
  return user.servers.length === 0 || user.servers.includes(server);
}

export function filterLive(user: PanelUser, live: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { online: live.online, updated: live.updated, maxPlayers: live.maxPlayers };
  if (can(user, "players.view")) out.players = live.players;
  if (can(user, "actionlog.view")) out.events = live.events;
  if (can(user, "health.view")) {
    out.tick = live.tick;
    out.resources = live.resources;
    out.uptimeMs = live.uptimeMs;
    out.health = live.health;
    out.healthReason = live.healthReason;
  }
  return out;
}

export function summarize(action: string, args: Args): string {
  const pick = (k: string) => (typeof args[k] === "string" || typeof args[k] === "number" ? String(args[k]) : "");
  const parts =
    action === "send_console_command"
      ? [pick("command")]
      : action === "git_switch_branch"
        ? [pick("repo"), pick("branch")]
        : action === "run_macro"
          ? [pick("macro")]
          : action === "player_action"
            ? [pick("action"), `#${pick("playerId")}`, pick("duration")]
            : action === "resource_action"
              ? [pick("action"), pick("resource")]
              : action === "set_config_values"
                ? [pick("file"), Object.keys((args.values as Record<string, unknown>) ?? {}).join(", ")]
                : [];
  return parts.filter(Boolean).join(" · ").slice(0, 300);
}
