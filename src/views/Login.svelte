<script lang="ts">
  import { store } from "../lib/store.svelte";
  import { i18n, LANGUAGES, t } from "../lib/i18n.svelte";
  import { reveal } from "../lib/motion";
  import Icon from "../components/Icon.svelte";
  import Select from "../components/Select.svelte";
  import mark from "../assets/brand/mark.png";

  let username = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state("");

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    busy = true;
    error = "";
    try {
      await store.login(username.trim(), password);
      password = "";
    } catch (err) {
      error = store.errorText(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="wrap">
  <form class="card panel" onsubmit={submit} use:reveal={{ selector: ".anim", stagger: 0.05 }}>
    <div class="brand anim">
      <img src={mark} alt="" />
      <div>
        <strong class="shiny">{t("app.name")}</strong>
        <span>{t("login.subtitle")}</span>
      </div>
    </div>
    <label class="field anim">
      <span>{t("login.username")}</span>
      <input bind:value={username} autocomplete="username" autocapitalize="off" spellcheck="false" required />
    </label>
    <label class="field anim">
      <span>{t("login.password")}</span>
      <input type="password" bind:value={password} autocomplete="current-password" required />
    </label>
    {#if error}<div class="notice warn anim"><Icon name="alert" /><div>{error}</div></div>{/if}
    <button class="btn accent big anim" type="submit" disabled={busy || !username.trim() || !password}>
      <Icon name="right" />{busy ? t("login.signingIn") : t("login.signIn")}
    </button>
    <div class="foot anim">
      <div class="lang">
        <Select size="sm" ariaLabel={t("app.language")} value={i18n.lang} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} onchange={(v) => i18n.set(v)} />
      </div>
      <span class="hint">{t("login.hint")}</span>
    </div>
  </form>
</div>

<style>
  .wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 16px;
    background:
      radial-gradient(900px 500px at 15% -10%, var(--accent-soft), transparent 60%),
      var(--bg);
  }
  .panel {
    width: min(400px, 100%);
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 28px;
    box-shadow: var(--shadow-lg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
  }
  .brand img {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }
  .brand div {
    display: flex;
    flex-direction: column;
  }
  .brand strong {
    font-size: 16px;
  }
  .brand span {
    font-size: 12.5px;
    color: var(--muted);
  }
  .big {
    height: 42px;
    justify-content: center;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lang {
    width: 120px;
    flex: none;
  }
</style>
