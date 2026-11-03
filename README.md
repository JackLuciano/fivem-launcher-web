# FiveM Server Launcher – Web panel

Browser access to the [FiveM Server Launcher](../fivemlauncher) for your team. The panel runs on a VPS and connects to
the launcher with two settings: the launcher's address/port and its token. Nothing else is configured or stored here.

```
browser ──HTTPS──> reverse proxy ──> panel (this repo, 127.0.0.1:8080) ──ws://pc:47801──> launcher on the server PC
```

## What it does

- **Sign-in** with accounts created and managed only in the launcher (*Web panel* page). The panel stores no accounts:
  it passes the login to the launcher, which checks the password and returns the account's permissions.
- **Roles + per-user tweaks** (Owner, Admin, Developer, Moderator, Viewer) and a per-user server list. Examples: a
  viewer can read the console but not type into it; a moderator can kick/ban but not start servers.
- **Servers**: live status, start / stop / restart, pull, branch switch.
- **Console**: live output split into tabs per source (FXServer, txAdmin, launcher & git, every dev server/macro), and
  commands for accounts with *Send console commands*.
- **Players**: online list with ping and identifiers; message, warn, kick, ban (via txAdmin).
- **Health**: uptime, txAdmin health, tick times per thread, resources (restart / stop / ensure).
- **Event log**: txAdmin's live action log – joins, leaves, deaths, chat, admin actions.
- **Config**: a server's own `.cfg` / `.env` values, editable for accounts with *Edit server config values*; secrets are
  masked unless the account has *See secrets unmasked*.
- **Audit log**: every sign-in, every action and every refused attempt, with user, server and IP.

Every request is checked twice: here, and again by the launcher, which owns the accounts. Project settings, license keys,
git credentials, deleting servers and managing users are never reachable from the web.

## Run it on a VPS

Requires Node.js 22.18+ (TypeScript runs natively, there is no server build step).

```bash
git clone <this repo> /opt/fivem-panel && cd /opt/fivem-panel
npm ci
npm run build                 # builds the web UI into dist/
cp .env.example .env
nano .env                     # LAUNCHER_URL and LAUNCHER_TOKEN from the launcher
npm start
```

In the launcher: **Web panel → Panel access**: turn it on, keep *Other machines* on, save. The page shows the two lines
for `.env` (the copy button includes the token). Once the panel connects, the status says *Panel connected from …*.
Create accounts under **Users** in the launcher.

### Reaching the server PC

The panel must be able to open a TCP connection to the launcher's port (default `47801`):

- **VPN (recommended)**: Tailscale or WireGuard on both machines, then `LAUNCHER_URL=ws://<pc-vpn-ip>:47801`. The link is
  encrypted and the port is never exposed to the internet.
- **Port forward**: forward the port on the router and allow it in Windows Firewall. `ws://` is unencrypted, so the
  token and the logins travel in clear text – only use this with a VPN or a TLS tunnel in front.
- **Same machine / LAN**: `ws://127.0.0.1:47801` or `ws://<lan-ip>:47801`.

### HTTPS

Keep `HOST=127.0.0.1` and put a reverse proxy in front. With Caddy (automatic Let's Encrypt), `deploy/Caddyfile`:

```
panel.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Cloudflare Tunnel works too (`cloudflared tunnel --url http://127.0.0.1:8080`). For plain-HTTP testing on a LAN set
`COOKIE_SECURE=false` and `HOST=0.0.0.0` – never do that on the internet.

### Keep it running

`deploy/fivem-panel.service` is a systemd unit; copy it to `/etc/systemd/system/`, adjust the paths and user, then
`systemctl enable --now fivem-panel`.

## Settings (`.env`)

| Name | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8080` | Listen port |
| `LAUNCHER_URL` | – | The launcher's address and port, e.g. `ws://100.64.0.2:47801` |
| `LAUNCHER_TOKEN` | – | The token from the launcher's Web panel page |
| `COOKIE_SECURE` | `true` | Send the session cookie over HTTPS only |
| `TRUST_PROXY` | `false` | Take the client IP from `X-Forwarded-For` (set `true` behind a proxy) |
| `DATA_DIR` | `./data` | Translation cache, audit log |
| `SESSION_HOURS` | `12` | Idle time before a sign-in expires |

## Security notes

- Session cookie: random 256-bit id, `HttpOnly`, `SameSite=Strict`, `Secure` (unless disabled). Sessions live in memory,
  so restarting the panel signs everyone out.
- Every write request needs the `x-fxl: 1` header (blocks cross-site form posts) and passes a strict CSP.
- Login: 15 attempts/minute per IP, and 8 failures lock the IP and the username for 10 minutes. Unknown usernames take as
  long as wrong passwords.
- The launcher only accepts a connection that presents its token; one panel at a time, a new one replaces the old.
  While the launcher is unreachable nobody can sign in, and the panel keeps retrying.
- Disabling or deleting an account in the launcher signs it out of the panel immediately.

## Development

```bash
npm run dev:server   # panel API on :8080 (needs LAUNCHER_URL and LAUNCHER_TOKEN in .env)
npm run dev          # UI with hot reload on :5180, proxied to the API
npm run check        # svelte-check + tsc
npm test             # server unit tests
```

The UI shares its design system (`src/app.css`, icons, console colours, motion helpers) with the launcher. Translations
for the panel's own text live in `src/locales`; messages coming from the launcher (log lines, errors) use the launcher's
translations, which it sends when it connects.
