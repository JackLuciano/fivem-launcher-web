<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { RepoStatus } from "../lib/types";
  import BranchPicker from "./BranchPicker.svelte";
  import Icon from "./Icon.svelte";

  let { id, active }: { id: string; active: boolean } = $props();

  let repos = $state<RepoStatus[] | null>(null);
  let loading = $state(false);
  let editing = $state<string | null>(null);
  let branch = $state("");
  let pending = $state(false);
  let sawActive = false;
  const canGit = $derived(store.can("git"));

  async function load(fetch: boolean) {
    loading = true;
    try {
      repos = await api.action<RepoStatus[]>("git_status", { server: id, fetch });
    } catch (e) {
      store.toast(store.errorText(e), "error");
    } finally {
      loading = false;
    }
  }

  onMount(() => load(false));

  $effect(() => {
    if (!pending) return;
    if (active) sawActive = true;
    else if (sawActive) {
      pending = false;
      sawActive = false;
      load(false);
    }
  });

  function edit(r: RepoStatus) {
    editing = editing === r.id ? null : r.id;
    branch = "";
  }

  async function switchBranch(r: RepoStatus) {
    const b = branch.trim();
    if (!b || b === r.info.branch) return;
    const label = r.label || r.path;
    const ok = await store.act("git_switch_branch", { server: id, repo: r.id, branch: b }, t("git.switching", { repo: label, branch: b }));
    if (ok !== undefined) {
      editing = null;
      branch = "";
      pending = true;
    }
  }
</script>

<section class="card">
  <div class="card-head">
    <div><h2>{t("git.title")}</h2><p class="hint">{t("git.hint")}</p></div>
    <button class="btn sm" disabled={loading} onclick={() => load(true)}><Icon name="refresh" />{t("git.fetch")}</button>
  </div>
  <div class="card-body stack">
    {#if !repos}
      <div class="skeleton" style="height:90px"></div>
    {:else}
      {#each repos as r (r.id)}
        <div class="repo">
          <div class="line">
            <div class="meta">
              <strong>{r.label || r.path}</strong>
              <span class="mono">{r.path}</span>
            </div>
            {#if r.info.cloned}
              <span class="chip mono"><Icon name="branch" size={12} />{r.info.branch}</span>
              <span class="mono commit" title={r.info.subject}>{r.info.commit.slice(0, 8)} · {r.info.subject}</span>
              {#if r.info.behind}<span class="pill warn">↓ {r.info.behind}</span>{/if}
              {#if r.info.ahead}<span class="pill accent">↑ {r.info.ahead}</span>{/if}
              {#if r.info.dirty}<span class="pill">{t("git.dirty", { n: r.info.dirty })}</span>{/if}
            {:else}
              <span class="pill">{t("git.notCloned")}</span>
            {/if}
            {#if r.shared}
              <span class="pill" title={t("git.sharedHint")}><Icon name="link" size={12} />{t("git.shared")}</span>
            {:else if canGit && r.info.cloned}
              <button class="btn ghost sm" class:on={editing === r.id} disabled={active} title={active ? t("git.stopFirst") : ""} onclick={() => edit(r)}>
                <Icon name="branch" />{t("git.change")}
              </button>
            {/if}
          </div>
          {#if editing === r.id && !active}
            <div class="switcher">
              <BranchPicker
                bind:value={branch}
                current={r.info.branch}
                load={() => api.action<string[]>("list_branches", { server: id, repo: r.id })}
                onsubmit={() => switchBranch(r)}
              />
              <button class="btn primary" disabled={!branch.trim() || branch.trim() === r.info.branch} onclick={() => switchBranch(r)}><Icon name="check" />{t("git.switch")}</button>
              <button class="btn ghost" onclick={() => (editing = null)}>{t("common.cancel")}</button>
            </div>
            {#if r.info.dirty}<p class="hint warn-text">{t("git.dirtyWarn", { n: r.info.dirty })}</p>{/if}
          {/if}
        </div>
      {/each}
    {/if}
    {#if canGit}
      <div class="row">
        <button class="btn" disabled={active} onclick={() => store.act("git_pull", { server: id }, t("server.pullStarted"))}><Icon name="download" />{t("server.pull")}</button>
        {#if active}<span class="hint">{t("git.stopFirst")}</span>{/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .repo {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 180px;
  }
  .meta span {
    font-size: 11.5px;
    color: var(--muted);
  }
  .commit {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .switcher {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
  .btn.on {
    background: var(--tint);
  }
  .warn-text {
    margin: 0;
    color: var(--warn);
  }
</style>
