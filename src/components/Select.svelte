<script lang="ts" module>
  let seq = 0;
</script>

<script lang="ts" generics="T extends string">
  import { tick } from "svelte";
  import { popIn } from "../lib/motion";
  import Icon from "./Icon.svelte";

  type Option = { value: T; label: string };

  let {
    value = $bindable(),
    options,
    disabled = false,
    size = "md",
    ariaLabel,
    title,
    onchange,
  }: {
    value: T;
    options: Option[];
    disabled?: boolean;
    size?: "sm" | "md";
    ariaLabel?: string;
    title?: string;
    onchange?: (value: T) => void;
  } = $props();

  const uid = `fxl-select-${++seq}`;
  let trigger = $state<HTMLButtonElement>();
  let list = $state<HTMLDivElement>();
  let open = $state(false);
  let active = $state(0);
  let place = $state({ left: 0, width: 0, top: 0 as number | null, bottom: null as number | null, maxHeight: 280 });

  const current = $derived(options.find((o) => o.value === value));

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function measure() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const wanted = Math.min(280, options.length * 32 + 10);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < wanted && above > below;
    place = {
      left: r.left,
      width: Math.max(r.width, 140),
      top: up ? null : r.bottom + 4,
      bottom: up ? window.innerHeight - r.top + 4 : null,
      maxHeight: Math.max(120, Math.min(280, up ? above : below)),
    };
  }

  async function show() {
    if (disabled || open) return;
    measure();
    active = Math.max(0, options.findIndex((o) => o.value === value));
    open = true;
    await tick();
    list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function hide(refocus = false) {
    open = false;
    if (refocus) trigger?.focus();
  }

  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    hide(true);
    if (o.value === value) return;
    value = o.value;
    onchange?.(o.value);
  }

  function move(to: number) {
    active = Math.max(0, Math.min(options.length - 1, to));
    list?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(options.length - 1);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Escape") hide(true);
    else if (e.key === "Tab") return hide();
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const at = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const first = options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (at >= 0 || first >= 0) move(at >= 0 ? at : first);
    } else return;
    e.preventDefault();
  }

  $effect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!trigger?.contains(target) && !list?.contains(target)) hide();
    };
    const scrolled = (e: Event) => {
      if (!list?.contains(e.target as Node)) hide();
    };
    const resized = () => hide();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", resized);
    };
  });
</script>

<button
  bind:this={trigger}
  type="button"
  class="trigger {size}"
  class:open
  {disabled}
  {title}
  role="combobox"
  aria-label={ariaLabel}
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-controls={uid}
  aria-activedescendant={open ? `${uid}-${active}` : undefined}
  onclick={() => (open ? hide() : show())}
  onkeydown={onKey}
>
  <span class="label">{current?.label ?? ""}</span>
  <span class="chev"><Icon name="down" size={14} /></span>
</button>

{#if open}
  <div
    bind:this={list}
    use:portal
    use:popIn
    id={uid}
    class="menu"
    role="listbox"
    tabindex="-1"
    aria-label={ariaLabel}
    data-lenis-prevent
    style:left="{place.left}px"
    style:width="{place.width}px"
    style:top={place.top === null ? null : `${place.top}px`}
    style:bottom={place.bottom === null ? null : `${place.bottom}px`}
    style:max-height="{place.maxHeight}px"
  >
    {#each options as o, i (o.value)}
      <div
        id="{uid}-{i}"
        data-i={i}
        class="option"
        class:on={i === active}
        class:current={o.value === value}
        role="option"
        aria-selected={o.value === value}
        tabindex="-1"
        onpointerenter={() => (active = i)}
        onpointerdown={(e) => e.preventDefault()}
        onclick={() => pick(i)}
        onkeydown={onKey}
      >
        <span>{o.label}</span>
        {#if o.value === value}<Icon name="check" size={13} />{/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 8px 0 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .trigger.sm {
    height: 30px;
    font-size: 12.5px;
  }
  .trigger:hover:not(:disabled) {
    border-color: var(--line-hover);
  }
  .trigger:focus-visible,
  .trigger.open {
    outline: none;
    border-color: var(--ink-2);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
  .trigger:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chev {
    display: grid;
    place-items: center;
    color: var(--faint);
    transition: transform 0.2s ease;
  }
  .trigger.open .chev {
    transform: rotate(180deg);
  }
  .menu {
    position: fixed;
    z-index: 1000;
    overflow: auto;
    padding: 4px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: 13px;
  }
  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 9px;
    border-radius: 6px;
    color: var(--ink-2);
    cursor: pointer;
    user-select: none;
  }
  .option.on {
    background: var(--tint);
    color: var(--ink);
  }
  .option.current {
    color: var(--accent-ink);
    font-weight: 600;
  }
</style>
