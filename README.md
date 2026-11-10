# FiveM Server Launcher – Web panel

Browser access to the [FiveM Server Launcher](../fivemlauncher) for your team. The panel runs on a VPS and connects to
the launcher with two settings: the launcher's address/port and its token. Nothing else is configured or stored here.

```
browser ──HTTPS──> reverse proxy ──> panel (this repo, 127.0.0.1:8080) ──wss:// (TLS)──> launcher on the server PC
```

## What it does

- **Sign-in** with accounts created and managed only in the launcher (*Web panel* page). The panel stores no accounts:
  it passes the login to the launcher, which checks the password and hands back a ticket for that one sign-in.
- **Roles + per-user tweaks** (Owner, Admin, Developer, Moderator, Viewer) and a per-user server list (*All servers* or
  an explicit list – an empty list means no servers). Examples: a viewer can read the console but not type into it; a
  moderator can kick/ban but not start servers.
- **Servers**: live status, start / stop / restart, pull, branch switch.
- **Console**: live output split into tabs per source (FXServer, txAdmin, launcher & git, every dev server/macro), and
  commands for accounts with *Send console commands*. Known secret config values are masked in console output.
- **Players**: online list with ping and identifiers (player IPs are never sent); message, warn, kick, ban (via txAdmin).
- **Health**: uptime, txAdmin health, tick times per thread, resources (restart / stop / ensure).
- **Event log**: txAdmin's live action log – joins, leaves, deaths, chat, admin actions.
- **Config**: a server's own `.cfg` / `.env` values for accounts with *View config*, editable with *Edit server config
  values*; secrets (passwords, keys, tokens, connection strings, credentials inside URLs) are masked unless the account
  has *See secrets unmasked*.
- **Audit log**: every sign-in, every action and every refused attempt, with user, server and IP.

Every request is checked twice: here, and again by the launcher, which owns the accounts and only acts for a user who
signed in through a ticket it issued. Project settings, license keys, git credentials, deleting servers and managing
users are never reachable from the web.

## Run it on a VPS

