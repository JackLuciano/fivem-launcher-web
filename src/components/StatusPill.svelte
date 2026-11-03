<script lang="ts">
  import { t } from "../lib/i18n.svelte";

  let { status }: { status: string } = $props();
  const kind = $derived(status === "running" ? "ok" : status === "error" ? "err" : status === "stopped" ? "" : "warn");
</script>

<span class="pill {kind}"><span class="dot" class:live={status === "preparing" || status === "stopping"}></span>{t(`status.${status}`)}</span>

<style>
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
</style>
