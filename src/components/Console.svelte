<script lang="ts">
  import { tick } from "svelte";
  import { store } from "../lib/store.svelte";
  import { i18n, t, tm } from "../lib/i18n.svelte";
  import { fivemToAnsi, highlight, parseAnsi, type Segment } from "../lib/ansi";
  import type { LogLine } from "../lib/types";
  import Icon from "./Icon.svelte";
  import { hscroll } from "../lib/motion";

  let { id, status, tx }: { id: string; status: string; tx: string } = $props();

  const RENDER_LIMIT = 1500;
  const FIXED = ["server", "txadmin", "launcher"];
  let scroller = $state<HTMLDivElement>();
  let stick = $state(true);
  let filter = $state("");
  let source = $state("all");
  let command = $state("");
  let sending = $state(false);
  let showTime = $state(false);
  const cache = new Map<string, Segment[]>();
  const canWrite = $derived(store.can("console.write"));

  const all = $derived(store.logs[id] ?? []);

  const sources = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const l of all) counts.set(l.source || "launcher", (counts.get(l.source || "launcher") ?? 0) + 1);
    const macros = [...counts.keys()].filter((s) => s.startsWith("macro:"));
    return [...FIXED.filter((s) => counts.has(s) || s === "server"), ...macros].map((s) => ({ id: s, count: counts.get(s) ?? 0 }));
  });

  function label(s: string) {
    return s.startsWith("macro:") ? s.slice(6) : t(`console.sources.${s}`);
  }

  function text(l: LogLine) {
    return l.msg ? tm(l.msg) : l.text;
  }

  const visible = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    const out: LogLine[] = [];
    for (let i = all.length - 1; i >= 0 && out.length < RENDER_LIMIT; i--) {
      const l = all[i];
      if (source !== "all" && (l.source || "launcher") !== source) continue;
      if (q && !text(l).toLowerCase().includes(q)) continue;
      out.push(l);
    }
    return out.reverse();
  });

  function key(l: LogLine) {
    return `${l.ts}:${l.seq}`;
  }

  function segments(l: LogLine): Segment[] {
    const k = key(l);
    let s = cache.get(k);
    if (!s) {
      if (cache.size > 9000) cache.clear();
      s = highlight(parseAnsi(fivemToAnsi(l.text)));
      cache.set(k, s);
    }
    return s;
  }

  $effect(() => {
    visible.length;
    if (!stick) return;
    tick().then(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  });

  function onScroll() {
    if (scroller) stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  }

  function jump() {
    stick = true;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || sending) return;
    sending = true;
    try {
      const ok = await store.act("send_console_command", { server: id, command: cmd, waitMs: 0 });
      if (ok !== undefined) {
        command = "";
        jump();
      }
    } finally {
      sending = false;
    }
  }
</script>

