import en from "../locales/en";
import hu from "../locales/hu";
import de from "../locales/de";
import type { Msg } from "./types";

type Dict = Record<string, unknown>;

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hu", label: "Magyar" },
  { code: "de", label: "Deutsch" },
];

const own: Record<string, Dict> = { en, hu, de };
const STORAGE_KEY = "fxl-web-lang";

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Dict)) cur = (cur as Dict)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

function detect(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && own[saved]) return saved;
  } catch {}
  const nav = (navigator.language || "en").slice(0, 2).toLowerCase();
  return own[nav] ? nav : "en";
}

class I18n {
  lang = $state(detect());
  launcher = $state.raw<Record<string, Dict>>({});

  constructor() {
    document.documentElement.lang = this.lang;
  }

  set(code: string) {
    if (!own[code]) return;
    this.lang = code;
    document.documentElement.lang = code;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {}
  }

  t(key: string, params?: Record<string, string | number>): string {
    const raw =
      lookup(own[this.lang], key) ?? lookup(this.launcher[this.lang], key) ?? lookup(own.en, key) ?? lookup(this.launcher.en, key) ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? String(params[name]) : m));
  }

  time(value: number): string {
    return new Intl.DateTimeFormat(this.lang, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  }

  dateTime(value: number): string {
    return new Intl.DateTimeFormat(this.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
}

export const i18n = new I18n();

export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

export function tm(m: Msg): string {
  return i18n.t(m.key, m.params);
}
