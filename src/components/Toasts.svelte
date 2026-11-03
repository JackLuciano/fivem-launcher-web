<script lang="ts">
  import { store } from "../lib/store.svelte";
  import Icon from "./Icon.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each store.toasts as toast (toast.id)}
    <div class="toast {toast.kind}">
      <Icon name={toast.kind === "error" ? "alert" : toast.kind === "info" ? "info" : "check"} size={15} />
      <span>{toast.text}</span>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    max-width: min(420px, calc(100vw - 32px));
  }
  .toast {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 14px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
    animation: pop 0.35s ease-out;
  }
  .toast.success :global(svg) {
    color: var(--ok);
  }
  .toast.error {
    border-color: var(--err);
  }
  .toast.error :global(svg) {
    color: var(--err);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
</style>