Requires Node.js 22.18+ (TypeScript runs natively, there is no server build step).

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin fivem-panel
git clone <this repo> /opt/fivem-panel && cd /opt/fivem-panel
npm ci
npm run build                                               # builds the web UI into dist/
install -m 600 -o root -g root .env.example /etc/fivem-panel.env
nano /etc/fivem-panel.env                                   # LAUNCHER_URL and LAUNCHER_TOKEN from the launcher
cp deploy/fivem-panel.service /etc/systemd/system/
systemctl enable --now fivem-panel
```

The unit reads `/etc/fivem-panel.env` as root before dropping to the `fivem-panel` user, keeps the audit log and the
translation cache in `/var/lib/fivem-panel` (created by systemd, mode 0700) and runs sandboxed. If you ran the panel by
hand before, delete the test `./.env` (or `chown root:fivem-panel .env && chmod 640 .env`) and move the old data over:
`mv /opt/fivem-panel/data/* /var/lib/fivem-panel/ && chown -R fivem-panel:fivem-panel /var/lib/fivem-panel`. The repo
folder must be readable by the `fivem-panel` user.

In the launcher: **Web panel → Panel access**: turn it on, save. The page shows the two lines for the env file (the copy
button includes the token). Once the panel connects, the status says *Panel connected from …*. Create accounts under
**Users** in the launcher.

## Run it with Docker

For a VPS whose reverse proxy already runs in Docker (e.g. a Caddy container on a shared network). The panel joins
that network and publishes no ports; only the proxy reaches it.

```bash
git clone https://github.com/JackLuciano/fivem-launcher-web /home/admin/containers/fivem-panel
cd /home/admin/containers/fivem-panel
cp deploy/docker.env.example .env && chmod 600 .env
nano .env
docker compose up -d --build
```

In `.env`:

| Name | Meaning |
| --- | --- |
| `LAUNCHER_URL`, `LAUNCHER_TOKEN` | From the launcher's *Web panel → Panel access* (see below) |
| `PUBLIC_ORIGIN` | The panel's public address, e.g. `https://panel.example.com` |
| `TRUST_PROXY` | The proxy network's subnet, plus Cloudflare's ranges when Cloudflare proxies the site; otherwise every visitor shows up with the proxy's IP in the audit log and the login lockout |
| `PANEL_NETWORK` | The existing Docker network of the reverse proxy (default `proxy`) |

`HOST`, `PORT` and `DATA_DIR` are fixed by `compose.yml` (`0.0.0.0:8080`, audit log in the `panel-data` volume). To
print `TRUST_PROXY` for a Caddy container whose Cloudflare ranges are in `cf_trust.caddy`:

```bash
echo "$(docker network inspect proxy -f '{{(index .IPAM.Config 0).Subnet}}'),$(grep -oE '[0-9a-f:.]+/[0-9]+' ../caddy/cf_trust.caddy | paste -sd, -)"
```

Then add the site to the proxy and reload it, for Caddy:

```
panel.example.com {
    reverse_proxy fivem-panel:8080
}
```

Update with `git pull && docker compose up -d --build` (everyone is signed out, sessions live in memory).
`docker compose logs -f` shows whether the panel reached the launcher.

### Reaching the server PC

The panel must be able to open a TCP connection to the launcher's port (default `47801`). The link is always encrypted
with TLS, and both sides prove they know the token without ever sending it: the proof is bound to that one TLS session,
so a machine in the middle can neither read the traffic nor reuse the handshake. Point `LAUNCHER_URL` straight at the
launcher – an HTTP reverse proxy or a TLS-terminating tunnel in between breaks that binding and the link is refused.

- **VPN (recommended)**: Tailscale or WireGuard on both machines, then `LAUNCHER_URL=wss://<pc-vpn-ip>:47801`. The port is
  never exposed to the internet. In the launcher, keep *Other machines* on and allow the port only on the VPN interface
  in Windows Firewall.
- **Port forward**: forward the port on the router and allow it in Windows Firewall, then use the PC's public address.
  The token and the logins stay encrypted, but the port is reachable from the whole internet – prefer a VPN.
- **Same machine**: `wss://127.0.0.1:47801`, with *Other machines* off in the launcher.

Only one panel can be connected at a time. A second panel with the same token takes over the connection, and the first
one backs off for five minutes and logs a warning instead of fighting for it.

### HTTPS

Keep `HOST=127.0.0.1` and put a reverse proxy in front. With Caddy (automatic Let's Encrypt), `deploy/Caddyfile`:

```
panel.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Cloudflare Tunnel works too (`cloudflared tunnel --url http://127.0.0.1:8080`). Set `PUBLIC_ORIGIN` to the panel's
public address. For plain-HTTP testing on a LAN set `COOKIE_SECURE=false`, `HOST=0.0.0.0` and `TRUST_PROXY=false` –
never do that on the internet.

## Settings (env file)

| Name | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `8080` | Listen port |
| `LAUNCHER_URL` | – | The launcher's address and port, e.g. `wss://100.64.0.2:47801` (always TLS) |
| `LAUNCHER_TOKEN` | – | The token from the launcher's Web panel page |
| `COOKIE_SECURE` | `true` | Send the session cookie over HTTPS only |
| `TRUST_PROXY` | `false` | `true`: take the client IP from `X-Forwarded-For` added by a proxy on 127.0.0.1 (ignored, with a warning, unless `HOST` is a loopback address); or a comma-separated list of trusted proxy addresses/CIDRs, for a proxy on another machine |
| `PUBLIC_ORIGIN` | – | The panel's public address (`https://panel.example.com`); other origins are refused. Empty: the address the browser used |
| `DATA_DIR` | `./data` | Translation cache, audit log (the systemd unit always uses `/var/lib/fivem-panel` and ignores this) |
| `SESSION_HOURS` | `12` | Idle time before a sign-in expires (1–720); a sign-in never lasts longer than 7 days |

## Security notes

- Session cookie: random 256-bit id, `HttpOnly`, `SameSite=Strict`, `Secure` (unless disabled). Sessions live in memory,
  so restarting the panel signs everyone out. Signing out, or a password change / disabling / deleting the account in
  the launcher, ends the session and its live connection immediately.
- Every write request needs the `x-fxl: 1` header and a matching `Origin`; the live socket checks `Origin` too.
  Everything is served with a strict CSP.
- Login: 15 attempts/minute per IP; 8 failures lock the IP (and the IP + username pair) for 10 minutes. Repeated
  failures for one username make further attempts wait (up to 30 s between tries) instead of locking the real owner
  out, and IPs that signed in as that account recently are exempt. One sign-in per IP and at most 4 overall are checked
  at once, and the launcher caps attempts per account again on its side. Unknown usernames take as long as wrong
  passwords.
- The launcher link: TLS 1.3 with a fresh certificate per start, mutual token proof bound to the TLS session, one panel
  at a time. While the launcher is unreachable nobody can sign in, and the panel keeps retrying.
- The audit log rotates at 10 MB (one previous file is kept as `audit.jsonl.1`).

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
