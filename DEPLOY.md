# Deployment Runbook — Phase 3

Deploys the Airbnb turnover app to a DigitalOcean droplet (Ubuntu 24.04), served
at **https://airbnbadmin.tohacking.com** via Caddy (auto-HTTPS) + systemd.

**Target droplet:** `64.225.32.220` · **Domain:** `airbnbadmin.tohacking.com` (A record already live).

Run everything over SSH unless noted. `$` = your Mac, `#` = the droplet (as root).

---

## 0. Prereqs (already done)
- [x] Droplet created (Ubuntu 24.04, 1 GB, US region, your SSH key)
- [x] DNS A record `airbnbadmin` → `64.225.32.220`
- [x] App code is Phase-3 ready (WeCom push, daily push, prod frontend serving)

---

## 1. First login + base packages

```bash
$ ssh root@64.225.32.220
```

```bash
# update + essentials
apt update && apt upgrade -y
apt install -y git sqlite3 ufw

# Node 26 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_26.x | bash -
apt install -y nodejs
node -v   # expect v26.x
```

---

## 2. Firewall

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
ufw status
```

---

## 3. App user + code

```bash
# dedicated non-root user to run the app
adduser --system --group --home /opt/AirbnbAdmin turnover

# clone the code (public repo — no auth needed)
git clone https://github.com/Mavis-H/AirbnbAdmin.git /opt/AirbnbAdmin
cd /opt/AirbnbAdmin

# backend deps (compiles better-sqlite3 — needs the 1 GB RAM)
npm install

# build the frontend
cd frontend
npm install
npm run build
cd /opt/AirbnbAdmin

# make sure the app user owns everything
chown -R turnover:turnover /opt/AirbnbAdmin
```

---

## 4. Environment file

Create `/opt/AirbnbAdmin/.env` (real values — never committed). Copy from your
local `.env` and add the prod settings:

```bash
cat > /opt/AirbnbAdmin/.env <<'EOF'
WECOM_CORP_ID=<from your local .env>
WECOM_AGENT_ID=<from your local .env>
WECOM_SECRET=<from your local .env>
WECOM_TOKEN=<from your local .env>
WECOM_AES_KEY=<from your local .env>

NODE_ENV=production
PORT=3000
PUSH_CRON=0 7 * * *
PUSH_TZ=America/Los_Angeles
EOF

chown turnover:turnover /opt/AirbnbAdmin/.env
chmod 600 /opt/AirbnbAdmin/.env
```

> Set `PUSH_TZ` to the parents' actual timezone. `CORS_ORIGIN` is not needed in
> prod (frontend is same-origin).

---

## 5. systemd service (runs the app)

```bash
cp /opt/AirbnbAdmin/deploy/turnover.service /etc/systemd/system/turnover.service
systemctl daemon-reload
systemctl enable --now turnover
systemctl status turnover        # should be "active (running)"
journalctl -u turnover -n 30     # check logs / "Server listening"
```

Sanity check it's serving locally:

```bash
curl -s localhost:3000/health    # → {"ok":true}
```

---

## 6. Caddy (reverse proxy + auto-HTTPS)

```bash
# install Caddy (official repo)
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# install our Caddyfile
cp /opt/AirbnbAdmin/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
journalctl -u caddy -n 30        # watch it obtain the certificate
```

**Verify (from your Mac):**

```bash
$ curl -sI https://airbnbadmin.tohacking.com/health   # 200, valid TLS
```

Then open **https://airbnbadmin.tohacking.com** and **/admin** in a browser.

---

## 7. Daily DB backup → private repo

One-time setup so the droplet can push backups to a **new private** repo
`AirbnbAdmin-Backup` (separate from the code repo). The local clone lives at
`/opt/airbnbadmin-backups` (path hardcoded in `backup-db.sh`); the differing
case/name from the GitHub repo is fine — only the clone URL must match GitHub.

```bash
# generate a deploy key ON the droplet
ssh-keygen -t ed25519 -f /root/.ssh/backup_deploy -N ""
cat /root/.ssh/backup_deploy.pub
```

Add that public key to the **`AirbnbAdmin-Backup`** repo on GitHub:
*Settings → Deploy keys → Add deploy key → ✅ Allow write access*.

Tell git to use this key for that repo, then clone + wire the cron:

```bash
cat >> /root/.ssh/config <<'EOF'
Host github-backup
  HostName github.com
  User git
  IdentityFile /root/.ssh/backup_deploy
  IdentitiesOnly yes
