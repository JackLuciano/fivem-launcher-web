export interface Segment {
  text: string;
  fg: string | null;
  bold: boolean;
  dim: boolean;
  channel?: string;
}

export type Severity = "error" | "warn" | null;

export interface LineInfo {
  channel: string | null;
  severity: Severity;
}

const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

const SGR = /\x1b\[([0-9;]*)m/g;
const OTHER_ESCAPES = /\x1b\[[0-9;?]*[A-Za-ln-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g;

function xterm256(n: number): string | null {
  if (n < 8) return NAMES[n];
  if (n < 16) return `bright-${NAMES[n - 8]}`;
  return null;
}

export function parseAnsi(input: string): Segment[] {
  const text = input.replace(OTHER_ESCAPES, "");
  const out: Segment[] = [];
  let fg: string | null = null;
  let bold = false;
  let dim = false;
  let last = 0;
  SGR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SGR.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), fg, bold, dim });
    last = SGR.lastIndex;
    const codes = m[1] === "" ? [0] : m[1].split(";").map((c) => parseInt(c, 10) || 0);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) {
        fg = null;
        bold = false;
        dim = false;
      } else if (c === 1) bold = true;
      else if (c === 2) dim = true;
      else if (c === 22) {
        bold = false;
        dim = false;
      } else if (c >= 30 && c <= 37) fg = NAMES[c - 30];
      else if (c >= 90 && c <= 97) fg = `bright-${NAMES[c - 90]}`;
      else if (c === 39) fg = null;
      else if (c === 38 && codes[i + 1] === 5) {
        fg = xterm256(codes[i + 2] ?? 0);
        i += 2;
      } else if (c === 38 && codes[i + 1] === 2) {
        i += 4;
      } else if (c === 48 && (codes[i + 1] === 5 || codes[i + 1] === 2)) {
        i += codes[i + 1] === 5 ? 2 : 4;
      }
    }
  }
  if (last < text.length) out.push({ text: text.slice(last), fg, bold, dim });
  return out.filter((s) => s.text.length > 0);
}

const CHANNEL = /^(\s*\[)(?!\d{1,2}:\d{2}:\d{2}\])(\s*)([^\]\n]{1,48}?)(\])/;
const CHANNEL_COLORS = ["cyan", "blue", "magenta", "bright-blue", "bright-cyan", "bright-magenta"];
const ERROR = /\b(errors?|exception|fatal|couldn't|could not|cannot|can't|unable to|not found|mismatch|invalid|fail(ed|ure|s)?)\b/i;
const WARN = /\b(warn(ing)?s?|deprecated|timed out|timeout|retrying)\b/i;
const HARMLESS = /\b0 (errors?|failed|failures?|warnings?)\b/gi;
const PASSED = /\[(PASS|PASSED|OK|SKIP|SKIPPED|TODO|XFAIL)\]/i;
const FAILED = /\[(FAIL|FAILED)\]/i;
const TOKEN =
  /(\[\d{1,2}:\d{2}:\d{2}\])|\b(Started|Starting|Stopping|Stopped|Restarting) (resource) (\S+)|\b(Creating script environments for) (\S+)|(@[\w\-.]+\/[\w\-./]*[\w\-/])|(https?:\/\/[^\s)]+)|(\[(?:PASS|PASSED|OK)\])|(\[(?:FAIL|FAILED)\])|(\[(?:SKIP|SKIPPED|TODO|XFAIL)\])/g;
const VERB_COLORS: Record<string, string> = { Started: "green", Starting: "green", Stopping: "yellow", Stopped: "yellow", Restarting: "cyan" };

function channelColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CHANNEL_COLORS[Math.abs(h) % CHANNEL_COLORS.length];
}

function tokenize(text: string, base: Segment, tone: string | null, out: Segment[]) {
  const push = (t: string, fg: string | null, extra: Partial<Segment> = {}) => {
    if (t) out.push({ ...base, text: t, fg, ...extra });
  };
  let last = 0;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    push(text.slice(last, m.index), tone);
    last = TOKEN.lastIndex;
    if (m[1]) push(m[1], "bright-black");
    else if (m[2]) {
      push(`${m[2]} ${m[3]} `, VERB_COLORS[m[2]] ?? tone);
      push(m[4], tone, { bold: true });
    } else if (m[5]) {
      push(`${m[5]} `, tone, { dim: !tone });
      push(m[6], tone, { bold: true });
    } else if (m[7]) push(m[7], "bright-magenta");
    else if (m[8]) push(m[8], "bright-blue");
    else if (m[9]) push(m[9], "green", { bold: true });
    else if (m[10]) push(m[10], "red", { bold: true });
    else if (m[11]) push(m[11], "yellow", { bold: true });
  }
  push(text.slice(last), tone);
}

function severityOf(body: string): Severity {
  const text = body.replace(HARMLESS, "");
  if (FAILED.test(text)) return "error";
  if (PASSED.test(text)) return null;
  return ERROR.test(text) ? "error" : WARN.test(text) ? "warn" : null;
}

function channelMatch(segs: Segment[]): RegExpExecArray | null {
  const first = segs.length ? segs[0] : null;
  return first !== null && first.fg === null ? CHANNEL.exec(first.text) : null;
}

/**
 * @param text a raw console line, with ANSI or FiveM color codes
 * @returns its channel name and the severity `highlight()` would color it with
 */
export function inspect(text: string): LineInfo {
  const segs = parseAnsi(fivemToAnsi(text));
  const channel = channelMatch(segs);
  const body = segs.map((s) => s.text).join("").slice(channel ? channel[0].length : 0);
  return { channel: channel ? channel[3].trim() : null, severity: severityOf(body) };
}

export function severity(text: string): Severity {
  return inspect(text).severity;
}

export function highlight(segs: Segment[]): Segment[] {
  if (segs.length === 0) return segs;
  const out: Segment[] = [];
  let rest = segs;
  const first = segs[0];
  const channel = channelMatch(segs);
  if (channel) {
    out.push({ ...first, text: channel[1] + channel[2], fg: "bright-black" });
    out.push({ ...first, text: channel[3], fg: channelColor(channel[3].trim()), channel: channel[3].trim() });
    out.push({ ...first, text: channel[4], fg: "bright-black" });
    rest = [{ ...first, text: first.text.slice(channel[0].length) }, ...segs.slice(1)];
  }
  const level = severityOf(rest.map((s) => s.text).join(""));
  const tone = level === "error" ? "red" : level === "warn" ? "yellow" : null;
  for (const s of rest) {
    if (s.fg !== null) out.push(s);
    else tokenize(s.text, s, tone, out);
  }
  return out.filter((s) => s.text.length > 0);
}

const FIVEM_COLORS: Record<string, string> = {
  "0": "white",
  "1": "red",
  "2": "green",
  "3": "yellow",
  "4": "blue",
  "5": "cyan",
  "6": "magenta",
  "7": "white",
  "8": "red",
  "9": "bright-black",
};

export function fivemToAnsi(text: string): string {
  if (!text.includes("^")) return text;
  return text.replace(/\^([0-9])/g, (_, d: string) => {
    const name = FIVEM_COLORS[d];
    const idx = NAMES.indexOf(name.replace("bright-", ""));
    const code = name.startsWith("bright-") ? 90 + idx : 30 + idx;
    return d === "0" || d === "7" ? "\x1b[39m" : `\x1b[${code}m`;
  });
}
