<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { LivePlayer } from "../lib/types";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";

  let { id, running }: { id: string; running: boolean } = $props();

  type Action = "message" | "warn" | "kick" | "ban";
  const DURATIONS = ["1 hour", "6 hours", "1 day", "3 days", "1 week", "2 weeks", "1 month", "permanent"];

  let query = $state("");
  let open = $state<{ id: number; action: Action } | null>(null);
  let text = $state("");
  let duration = $state("1 day");
  let busy = $state(false);

  const live = $derived(store.live[id]);
  const manage = $derived(store.can("players.manage"));
  const ban = $derived(store.can("players.ban"));
  const players = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = live?.players ?? [];
    return q ? list.filter((p) => `${p.id} ${p.name} ${p.license ?? ""} ${(p.identifiers ?? []).join(" ")}`.toLowerCase().includes(q)) : list;
  });

  function start(p: LivePlayer, action: Action) {
    open = open?.id === p.id && open.action === action ? null : { id: p.id, action };
    text = "";
  }

  async function submit(p: LivePlayer) {
    if (!open || (open.action === "message" && !text.trim())) return;
    busy = true;
    try {
      const result = await store.act(
        "player_action",
        { server: id, action: open.action, playerId: p.id, text: text.trim(), duration: open.action === "ban" ? duration : "" },
        t(`players.done.${open.action}`, { name: p.name }),
      );
      if (result !== undefined) open = null;
    } finally {
      busy = false;
    }
  }

  function pingClass(ping: number) {
    return ping < 80 ? "ok" : ping < 160 ? "warn" : "err";
  }
</script>

<section class="card">
  <div class="card-head">
    <div><h2>{t("players.title")}</h2><p class="hint">{t("players.hint")}</p></div>
    <span class="pill tnum {live?.online ? 'ok' : ''}">{live?.players?.length ?? 0}{live?.maxPlayers ? ` / ${live.maxPlayers}` : ""}</span>
  </div>
  <div class="card-body stack">
    {#if !running || !live?.online}
      <div class="empty small"><div class="glyph"><Icon name="users" size={22} /></div><p>{running ? t("common.waiting") : t("common.offline")}</p></div>
    {:else}
      <input class="input search" placeholder={t("players.search")} bind:value={query} />
      {#if !players.length}<p class="hint">{live.players?.length ? t("common.noMatch") : t("players.none")}</p>{/if}
      <div class="list">
        {#each players as p, i (p.id || `anon-${i}`)}
          <div class="player">
            <span class="pid tnum">#{p.id}</span>
            <div class="who"><strong>{p.name}</strong>{#if p.license}<span class="mono lic">{p.license}</span>{/if}</div>
            <span class="ping tnum {pingClass(p.ping)}">{p.ping} ms</span>
            <div class="acts">
              {#if manage && p.id}
                <button class="btn ghost sm icon" title={t("players.actions.message")} onclick={() => start(p, "message")}><Icon name="message" /></button>
                <button class="btn ghost sm icon" title={t("players.actions.warn")} onclick={() => start(p, "warn")}><Icon name="alert" /></button>
                <button class="btn ghost sm icon" title={t("players.actions.kick")} onclick={() => start(p, "kick")}><Icon name="logout" /></button>
              {/if}
              {#if ban && p.id}<button class="btn ghost sm icon danger" title={t("players.actions.ban")} onclick={() => start(p, "ban")}><Icon name="ban" /></button>{/if}
            </div>
          </div>
          {#if open?.id === p.id}
            <div class="form">
              <span class="pill {open.action === 'ban' || open.action === 'kick' ? 'err' : 'accent'}">{t(`players.actions.${open.action}`)}</span>
              <input class="input" placeholder={open.action === "message" ? t("players.messagePlaceholder") : t("players.reasonPlaceholder")} bind:value={text} />
              {#if open.action === "ban"}
                <div class="duration">
                  <Select size="sm" ariaLabel={t("players.duration")} bind:value={duration} options={DURATIONS.map((d) => ({ value: d, label: t(`players.durations.${d.replace(" ", "_")}`) }))} />
                </div>
              {/if}
              <button class="btn sm {open.action === 'ban' || open.action === 'kick' ? 'danger' : 'primary'}" disabled={busy || (open.action === "message" && !text.trim())} onclick={() => submit(p)}>{t(`players.actions.${open.action}`)}</button>
              <button class="btn ghost sm" onclick={() => (open = null)}>{t("common.cancel")}</button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .search {
    max-width: 320px;
  }
  .list {
    display: flex;
    flex-direction: column;
  }
  .player {
    display: grid;
    grid-template-columns: 56px 1fr 80px auto;
    align-items: center;
    gap: 12px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--line);
  }
  .pid {
    color: var(--muted);
    font-size: 12.5px;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .lic {
    font-size: 11px;
    color: var(--faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ping {
    font-size: 12.5px;
    font-weight: 600;
  }
  .ping.ok {
    color: var(--ok);
  }
  .ping.warn {
    color: var(--warn);
  }
  .ping.err {
    color: var(--err);
  }
  .acts {
    display: flex;
    gap: 2px;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 4px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
  }
  .form .input {
    flex: 1;
    min-width: 160px;
  }
  .duration {
    width: 140px;
    flex: none;
  }
  .empty.small {
    padding: 24px;
  }
  @media (max-width: 700px) {
    .player {
      grid-template-columns: 44px 1fr auto;
    }
    .ping {
      display: none;
    }
  }
</style>
