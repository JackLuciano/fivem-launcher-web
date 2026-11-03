<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { t } from "../lib/i18n.svelte";
  import Icon from "./Icon.svelte";

  let { id, running }: { id: string; running: boolean } = $props();

  const live = $derived(store.live[id]);
  const manage = $derived(store.can("resources.manage"));
  let history = $state<number[]>([]);
  let lastUpdate = 0;
  let query = $state("");
  let newResource = $state("");

  $effect(() => {
    const l = live;
    if (!l?.tick || l.updated === lastUpdate) return;
    lastUpdate = l.updated;
    history = [...history.slice(-59), l.tick.mainMs];
  });

  const resources = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = live?.resources ?? [];
    return q ? list.filter((r) => r.toLowerCase().includes(q)) : list;
  });

  const spark = $derived.by(() => {
    if (history.length < 2) return "";
    const max = Math.max(16, ...history);
    return history.map((v, i) => `${(i / (history.length - 1)) * 100},${30 - (v / max) * 28}`).join(" ");
  });

  function uptime(ms: number | null | undefined) {
    if (!ms || ms < 0) return "–";
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  }

  function tickClass(ms: number) {
    return ms < 8 ? "ok" : ms < 16 ? "warn" : "err";
  }

  function resource(action: string, name: string) {
    store.act("resource_action", { server: id, action, resource: name }, t("health.sent", { action: t(`health.actions.${action}`), name }));
  }
</script>

{#if !running || !live}
  <section class="card"><div class="empty small"><div class="glyph"><Icon name="activity" size={22} /></div><p>{running ? t("common.waiting") : t("common.offline")}</p></div></section>
{:else}
  <div class="stats">
    <div class="stat card"><span class="eyebrow">{t("health.uptime")}</span><strong class="tnum">{uptime(live.uptimeMs)}</strong></div>
    <div class="stat card">
      <span class="eyebrow">{t("health.health")}</span>
      <strong class:ok={live.health === "ONLINE"} class:err={!!live.health && live.health !== "ONLINE"}>{live.health || "–"}</strong>
      {#if live.healthReason}<span class="hint">{live.healthReason}</span>{/if}
    </div>
    <div class="stat card"><span class="eyebrow">{t("players.title")}</span><strong class="tnum">{live.players?.length ?? "–"}{live.maxPlayers ? ` / ${live.maxPlayers}` : ""}</strong></div>
    <div class="stat card"><span class="eyebrow">{t("health.resources")}</span><strong class="tnum">{live.resources?.length ?? 0}</strong></div>
  </div>

  <section class="card">
    <div class="card-head"><div><h2>{t("health.tick")}</h2><p class="hint">{t("health.tickHint")}</p></div></div>
    <div class="card-body">
      {#if live.tick}
        <div class="ticks">
          {#each [["svMain", live.tick.mainMs], ["svNetwork", live.tick.networkMs], ["svSync", live.tick.syncMs]] as const as [name, ms]}
            <div class="tick {tickClass(ms)}"><span class="mono">{name}</span><strong class="tnum">{ms.toFixed(2)} ms</strong></div>
          {/each}
          <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">{#if spark}<polyline points={spark} />{/if}</svg>
        </div>
      {:else}
        <p class="hint">{t("common.waiting")}</p>
      {/if}
    </div>
  </section>

  <section class="card">
    <div class="card-head"><div><h2>{t("health.resources")}</h2><p class="hint">{t("health.resourcesHint")}</p></div></div>
    <div class="card-body stack">
      <div class="row">
        <input class="input" placeholder={t("health.search")} bind:value={query} />
        {#if manage}
          <input class="input mono" placeholder={t("health.name")} bind:value={newResource} />
          <button class="btn" disabled={!newResource.trim()} onclick={() => resource("ensure", newResource.trim())}><Icon name="play" />{t("health.actions.ensure")}</button>
        {/if}
      </div>
      <div class="res-list">
        {#each resources as r (r)}
          <div class="res">
            <span class="mono">{r}</span>
            {#if manage}
              <button class="btn ghost sm" onclick={() => resource("restart", r)}><Icon name="refresh" />{t("health.actions.restart")}</button>
              <button class="btn ghost sm danger" onclick={() => resource("stop", r)}><Icon name="stop" />{t("health.actions.stop")}</button>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </section>
{/if}

<style>
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 16px;
  }
  .stat strong {
    font-size: 20px;
  }
  .stat strong.ok {
    color: var(--ok);
  }
  .stat strong.err {
    color: var(--err);
  }
  .ticks {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) 2fr;
    gap: 12px;
  }
  .tick {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 9px;
    border: 1px solid var(--line);
  }
  .tick span {
    font-size: 12px;
    color: var(--muted);
  }
  .tick.ok strong {
    color: var(--ok);
  }
  .tick.warn strong {
    color: var(--warn);
  }
  .tick.err strong {
    color: var(--err);
  }
  .spark {
    width: 100%;
    height: 64px;
    border-radius: 9px;
    background: var(--tint);
  }
  .spark polyline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .res-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 4px 16px;
  }
  .res {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 0;
    border-bottom: 1px solid var(--line);
  }
  .res span {
    flex: 1;
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty.small {
    padding: 24px;
  }
  @media (max-width: 900px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .ticks {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .spark {
      grid-column: 1 / -1;
    }
  }
</style>