<div class="console">
  <div class="sources" role="tablist" use:hscroll>
    <button role="tab" class:on={source === "all"} aria-selected={source === "all"} onclick={() => (source = "all")}>{t("console.sources.all")}<span class="n">{all.length}</span></button>
    {#each sources as s (s.id)}
      <button role="tab" class:on={source === s.id} aria-selected={source === s.id} class="src-{s.id.startsWith('macro:') ? 'macro' : s.id}" onclick={() => (source = s.id)}>
        <span class="sd"></span><span class="sl">{label(s.id)}</span><span class="n">{s.count}</span>
      </button>
    {/each}
  </div>
  <div class="bar">
    <div class="search"><Icon name="search" size={14} /><input placeholder={t("console.filter")} bind:value={filter} /></div>
    <span class="spacer"></span>
    <button class="btn ghost sm icon" class:on={showTime} title={t("console.timestamps")} onclick={() => (showTime = !showTime)}><Icon name="clock" /></button>
  </div>
  <div class="scroll" bind:this={scroller} onscroll={onScroll} data-lenis-prevent role="log">
    {#if !all.length}
      <div class="placeholder"><Icon name="terminal" size={28} /><p>{status === "stopped" ? t("console.stopped") : t("console.waiting")}</p></div>
    {/if}
    {#each visible as l (key(l))}
      <div class="ln {l.kind}">
        {#if showTime}<span class="ts">{i18n.time(l.ts)}</span>{/if}
        {#if source === "all" && (l.source || "").startsWith("macro:")}<span class="tag">{label(l.source)}</span>{/if}
        {#if l.msg}
          <span class="msg">{#if l.kind === "step"}▸ {/if}{tm(l.msg)}</span>
        {:else}
          <span>{#each segments(l) as s}<span class:b={s.bold} class:d={s.dim} class={s.fg ? `c-${s.fg}` : ""}>{s.text}</span>{/each}</span>
        {/if}
      </div>
    {/each}
  </div>
  {#if !stick}<button class="jump" onclick={jump}><Icon name="arrowDown" size={14} />{t("console.jump")}</button>{/if}
  {#if canWrite}
    <form class="input-row" onsubmit={send}>
      <span class="txs {tx}">txAdmin</span>
      <span class="prompt">&gt;</span>
      <input bind:value={command} disabled={tx !== "connected"} spellcheck="false" autocomplete="off" placeholder={tx === "connected" ? t("console.placeholder") : t("console.txOffline")} />
      <button class="btn sm accent" type="submit" disabled={tx !== "connected" || !command.trim() || sending}><Icon name="send" />{t("console.send")}</button>
    </form>
  {:else}
    <div class="readonly"><Icon name="eye" size={13} />{t("console.readOnly")}</div>
  {/if}
</div>

<style>
  .console {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    border-radius: var(--radius);
    background: var(--term-bg);
    color: var(--term-fg);
    border: 1px solid var(--term-line);
    overflow: hidden;
  }
  .sources {
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--term-line);
    scrollbar-width: none;
    --fade-l: 0px;
    --fade-r: 0px;
    mask-image: linear-gradient(to right, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
  }
  .sources:global(.fade-l) {
    --fade-l: 36px;
  }
  .sources:global(.fade-r) {
    --fade-r: 36px;
  }
  .sources button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    max-width: 240px;
    height: 30px;
    padding: 0 11px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--term-dim);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .sources button.on {
    color: var(--term-fg);
    border-bottom-color: #e2b65a;
    background: rgba(255, 255, 255, 0.05);
  }
  .sl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sd {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #9aa1ae;
    flex: none;
  }
  .src-server .sd {
    background: #4cc983;
  }
  .src-txadmin .sd {
    background: #6f9bff;
  }
  .src-launcher .sd {
    background: #e2b65a;
  }
  .src-macro .sd {
    background: #d68cf5;
  }
  .n {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--term-dim);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px 7px 10px;
    border-bottom: 1px solid var(--term-line);
  }
  .bar .btn {
    color: var(--term-dim);
  }
  .bar .btn.on {
    color: var(--term-fg);
    background: rgba(255, 255, 255, 0.07);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    width: 240px;
    max-width: 100%;
  }
  .search :global(svg) {
    position: absolute;
    left: 8px;
    color: var(--term-dim);
  }
  .search input {
    width: 100%;
    height: 28px;
    padding: 0 8px 0 28px;
    border-radius: 6px;
    border: 1px solid var(--term-line);
    background: rgba(255, 255, 255, 0.04);
    color: var(--term-fg);
    font: inherit;
    font-size: 12.5px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 0 14px;
    font-family: var(--mono);
    font-size: 12.5px;
    line-height: 1.55;
  }
  .ln {
    display: flex;
    gap: 10px;
    padding: 0 14px;
    white-space: pre-wrap;
    word-break: break-word;
    border-left: 2px solid transparent;
  }
  .ts {
    flex: none;
    color: var(--term-dim);
  }
  .tag {
    flex: none;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    height: 18px;
    line-height: 18px;
    margin-top: 1px;
    color: #e6b0ff;
    background: rgba(214, 140, 245, 0.12);
    font-family: var(--font);
    font-weight: 600;
  }
  .ln.err {
    color: #ff9a93;
    border-left-color: rgba(255, 107, 98, 0.6);
    background: rgba(255, 107, 98, 0.05);
  }
  .ln.sys .msg {
    color: #e2c27a;
  }
  .ln.step {
    margin-top: 6px;
    color: #f0c873;
    font-weight: 650;
    border-left-color: #e2b65a;
  }
  .ln.cmd {
    color: #a9c3ff;
    font-weight: 600;
  }
  .b {
    font-weight: 700;
  }
  .d {
    opacity: 0.65;
  }
  .c-black { color: #6f7684; }
  .c-red { color: #ff6b62; }
  .c-green { color: #4cc983; }
  .c-yellow { color: #f0c45c; }
  .c-blue { color: #6f9bff; }
  .c-magenta { color: #d68cf5; }
  .c-cyan { color: #4fd1d9; }
  .c-white { color: #e7e9ee; }
  .c-bright-black { color: #8b92a0; }
  .c-bright-red { color: #ff8f88; }
  .c-bright-green { color: #7ee2a8; }
  .c-bright-yellow { color: #ffd97a; }
  .c-bright-blue { color: #9dbbff; }
  .c-bright-magenta { color: #e6b0ff; }
  .c-bright-cyan { color: #8ae8ee; }
  .c-bright-white { color: #ffffff; }
  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 70px 20px;
    color: var(--term-dim);
    font-family: var(--font);
  }
  .jump {
    position: absolute;
    right: 18px;
    bottom: 62px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid rgba(226, 182, 90, 0.4);
    background: #1b1e24;
    color: #f0c873;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 10px;
    border-top: 1px solid var(--term-line);
  }
  .txs {
    font-size: 11.5px;
    font-weight: 650;
    padding: 3px 8px;
    border-radius: 999px;
    color: #8b92a0;
    background: rgba(255, 255, 255, 0.05);
  }
  .txs.connected {
    color: #4cc983;
    background: rgba(76, 201, 131, 0.12);
  }
  .prompt {
    font-family: var(--mono);
    color: #e2b65a;
    font-weight: 700;
  }
  .input-row input {
    flex: 1;
    min-width: 80px;
    height: 30px;
    border: 0;
    background: transparent;
    color: var(--term-fg);
    font-family: var(--mono);
    font-size: 13px;
  }
  .input-row input:focus {
    outline: none;
  }
  @media (max-width: 700px) {
    .tag,
    .prompt,
    .txs {
      display: none;
    }
  }
  .readonly {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    border-top: 1px solid var(--term-line);
    color: var(--term-dim);
    font-size: 12.5px;
  }
</style>
