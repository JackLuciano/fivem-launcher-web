<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "../lib/api";
  import { store } from "../lib/store.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { ConfigFile } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { id }: { id: string } = $props();

  let files = $state<ConfigFile[] | null>(null);
  let values = $state<Record<string, Record<string, string>>>({});
  let saved = $state<Record<string, Record<string, string>>>({});
  let open = $state<string | null>(null);
  let saving = $state(false);
  const canEdit = $derived(store.can("config.edit"));

  onMount(async () => {
    try {
      const [scan, row] = await Promise.all([
        api.action<{ files: ConfigFile[] }>("list_config_files", { server: id }),
        api.action<{ configValues?: Record<string, Record<string, string>> }>("get_config_values", { server: id }),
      ]);
      files = scan.files;
      const loaded = row?.configValues ?? {};
      values = structuredClone(loaded);
      saved = structuredClone(loaded);
      open = scan.files[0]?.path ?? null;
    } catch (e) {
      store.toast(store.errorText(e), "error");
      files = [];
    }
  });

  function value(file: string, key: string) {
    return values[file]?.[key] ?? "";
  }

  function set(file: string, key: string, v: string) {
    values[file] ??= {};
    values[file][key] = v;
  }

  function changed(file: string) {
    const now = values[file] ?? {};
    const before = saved[file] ?? {};
    const keys = new Set([...Object.keys(now), ...Object.keys(before)]);
    return [...keys].filter((k) => (now[k] ?? "") !== (before[k] ?? ""));
  }

  async function save(file: string) {
    const keys = changed(file);
    if (!keys.length) return;
    saving = true;
    try {
      const patch = Object.fromEntries(keys.map((k) => [k, values[file]?.[k] ?? ""]));
      const ok = await store.act("set_config_values", { server: id, file, values: patch }, t("config.saved", { file }));
      if (ok !== undefined) {
        saved[file] = { ...(saved[file] ?? {}), ...patch };
        for (const [k, v] of Object.entries(patch)) if (!v) delete saved[file][k];
      }
    } finally {
      saving = false;
    }
  }
</script>

<section class="card">
  <div class="card-head"><div><h2>{t("config.title")}</h2><p class="hint">{canEdit ? t("config.hintEdit") : t("config.hintView")}</p></div></div>
  <div class="card-body stack">
    {#if !files}
      <div class="skeleton" style="height:120px"></div>
    {:else if !files.length}
      <p class="hint">{t("config.none")}</p>
    {:else}
      <div class="tabs files">
        {#each files as f (f.path)}
          <button class:on={open === f.path} onclick={() => (open = f.path)}>
            <span class="mono">{f.path}</span>{#if changed(f.path).length}<span class="dirty"></span>{/if}
          </button>
        {/each}
      </div>
      {#each files.filter((f) => f.path === open) as f (f.path)}
        <div class="fields">
          {#each f.fields as field (field.key)}
            <label class="field">
              <span class="mono">{field.key}{#if field.optional}<em>{t("config.optional")}</em>{/if}</span>
              <input
                class="input mono"
                value={value(f.path, field.key)}
                placeholder={field.templateValue || t("config.empty")}
                readonly={!canEdit || value(f.path, field.key) === "••••••"}
                oninput={(e) => set(f.path, field.key, e.currentTarget.value)}
              />
            </label>
          {/each}
        </div>
        {#if canEdit}
          <div class="row">
            <span class="hint">{t("config.applyHint")}</span>
            <span class="spacer"></span>
            <button class="btn primary" disabled={saving || !changed(f.path).length} onclick={() => save(f.path)}><Icon name="check" />{t("config.save")}</button>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</section>

<style>
  .files {
    flex-wrap: wrap;
  }
  .files button {
    position: relative;
  }
  .dirty {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px 16px;
  }
  .field em {
    margin-left: 8px;
    font-style: normal;
    font-size: 11px;
    color: var(--faint);
  }
</style>
