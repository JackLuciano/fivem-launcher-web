import { test } from "node:test";
import assert from "node:assert/strict";
import { filterLive, permissionFor, sees, summarize, type PanelUser } from "./perms.ts";
import { LoginGuard, Sessions, TrustedLogins } from "./auth.ts";
import { agentUrl, effectiveTrustProxy, trustProxyValue } from "./config.ts";
import { agentProof } from "./hub.ts";

const viewer: PanelUser = {
  id: "u1",
  username: "viewer",
  displayName: "",
  role: "viewer",
  permissions: ["servers.view", "console.read", "players.view"],
  allServers: false,
  servers: ["a"],
  disabled: false,
  epoch: "e1",
};

test("actions map to the permissions the launcher enforces", () => {
  assert.deepEqual(permissionFor("player_action", { action: "ban" }), { perm: "players.ban", scoped: true });
  assert.deepEqual(permissionFor("player_action", { action: "kick" }), { perm: "players.manage", scoped: true });
  assert.equal(permissionFor("player_action", { action: " ban" }), null);
  assert.equal(permissionFor("player_action", { action: "ban\n" }), null);
  assert.equal(permissionFor("player_action", { action: "constructor" }), null);
  assert.deepEqual(permissionFor("get_config_values", { server: "a" }), { perm: "config.view", scoped: true });
  assert.deepEqual(permissionFor("set_config_values", {}), { perm: "global.edit", scoped: false });
  assert.equal(permissionFor("update_project_settings", {}), null);
  assert.equal(permissionFor("switch_project", {}), null);
});

test("server scope is explicit and live data drops player IPs", () => {
  assert.ok(sees(viewer, "a"));
  assert.ok(!sees(viewer, "b"));
  assert.ok(!sees({ ...viewer, servers: [] }, "a"), "an empty list must not mean every server");
  assert.ok(sees({ ...viewer, servers: [], allServers: true }, "b"));
  const live = filterLive(viewer, { online: true, players: [{ id: 1, identifiers: ["license:x", "ip:1.2.3.4"] }], events: [2], tick: { mainMs: 1 } });
  assert.deepEqual(live.players, [{ id: 1, identifiers: ["license:x"] }]);
  assert.equal(live.events, undefined);
  assert.equal(live.tick, undefined);
});

test("audit summaries never include config values and keep whole commands", () => {
  const s = summarize("set_config_values", { file: ".env", values: { DB_PASSWORD: "hunter2" } });
  assert.ok(s.includes("DB_PASSWORD"));
  assert.ok(!s.includes("hunter2"));
  const cmd = "say " + "x".repeat(600);
  assert.equal(summarize("send_console_command", { command: cmd }), cmd);
});

test("login guard locks after repeated failures and slows a username down", () => {
  const g = new LoginGuard(3, 60_000);
  g.fail("ip:x");
  g.fail("ip:x");
  assert.ok(!g.locked("ip:x"));
  g.fail("ip:x");
  assert.ok(g.locked("ip:x"));
  g.clear("ip:x");
  assert.ok(!g.locked("ip:x"));
  for (let i = 0; i < 4; i++) g.fail("user:owner");
  const wait = g.delayMs("user:owner");
  assert.ok(wait > 1900 && wait <= 2000, `expected about 2 s, got ${wait}`);
  assert.equal(g.delayMs("user:nobody"), 0);
  const t = new TrustedLogins(60_000, 2);
  t.add("owner", "1.1.1.1");
  assert.ok(t.has("owner", "1.1.1.1"));
  assert.ok(!t.has("owner", "2.2.2.2"));
  t.add("a", "x");
  t.add("b", "y");
  assert.ok(!t.has("owner", "1.1.1.1"), "the oldest entry makes room when full");
  const capped = new LoginGuard(3, 60_000, 2);
  capped.fail("a");
  capped.fail("b");
  capped.fail("c");
  assert.equal(capped.size, 2);
});

test("sessions expire without sliding on peek", () => {
  const s = new Sessions(1);
  const sid = s.create("u1", "fxt_1", "e1");
  assert.equal(s.peek(sid)?.ticket, "fxt_1");
  assert.equal(s.touch(sid)?.userId, "u1");
  assert.equal(s.destroy(sid)?.epoch, "e1");
  assert.equal(s.peek(sid), null);
});

test("launcher address always becomes an encrypted agent socket url", () => {
  assert.equal(agentUrl("wss://192.168.1.20:47801"), "wss://192.168.1.20:47801/agent");
  assert.equal(agentUrl("ws://10.0.0.5:47801/"), "wss://10.0.0.5:47801/agent");
  assert.equal(agentUrl("100.64.0.2:47801"), "wss://100.64.0.2:47801/agent");
  assert.equal(agentUrl("https://launcher.example.com:47801"), "wss://launcher.example.com:47801/agent");
  assert.equal(agentUrl("wss://[fd00::2]:47801"), "wss://[fd00::2]:47801/agent");
  assert.equal(agentUrl("wss://host"), null);
  assert.equal(agentUrl("ws://host:1/path"), null);
});

test("trust proxy never trusts the whole forwarded chain", () => {
  assert.equal(trustProxyValue(undefined), false);
  assert.equal(trustProxyValue("false"), false);
  assert.equal(trustProxyValue("true"), "loopback");
  assert.equal(trustProxyValue("10.0.0.0/8"), "10.0.0.0/8");
  assert.equal(effectiveTrustProxy("true", "127.0.0.1"), "loopback");
  assert.equal(effectiveTrustProxy("true", "0.0.0.0"), false);
  assert.equal(effectiveTrustProxy("10.0.0.5", "0.0.0.0"), "10.0.0.5");
});

test("agent proofs depend on role, nonces, channel and token", () => {
  const p = agentProof("token-aaaaaaaaaaaaaaaaaaaaaaaa", "panel", "L", "P", "B");
  assert.notEqual(p, agentProof("token-aaaaaaaaaaaaaaaaaaaaaaaa", "launcher", "L", "P", "B"));
  assert.notEqual(p, agentProof("token-aaaaaaaaaaaaaaaaaaaaaaaa", "panel", "L", "P", "C"));
  assert.notEqual(p, agentProof("token-bbbbbbbbbbbbbbbbbbbbbbbb", "panel", "L", "P", "B"));
});
