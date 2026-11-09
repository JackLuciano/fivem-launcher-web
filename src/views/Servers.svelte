<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { t, tm } from "../lib/i18n.svelte";
  import { reveal, smoothScroll } from "../lib/motion";
  import type { Msg } from "../lib/types";
  import Icon from "../components/Icon.svelte";
  import StatusPill from "../components/StatusPill.svelte";
</script>

<div class="page" data-scroller use:smoothScroll>
  <div class="content" use:reveal={{ selector: ".srv", stagger: 0.05 }}>
    <header class="page-head">
      <div>
        <h1>{t("servers.title")}</h1>
        <p class="sub">{t("servers.subtitle")}</p>
      </div>
    </header>

    {#if !store.can("servers.view")}
      <div class="notice"><Icon name="info" /><div>{t("servers.noAccess")}</div></div>
    {:else if !store.servers.length}
      <div class="card">
        <div class="empty">
          <div class="glyph"><Icon name="server" size={24} /></div>
          <p>{store.online ? t("servers.empty") : t("app.offlineBanner")}</p>
        </div>
      </div>
    {:else}
      <div class="grid">
        {#each store.servers as s (s.id)}
          {@const rt = store.runtime(s.id)}
          {@const live = store.live[s.id]}
          <button class="card srv" onclick={() => store.go({ name: "server", id: s.id })}>
            <div class="top">
              <strong>{s.name}</strong>
              <StatusPill status={rt.status} />
            </div>
            {#if rt.step}<p class="step">{tm(rt.step as Msg)}</p>{/if}
            <div class="chips">
              {#if store.projects.length > 1 && s.project}<span class="chip"><Icon name="layers" size={12} />{s.project}</span>{/if}
              <span class="chip mono"><Icon name="branch" size={12} />{s.branch}</span>
              <span class="chip">{t(`modes.${s.mode}`)}</span>
              <span class="chip mono">:{s.fxsPort}</span>
              {#if live?.players && rt.status === "running"}<span class="chip"><Icon name="users" size={12} />{live.players.length}{live.maxPlayers ? `/${live.maxPlayers}` : ""}</span>{/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
  }
  .srv {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition:
      border-color 0.2s,
      transform 0.2s;
  }
  .srv:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .top strong {
    font-size: 15px;
  }
  .step {
    margin: 0;
    font-size: 12.5px;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
