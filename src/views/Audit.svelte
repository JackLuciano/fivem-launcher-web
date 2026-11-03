<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { i18n, t } from "../lib/i18n.svelte";
  import { reveal, smoothScroll } from "../lib/motion";
  import type { AuditEntry } from "../lib/types";
  import Icon from "../components/Icon.svelte";

  let entries = $state<AuditEntry[] | null>(null);
  let query = $state("");

  async function load() {
    try {
      entries = (await api.audit(500)) as AuditEntry[];
    } catch (e) {
      store.toast(store.errorText(e), "error");
      entries = [];
    }
  }

  onMount(load);

  function actionLabel(action: string) {
    const key = `audit.actions.${action}`;
    const label = t(key);
    return label === key ? action : label;
  }

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = entries ?? [];
    return q ? list.filter((e) => `${e.user} ${e.action} ${e.server ?? ""} ${e.summary}`.toLowerCase().includes(q)) : list;
  });
</script>

<div class="page" data-scroller use:smoothScroll>
  <div class="content" use:reveal={{ selector: ".card", stagger: 0.05 }}>
    <header class="page-head">
      <div><h1>{t("audit.title")}</h1><p class="sub">{t("audit.subtitle")}</p></div>
      <button class="btn" onclick={load}><Icon name="refresh" />{t("audit.refresh")}</button>
    </header>
    <section class="card">
      <div class="card-body stack">
        <input class="input" placeholder={t("audit.search")} bind:value={query} />
        {#if !entries}
          <div class="skeleton" style="height:120px"></div>
        {:else if !shown.length}
          <p class="hint">{t("audit.none")}</p>
        {:else}
          <ol class="log">
            {#each shown as e, i (`${e.ts}-${i}`)}
              <li class:err={!e.ok}>
                <span class="when tnum">{i18n.dateTime(e.ts)}</span>
                <strong>{e.user}</strong>
                <span class="chip">{actionLabel(e.action)}</span>
                <span class="what">{[e.server, e.summary, e.error ? t(e.error) : ""].filter(Boolean).join(" · ")}</span>
                <span class="ip mono">{e.ip}</span>
              </li>
            {/each}
          </ol>
        {/if}
      </div>
    </section>
  </div>
</div>

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .log li {
    display: grid;
    grid-template-columns: 150px 120px 150px 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 7px 4px;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .log li.err .chip {
    color: var(--err);
  }
  .when,
  .ip {
    color: var(--muted);
    font-size: 12px;
  }
  .what {
    word-break: break-word;
  }
  @media (max-width: 900px) {
    .log li {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
