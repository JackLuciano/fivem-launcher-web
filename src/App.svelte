<script lang="ts">
  import { onMount } from "svelte";
  import { store } from "./lib/store.svelte";
  import { i18n, LANGUAGES, t } from "./lib/i18n.svelte";
  import { reveal } from "./lib/motion";
  import Icon from "./components/Icon.svelte";
  import Toasts from "./components/Toasts.svelte";
  import Select from "./components/Select.svelte";
  import Login from "./views/Login.svelte";
  import Servers from "./views/Servers.svelte";
  import Server from "./views/Server.svelte";
  import Audit from "./views/Audit.svelte";
  import mark from "./assets/brand/mark.png";

  onMount(() => {
    store.boot();
  });

  const pageKey = $derived(store.page.name === "server" ? `server:${store.page.id}` : store.page.name);
  const running = $derived(store.servers.filter((s) => store.runtime(s.id).status === "running").length);
</script>

{#if !store.ready}
  <div class="boot"><div class="spinner"></div></div>
{:else if !store.me}
  <Login />
{:else}
  <div class="shell">
    <aside class="side">
      <div class="brand">
        <img src={mark} alt="" />
        <div class="lbl">
          <strong class="shiny">{store.project || t("app.name")}</strong>
          <span class="conn" class:on={store.online}><span class="dot"></span>{store.online ? t("app.launcherOnline") : t("app.launcherOffline")}</span>
        </div>
      </div>
      <nav>
        <button class="nav-item" class:active={store.page.name !== "audit"} onclick={() => store.go({ name: "servers" })}>
          <Icon name="server" size={16} /><span class="lbl">{t("nav.servers")}</span>
          {#if running}<span class="badge lbl tnum">{running}</span>{/if}
        </button>
        {#if store.can("audit.view")}
          <button class="nav-item" class:active={store.page.name === "audit"} onclick={() => store.go({ name: "audit" })}>
            <Icon name="shield" size={16} /><span class="lbl">{t("nav.audit")}</span>
          </button>
        {/if}
      </nav>
      {#if store.servers.length}
        <div class="quick lbl">
          <div class="eyebrow">{t("nav.servers")}</div>
          {#each store.servers as s (s.id)}
            <button class="q" class:active={store.page.name === "server" && store.page.id === s.id} onclick={() => store.go({ name: "server", id: s.id })}>
              <span class="sdot {store.runtime(s.id).status}"></span><span class="qn">{s.name}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="side-foot">
        <div class="me lbl">
          <div class="avatar">{(store.me.displayName || store.me.username).slice(0, 1).toUpperCase()}</div>
          <div class="who">
            <strong>{store.me.displayName || store.me.username}</strong>
            <span>{t(`roles.${store.me.role}`)}</span>
          </div>
          <button class="btn ghost sm icon" title={t("app.logout")} onclick={() => store.logout()}><Icon name="logout" /></button>
        </div>
        <div class="prefs">
          <div class="lang">
            <Select size="sm" ariaLabel={t("app.language")} value={i18n.lang} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onchange={(v) => i18n.set(v)} />
          </div>
          <div class="theme" role="radiogroup" aria-label={t("app.theme")}>
            {#each [["light", "sun"], ["dark", "moon"], ["system", "monitor"]] as const as [value, icon]}
              <button role="radio" aria-checked={store.theme === value} class:on={store.theme === value} title={t(`theme.${value}`)} onclick={() => store.setTheme(value)}>
                <Icon name={icon} size={14} />
              </button>
            {/each}
          </div>
        </div>
      </div>
    </aside>
    <main class="main">
      {#if !store.online}
        <div class="offline"><Icon name="alert" size={14} />{t("app.offlineBanner")}</div>
      {/if}
      {#key pageKey}
        <div class="view" use:reveal={{ y: 8 }}>
          {#if store.page.name === "server"}
            <Server id={store.page.id} initialTab={store.page.tab} />
          {:else if store.page.name === "audit"}
            <Audit />
          {:else}
            <Servers />
          {/if}
        </div>
      {/key}
    </main>
  </div>
{/if}

<Toasts />

<style>
  .boot {
    height: 100vh;
    display: grid;
    place-items: center;
  }
  .spinner {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px solid var(--line);
    border-top-color: var(--accent);
    animation: spin var(--spin) linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .shell {
    display: grid;
    grid-template-columns: 250px 1fr;
    height: 100vh;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 18px 12px 14px;
    border-right: 1px solid var(--line);
    background: var(--surface);
    min-height: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 8px;
  }
  .brand img {
    width: 34px;
    height: 34px;
    border-radius: 9px;
  }
  .brand .lbl {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .brand strong {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--faint);
  }
  .conn .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--err);
  }
  .conn.on .dot {
    background: var(--ok);
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-size: 13.5px;
    font-weight: 550;
    cursor: pointer;
    text-align: left;
  }
  .nav-item:hover,
  .nav-item.active {
    background: var(--tint);
    color: var(--ink);
  }
  .badge {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--ok-soft);
    color: var(--ok);
    font-size: 11.5px;
    font-weight: 700;
    display: grid;
    place-items: center;
  }
  .quick {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-height: 0;
    overflow: auto;
  }
  .quick .eyebrow {
    padding: 0 10px 6px;
  }
  .q {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .q:hover,
  .q.active {
    background: var(--tint);
    color: var(--ink);
  }
  .qn {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sdot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--line-strong);
    flex: none;
  }
  .sdot.running {
    background: var(--ok);
  }
  .sdot.preparing,
  .sdot.stopping {
    background: var(--warn);
  }
  .sdot.error {
    background: var(--err);
  }
  .side-foot {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-weight: 700;
    flex: none;
  }
  .who {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
  }
  .who span {
    color: var(--faint);
    font-size: 11.5px;
  }
  .prefs {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 0 4px;
  }
  .lang {
    flex: 1;
    min-width: 0;
  }
  .theme {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 9px;
    background: var(--tint);
  }
  .theme button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  .theme button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  .main {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .offline {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: var(--err-soft);
    color: var(--err);
    font-size: 13px;
    font-weight: 600;
  }
  .view {
    flex: 1;
    min-height: 0;
  }
  @media (max-width: 900px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      height: auto;
      min-height: 100vh;
    }
    .side {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-right: 0;
      border-bottom: 1px solid var(--line);
    }
    nav {
      flex-direction: row;
    }
    .quick,
    .me .who {
      display: none;
    }
    .side-foot {
      margin: 0 0 0 auto;
      flex-direction: row;
    }
    .me {
      padding: 4px;
    }
  }
</style>
