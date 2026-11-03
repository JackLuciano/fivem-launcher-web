export interface Msg {
  key: string;
  params: Record<string, string>;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: string;
  permissions: string[];
  servers: string[];
}

export interface ServerBrief {
  id: string;
  name: string;
  status: string;
  step: Msg | null;
  txAdmin: string;
  branch: string;
  mode: string;
  fxsPort: number;
  txaPort: number;
  cloned: boolean;
}

export interface RuntimeView {
  id: string;
  status: string;
  tx: string;
  step: Msg | null;
  pid: number | null;
  startedAt: number | null;
}

export interface LogLine {
  seq: number;
  ts: number;
  kind: "out" | "err" | "sys" | "cmd" | "step";
  source: string;
  text: string;
  msg?: Msg;
}

export interface LivePlayer {
  id: number;
  name: string;
  ping: number;
  license: string;
  identifiers?: string[];
}

export interface TxEvent {
  ts: number;
  kind: string;
  src: string;
  srcId: number | null;
  msg: string;
}

export interface LiveView {
  online: boolean;
  updated: number;
  maxPlayers: number | null;
  players?: LivePlayer[];
  events?: TxEvent[];
  tick?: { mainMs: number; networkMs: number; syncMs: number } | null;
  resources?: string[];
  uptimeMs?: number | null;
  health?: string;
  healthReason?: string;
}

export interface RepoStatus {
  id: string;
  label: string;
  path: string;
  url: string;
  shared: boolean;
  info: { cloned: boolean; branch: string; commit: string; subject: string; ahead: number; behind: number; dirty: number };
}

export interface ConfigField {
  key: string;
  group: string;
  templateValue: string;
  optional: boolean;
}

export interface ConfigFile {
  path: string;
  format: string;
  exists: boolean;
  fields: ConfigField[];
}

export interface AuditEntry {
  ts: number;
  user: string;
  action: string;
  server?: string;
  summary: string;
  ok: boolean;
  error?: string;
  ip: string;
}
