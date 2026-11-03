<script lang="ts">
  import { onDestroy } from "svelte";
  import { store } from "../lib/store.svelte";
  import { t, tm } from "../lib/i18n.svelte";
  import { smoothScroll } from "../lib/motion";
  import type { Msg } from "../lib/types";
  import Icon from "../components/Icon.svelte";
  import StatusPill from "../components/StatusPill.svelte";
  import Console from "../components/Console.svelte";
  import Players from "../components/Players.svelte";
  import Health from "../components/Health.svelte";
  import Events from "../components/Events.svelte";
  import Git from "../components/Git.svelte";
  import Config from "../components/Config.svelte";

  let { id, initialTab }: { id: string; initialTab?: string } = $props();

  const ALL_TABS = [
    { id: "console", icon: "terminal", perm: "console.read" },
    { id: "players", icon: "users", perm: "players.view" },
    { id: "health", icon: "activity", perm: "health.view" },
    { id: "events", icon: "clock", perm: "actionlog.view" },
    { id: "git", icon: "branch", perm: "servers.view" },
    { id: "config", icon: "file", perm: "config.view" },
  ];

  const tabs = $derived(ALL_TABS.filter((x) => store.can(x.perm)));
  let tab = $state("");
  $effect(() => {
    if (!tabs.some((x) => x.id === tab)) tab = tabs.find((x) => x.id === initialTab)?.id ?? tabs[0]?.id ?? "";
  });

  const server = $derived(store.server(id));
  const rt = $derived(store.runtime(id));
  const live = $derived(store.live[id]);
  const active = $derived(rt.status === "preparing" || rt.status === "running" || rt.status === "stopping");

  $effect(() => {
    store.watch(id);
  });
  onDestroy(() => store.unwatch(id));

  function pick(next: string) {
    tab = next;
    store.go({ name: "server", id, tab: next });
  }
</script>

{#if !server}
  <div class="page">
    <div class="content">
      <div class="notice"><Icon name="info" /><div>{t("server.missing")}</div></div>
      <button class="btn" onclick={() => store.go({ name: "servers" })}><Icon name="back" />{t("nav.servers")}</button>
    </div>
  </div>
{:else}
  <div class="detail">
    <header class="head">
      <div class="title-row">
        <button class="back" onclick={() => store.go({ name: "servers" })}><Icon name="back" size={14} />{t("nav.servers")}</button>
      </div>
      <div class="title-row">
        <div class="titles">
          <h1>{server.name}</h1>
          <div class="chips">
            <StatusPill status={rt.status} />
            <span class="chip mono"><Icon name="branch" size={12} />{server.branch}</span>
            <span class="chip">{t(`modes.${server.mode}`)}</span>
            <span class="chip mono">:{server.fxsPort}</span>
            {#if live?.players && rt.status === "running"}<span class="chip"><Icon name="users" size={12} />{live.players.length}{live.maxPlayers ? `/${live.maxPlayers}` : ""}</span>{/if}
          </div>
          {#if rt.step}<p class="step">{tm(rt.step as Msg)}</p>{/if}
        </div>
        <div class="actions">
          {#if store.can("git")}
            <button class="btn" disabled={active} onclick={() => store.act("git_pull", { server: id }, t("server.pullStarted"))}><Icon name="download" />{t("server.pull")}</button>
          {/if}
          {#if store.can("servers.control")}
            {#if active}
              <button class="btn" disabled={rt.status !== "running"} onclick={() => store.act("restart_server", { server: id }, t("server.restarting"))}><Icon name="refresh" />{t("server.restart")}</button>
              <button class="btn danger" disabled={rt.status === "stopping"} onclick={() => store.act("stop_server", { server: id }, t("server.stopping"))}><Icon name="stop" />{t("server.stop")}</button>
            {:else}
              <button class="btn ok" onclick={() => store.act("start_server", { server: id }, t("server.starting"))}><Icon name="play" />{t("server.start")}</button>
            {/if}
          {/if}
        </div>
      </div>
      {#if tabs.length}
        <div class="tabs">
          {#each tabs as x (x.id)}
            <button class:on={tab === x.id} onclick={() => pick(x.id)}><Icon name={x.icon} size={14} />{t(`server.tabs.${x.id}`)}</button>
          {/each}
        </div>
      {/if}
    </header>

    {#if tab === "console"}
      <div class="console-fill"><Console {id} status={rt.status} tx={rt.tx} /></div>
    {:else}
      <div class="page body" data-scroller use:smoothScroll>
        <div class="content">
          {#if tab === "players"}
            <Players {id} running={rt.status === "running"} />
          {:else if tab === "health"}
            <Health {id} running={rt.status === "running"} />
          {:else if tab === "events"}
            <Events {id} />
          {:else if tab === "git"}
            <Git {id} {active} />
          {:else if tab === "config"}
            <Config {id} />
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .detail {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 24px 0;
  }
  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: none;
    padding: 0;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .titles h1 {
    margin: 0 0 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .step {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .console-fill {
    flex: 1;
    min-height: 420px;
    padding: 14px 24px 20px;
    display: flex;
    flex-direction: column;
  }
  .body {
    flex: 1;
  }
  @media (max-width: 900px) {
    .head {
      padding: 14px 16px 0;
    }
    .console-fill {
      padding: 12px 16px 16px;
    }
    .tabs {
      overflow-x: auto;
    }
  }
</style>
