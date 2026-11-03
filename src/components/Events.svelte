<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { i18n, t } from "../lib/i18n.svelte";
  import type { TxEvent } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { id }: { id: string } = $props();

  const KINDS = ["all", "join", "leave", "death", "chat", "admin", "other"] as const;
  type Kind = (typeof KINDS)[number];
  let kind = $state<Kind>("all");
  let query = $state("");

  const live = $derived(store.live[id]);

  function kindOf(e: TxEvent): Exclude<Kind, "all"> {
    switch (e.kind) {
      case "playerJoining":
      case "playerJoinDenied":
        return "join";
      case "playerDropped":
        return "leave";
      case "DeathNotice":
        return "death";
      case "ChatMessage":
        return "chat";
      case "MenuEvent":
      case "CommandExecuted":
      case "LoggerStarted":
        return "admin";
      default:
        return "other";
    }
  }

  const events = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return (live?.events ?? [])
      .filter((e) => (kind === "all" || kindOf(e) === kind) && (!q || `${e.src} ${e.msg}`.toLowerCase().includes(q)))
      .slice()
      .reverse();
  });
</script>

<section class="card">
  <div class="card-head"><div><h2>{t("events.title")}</h2><p class="hint">{t("events.hint")}</p></div></div>
  <div class="card-body stack">
    <div class="row">
      <div class="tabs">
        {#each KINDS as k}<button class:on={kind === k} onclick={() => (kind = k)}>{t(`events.kinds.${k}`)}</button>{/each}
      </div>
      <input class="input grow" placeholder={t("events.search")} bind:value={query} />
    </div>
    {#if !events.length}
      <div class="empty small"><div class="glyph"><Icon name="clock" size={22} /></div><p>{live?.events?.length ? t("common.noMatch") : t("events.none")}</p></div>
    {:else}
      <ol class="events">
        {#each events as e, i (`${e.ts}-${i}`)}
          <li class="k-{kindOf(e)}">
            <span class="when tnum">{i18n.time(e.ts)}</span>
            <span class="chip">{t(`events.kinds.${kindOf(e)}`)}</span>
            <span class="src">{e.src}{#if e.srcId !== null}<span class="tnum"> #{e.srcId}</span>{/if}</span>
            <span class="msg">{e.msg}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
</section>

<style>
  .grow {
    flex: 1;
    min-width: 180px;
  }
  .events {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 64vh;
    overflow: auto;
  }
  .events li {
    display: grid;
    grid-template-columns: 76px 74px minmax(100px, 180px) 1fr;
    gap: 10px;
    align-items: baseline;
    padding: 6px 4px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .when {
    color: var(--muted);
    font-size: 12px;
  }
  .src {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .msg {
    word-break: break-word;
  }
  .k-join .chip {
    color: var(--ok);
  }
  .k-leave .chip,
  .k-death .chip {
    color: var(--err);
  }
  .empty.small {
    padding: 24px;
  }
  @media (max-width: 700px) {
    .events li {
      grid-template-columns: 64px 1fr;
    }
    .events .chip {
      display: none;
    }
  }
</style>
