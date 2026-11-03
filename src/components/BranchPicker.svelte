<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../lib/i18n.svelte";
  import { popIn } from "../lib/motion";
  import Icon from "./Icon.svelte";

  let {
    value = $bindable(),
    current = "",
    load,
    onsubmit,
  }: { value: string; current?: string; load: () => Promise<string[]>; onsubmit?: () => void } = $props();

  let branches = $state<string[]>([]);
  let loading = $state(true);
  let failed = $state(false);
  let open = $state(false);
  let active = $state(0);
  let input = $state<HTMLInputElement>();

  const filtered = $derived.by(() => {
    const q = value.trim().toLowerCase();
    return (q ? branches.filter((b) => b.toLowerCase().includes(q)) : branches).slice(0, 200);
  });

  onMount(async () => {
    input?.focus();
    try {
      branches = await load();
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  });

  function pick(b: string) {
    value = b;
    open = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      open = true;
      active = Math.min(active + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
    } else if (e.key === "Enter") {
      if (open && filtered[active]) pick(filtered[active]);
      else onsubmit?.();
    } else if (e.key === "Escape") {
      open = false;
    } else return;
    e.preventDefault();
  }
</script>

<div class="picker">
  <div class="control">
    <Icon name="branch" />
    <input
      bind:this={input}
      class="input mono"
      bind:value
      placeholder={loading ? t("git.loadingBranches") : t("git.branchPlaceholder")}
      spellcheck="false"
      autocomplete="off"
      onfocus={() => (open = true)}
      onblur={() => setTimeout(() => (open = false), 120)}
      oninput={() => {
        active = 0;
        open = true;
      }}
      onkeydown={onKey}
    />
  </div>
  {#if open && filtered.length}
    <div class="list card" use:popIn data-lenis-prevent>
      {#each filtered as b, i (b)}
        <button type="button" class:on={i === active} class:current={b === current} onmousedown={() => pick(b)}>
          <span class="mono">{b}</span>
          {#if b === current}<span class="hint">{t("git.current")}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if failed}<span class="hint">{t("git.branchesFailed")}</span>{/if}
</div>

<style>
  .picker {
    position: relative;
    flex: 1;
    min-width: 220px;
  }
  .control {
    position: relative;
    display: flex;
    align-items: center;
  }
  .control > :global(svg) {
    position: absolute;
    left: 10px;
    color: var(--faint);
    pointer-events: none;
  }
  .control input {
    padding-left: 32px;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 50;
    max-height: 260px;
    overflow: auto;
    padding: 4px;
    box-shadow: var(--shadow-lg);
  }
  .list button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 9px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
  }
  .list button.on,
  .list button:hover {
    background: var(--tint);
  }
  .list button.current {
    color: var(--accent-ink);
    font-weight: 600;
  }
  .hint {
    font-size: 11.5px;
  }
</style>