EOF

git clone git@github-backup:Mavis-H/AirbnbAdmin-Backup.git /opt/airbnbadmin-backups
cd /opt/airbnbadmin-backups
git config user.email "backup@tohacking.com"
git config user.name "droplet backup"

# install the backup script + daily cron (03:30, before the 04:00 sync)
cp /opt/AirbnbAdmin/deploy/backup-db.sh /opt/airbnbadmin-backups/backup-db.sh
chmod +x /opt/airbnbadmin-backups/backup-db.sh
( crontab -l 2>/dev/null; echo "30 3 * * * /opt/airbnbadmin-backups/backup-db.sh >> /var/log/db-backup.log 2>&1" ) | crontab -

# test it once
/opt/airbnbadmin-backups/backup-db.sh
```

> Optional encryption: encrypt `airbnb.db` before commit (e.g. `age`/`gpg`) if you
> don't want lock codes/guest names readable in the private repo.

---

## 8. WeCom repoint (Phase 3 step 5)

In the WeCom admin console for the self-built app:
- **接收消息服务器URL** → `https://airbnbadmin.tohacking.com/wecom/callback` → save.
- **企业可信IP** → **add** `64.225.32.220` (keep your home IP too).

Then tear down the laptop `cloudflared` tunnel — no longer needed.

---

## 9. Onboard parents (Phase 3 step 6)

- Add each parent to WeCom **通讯录**; note each **UserID (账号)**.
- Set each person's `notify_method` to their UserID (admin UI field — to be added — or DB).
- Each parent scans the **微信插件** QR in WeChat + enables 接收应用消息.
- Preview, then send: `npm run push:test -- --dry` then real.

---

## Redeploying after code changes

Sections 1–8 are **one-time setup** — never repeat them. Only this section applies
to future code changes.

**1. On your Mac** — commit + push:

```bash
$ git push
```

**2. On the droplet** — pull and apply. What you run depends on *what* changed:

| What you changed | Commands on droplet (in `/opt/AirbnbAdmin`) |
|---|---|
| **Backend only** (`src/`) | `git pull` → `systemctl restart turnover` |
| **Frontend only** (`frontend/src/`) | `git pull` → `cd frontend && npm run build` |
| **Both** | `git pull` → `cd frontend && npm run build` → `systemctl restart turnover` |
| **Added/changed a dependency** (`package.json`) | also run `npm install` (root and/or `frontend/`) before the above |

> **Why frontend needs no restart:** the backend serves the prebuilt `frontend/dist`
> as static files, so once `npm run build` regenerates `dist` the new files are served
> immediately. A restart only matters for backend (`src/`) changes.
> **DB migrations** (e.g. new columns) run automatically on startup, so `restart` applies them.
> **PWA caching:** members' screens are a PWA — after a frontend change they may briefly
> see the cached old version until the service worker updates (usually next launch).

Safe catch-all (does everything; harmless if some steps are no-ops):

```bash
cd /opt/AirbnbAdmin && git pull && npm install && (cd frontend && npm install && npm run build)
chown -R turnover:turnover /opt/AirbnbAdmin   # git pull/npm as root leaves root-owned files
systemctl restart turnover
```

**Sanity check after redeploy:**

```bash
systemctl status turnover           # should be "active (running)"
curl -s localhost:3000/health       # → {"ok":true}
```

From your Mac, confirm it's live end-to-end:

```bash
$ curl -sI https://airbnbadmin.tohacking.com/health   # 200, valid TLS
```

## Troubleshooting
- **App won't start:** `journalctl -u turnover -n 50` — usually a bad `.env` or missing build.
- **No HTTPS / cert error:** `journalctl -u caddy -n 50` — DNS must resolve to the droplet and 80/443 open *before* Caddy can issue the cert.
- **WeCom send fails `not allow ... from your ip`:** add the droplet IP to 企业可信IP.
- **Push to parents not arriving:** check `notify_method` is a real UserID and the parent did the 微信插件 bind.
