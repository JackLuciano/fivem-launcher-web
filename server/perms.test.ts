import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLive, permissionFor, sees, summarize, type PanelUser } from "./perms.ts";
import { LoginGuard } from "./auth.ts";
import { agentUrl } from "./config.ts";

const viewer: PanelUser = {
  id: "u1",
  username: "viewer",
  displayName: "",
  role: "viewer",
  permissions: ["servers.view", "console.read", "players.view"],
  servers: ["a"],
  disabled: false,
};

test("actions map to the permissions the launcher enforces", () => {
  assert.deepEqual(permissionFor("player_action", { action: "ban" }), { perm: "players.ban", scoped: true });
  assert.deepEqual(permissionFor("player_action", { action: "kick" }), { perm: "players.manage", scoped: true });
  assert.deepEqual(permissionFor("set_config_values", {}), { perm: "global.edit", scoped: false });
  assert.equal(permissionFor("update_project_settings", {}), null);
  assert.equal(permissionFor("switch_project", {}), null);
});

test("server scope and live filtering", () => {
  assert.ok(sees(viewer, "a"));
  assert.ok(!sees(viewer, "b"));
  const live = filterLive(viewer, { online: true, players: [1], events: [2], tick: { mainMs: 1 } });
  assert.deepEqual(live.players, [1]);
  assert.equal(live.events, undefined);
  assert.equal(live.tick, undefined);
});

test("audit summaries never include config values", () => {
  const s = summarize("set_config_values", { file: ".env", values: { DB_PASSWORD: "hunter2" } });
  assert.ok(s.includes("DB_PASSWORD"));
  assert.ok(!s.includes("hunter2"));
});

test("login guard locks after repeated failures", () => {
  const g = new LoginGuard(3, 60_000);
  g.fail("ip:x");
  g.fail("ip:x");
  assert.ok(!g.locked("ip:x"));
  g.fail("ip:x");
  assert.ok(g.locked("ip:x"));
  g.clear("ip:x");
  assert.ok(!g.locked("ip:x"));
});

test("launcher address becomes the agent socket url", () => {
  assert.equal(agentUrl("ws://192.168.1.20:47801"), "ws://192.168.1.20:47801/agent");
  assert.equal(agentUrl("http://10.0.0.5:47801/"), "ws://10.0.0.5:47801/agent");
  assert.equal(agentUrl("https://launcher.example.com"), "wss://launcher.example.com/agent");
  assert.equal(agentUrl("192.168.1.20:47801"), null);
  assert.equal(agentUrl("ws://host/path"), null);
});
