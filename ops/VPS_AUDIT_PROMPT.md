# Tnajem VPS — audit, fix and prepare (prompt for Claude Code running ON the server)

You are running **on the production VPS** for Tnajem, a Tunisian tutoring marketplace (Next.js web + Fastify API + Postgres, npm-workspaces monorepo). The owner, Walid, set parts of this server up by hand and isn't sure what's done. Your job:

1. **Audit** what's actually on the box.
2. **Fix** everything to match the target state below.
3. **Prepare** it for the GitHub Actions deploy.
4. **Report.**

Work through it in order and don't stop to ask, **except at the two STOP points** marked 🛑.

## Server facts
- Oxahost, hosted **in Tunisia**. IP `102.204.205.85`. Ubuntu 24.04, 4 vCPU, 8 GB RAM, 120 GB disk.
- Everything runs as the user **`ubuntu`** (sudo). You are probably running as `ubuntu`.
- Domain `tnajem.com`, with DNS through Cloudflare.
- **Current SSH state (known):** Walid got locked out and re-enabled root and password login from the provider console, in `/etc/ssh/sshd_config.d/00-tnajel.conf` (with an **l**) containing `PermitRootLogin yes` and `PasswordAuthentication yes`. `ubuntu`'s `~/.ssh/authorized_keys` was **empty**.

## Hard rules
1. **Never lock anyone out.** Don't change any SSH setting that reduces access until 🛑 STOP 1 is cleared. Always run `sshd -t` before `systemctl reload ssh`. Never restart networking or the firewall in a way that drops port 22.
2. **Never print a secret.** Don't `cat`, `echo` or log passwords, keys, tokens or database URLs. Generate them straight into files with `umask 077`, and refer to them by file path only. Never `cat ~/tnajem-secrets.txt`.
3. **Idempotent and additive.** Check before you change anything. Don't delete data, databases, users or files you didn't create. Back up any config file before editing it: `sudo cp f f.bak-$(date +%F)`.
4. **Show evidence.** For every check, paste the command's real output, trimmed, into the report. "Done" without output counts as not done.
5. **Don't install extras** (Docker, other databases, panels like cPanel/Webmin) and don't open extra ports.

## Target state (audit each item → DONE / MISSING / WRONG, then fix)

| # | Item | Target | How to check |
|---|---|---|---|
| 1 | OS | Ubuntu 24.04, fully updated, timezone `Africa/Tunis` | `lsb_release -a; timedatectl; apt list --upgradable` |
| 2 | Base packages | curl, ca-certificates, gnupg, git, ufw, fail2ban, unattended-upgrades, build-essential, htop, jq, openssl | `dpkg -s …` |
| 3 | `ubuntu` user | exists, in the sudo group, passwordless sudo via `/etc/sudoers.d/90-ubuntu` (mode 440) | `id ubuntu; sudo -l -U ubuntu` |
| 4 | Firewall | ufw active: default deny incoming, allow OpenSSH, 80/tcp, 443/tcp, **nothing else** | `sudo ufw status verbose` |
| 5 | fail2ban | active, `sshd` jail on | `sudo fail2ban-client status sshd` |
| 6 | Auto security updates | `/etc/apt/apt.conf.d/20auto-upgrades` with both Periodic lines = "1" | `cat` it |
| 7 | Swap | 2 GB `/swapfile`, in `/etc/fstab`, `vm.swappiness=10` | `swapon --show; sysctl vm.swappiness` |
| 8 | Node | **v22.x** from NodeSource, `/usr/bin/node` | `node -v; which node` |
| 9 | pm2 | global, with systemd startup for `ubuntu` (`pm2-ubuntu.service` enabled) | `pm2 -v; systemctl is-enabled pm2-ubuntu` |
| 10 | Postgres | **18** from the PGDG repo, running, **listening on 127.0.0.1/::1 only** | `psql --version; sudo ss -ltnp \| grep 5432` |
| 11 | PG tuning | `/etc/postgresql/18/main/conf.d/tnajem.conf`: `listen_addresses='localhost'`, `shared_buffers=2GB`, `effective_cache_size=6GB`, `work_mem=16MB`, `maintenance_work_mem=256MB`, `random_page_cost=1.1`, `timezone='Africa/Tunis'`, `log_min_duration_statement=500` | `sudo -u postgres psql -c "show shared_buffers"` |
| 12 | Database + roles | DB `tnajem` **owned by `tnajem_owner`**. Login role `tnajem_app` with CONNECT + USAGE on public + `ALTER DEFAULT PRIVILEGES FOR ROLE tnajem_owner` granting SELECT/INSERT/UPDATE/DELETE on tables and USAGE/SELECT on sequences. `REVOKE ALL ON DATABASE tnajem FROM PUBLIC`. **tnajem_app must not own anything and must not be superuser.** | `\l`, `\du`, `\ddp` |
| 13 | DB URLs file | `~/tnajem-db-secrets.txt` (600): `MIGRATION_DATABASE_URL=postgresql://tnajem_owner:…@127.0.0.1:5432/tnajem` and `DATABASE_URL=postgresql://tnajem_app:…@127.0.0.1:5432/tnajem`. If the roles already exist but the file is missing, **reset both passwords** with `ALTER ROLE … PASSWORD` and rewrite the file | `ls -l` only |
| 14 | App secrets file | append to `~/tnajem-secrets.txt` (600) three **separate** values of `openssl rand -hex 32` as `AUTH_SECRET=`, `DOC_ENCRYPTION_KEY=`, `CRON_SECRET=`. **Only if they're not already there. Never regenerate `DOC_ENCRYPTION_KEY` once it exists.** | `grep -c '^[A-Z_]*=' ~/tnajem-secrets.txt` (count only) |
| 15 | Folders | `/var/www/tnajem` (owner ubuntu, **empty** or a git checkout of the tnajem repo), `/var/lib/tnajem/storage` (700, ubuntu), `/var/backups/tnajem` (700, ubuntu) | `ls -ld` |
| 16 | nginx | installed, enabled, `server_tokens off`, default site removed, `/etc/nginx/sites-available/tnajem` = the config below, symlinked in `sites-enabled`, `nginx -t` OK | `sudo nginx -t` |
| 17 | Cloudflare real IP | `/etc/nginx/conf.d/cloudflare-realip.conf` built from `https://www.cloudflare.com/ips-v4` and `ips-v6` (`set_real_ip_from …;` per range + `real_ip_header CF-Connecting-IP;`) | `grep -c set_real_ip_from` |
| 18 | certbot | `certbot` + `python3-certbot-nginx` installed. **Don't run it** (see 🛑 STOP 2) | `certbot --version` |
| 19 | Ports | only 22, 80, 443 reachable from outside; 3000, 4000, 5432 bound to loopback or not bound | `sudo ss -ltnp` |
| 20 | Leftovers | report (don't delete) anything unexpected: other web servers (apache2), other Node versions (nvm), Docker, extra users with shells, extra listening ports, old `/etc/ssh/sshd_config.d/*.conf` files | `ls`, `ss`, `getent passwd` |

### nginx site config for item 16 (write exactly this; certbot adds TLS later)
```nginx
server {
  listen 80;
  listen [::]:80;
  server_name tnajem.com www.tnajem.com;
  client_max_body_size 15M;

  gzip on; gzip_vary on; gzip_proxied any; gzip_comp_level 5; gzip_min_length 1024;
  gzip_types text/plain text/css text/xml application/json application/javascript
             application/xml+rss image/svg+xml application/manifest+json;

  location /_next/static/ {
    alias /var/www/tnajem/apps/web/.next/static/;
    access_log off; expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
  location ~ ^/(favicon\.ico|favicon-32\.png|apple-touch-icon\.png|logo\.png|logo-white\.png|logo\.webp|logo-white\.webp|og\.png)$ {
    root /var/www/tnajem/apps/web/public;
    access_log off; expires 1h;
    add_header Cache-Control "public, max-age=3600";
  }
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```
Port 4000 (the API) must **never** get a server block.

## SSH keys for GitHub Actions (do this, it's safe)
- Create `~/.ssh/tnajem_actions` (ed25519, no passphrase, comment `github-actions-tnajem`) **if it doesn't exist**.
- Append its `.pub` to `~/.ssh/authorized_keys` (no duplicates, 700/600 perms).
- **Don't print the private key.** Tell Walid to run `cat ~/.ssh/tnajem_actions` himself, paste it into the GitHub **deploy** environment secret `SERVER_SSH_KEY`, and then delete the file with `rm ~/.ssh/tnajem_actions`.

## 🛑 STOP 1: SSH hardening (ask Walid; don't do it on your own)
When items 1–20 are done, ask Walid to run this **from his Windows PC**, after adding his own key if needed:
```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ubuntu@102.204.205.85 "cat >> ~/.ssh/authorized_keys"
ssh -o PreferredAuthentications=publickey ubuntu@102.204.205.85 "echo key-ok"
```
**Only after he confirms he saw `key-ok`:**
1. Replace `/etc/ssh/sshd_config.d/00-tnajel.conf` with `/etc/ssh/sshd_config.d/00-tnajem.conf` containing `PasswordAuthentication no`, `KbdInteractiveAuthentication no` and `PermitRootLogin no`, and remove any other file there that re-enables these.
2. Run `sshd -t`, then `systemctl reload ssh`.
3. Ask him to confirm a fresh key login still works.

If he doesn't confirm, leave SSH as it is and list it as OPEN in the report.

## 🛑 STOP 2: HTTPS (needs Walid in Cloudflare)
Tell him:
1. In Cloudflare, set A records for `tnajem.com` and `www` → `102.204.205.85` with the **grey cloud (DNS only)**.
2. Tell you when `curl -sI http://tnajem.com` answers from this server (a 502 is fine, because the app isn't deployed yet).

Then run `sudo certbot --nginx -d tnajem.com -d www.tnajem.com --redirect -m <email he gives you> --agree-tos -n` and check with `sudo certbot renew --dry-run`. Finally tell him to switch Cloudflare to the **orange cloud**, SSL/TLS **Full (strict)**, with Brotli and HTTP/3 on.

## Final report → `~/VPS_REPORT.md` (and print a summary)
1. A table of items 1–20: status before → after, with the evidence command output.
2. What you changed, each with its backup file path.
3. Leftovers found (item 20) and your recommendation for each. Don't remove anything.
4. SSH state: `sudo sshd -T | grep -E 'passwordauthentication|permitrootlogin'`, and whether STOP 1 was cleared.
5. HTTPS state: whether STOP 2 was cleared.
6. **For the GitHub `deploy` environment**, list where each value comes from, without printing any value:
   - `DATABASE_URL` and `MIGRATION_DATABASE_URL` come from `~/tnajem-db-secrets.txt`.
   - `AUTH_SECRET`, `DOC_ENCRYPTION_KEY` and `CRON_SECRET` come from `~/tnajem-secrets.txt`.
   - `SERVER_SSH_KEY` comes from `~/.ssh/tnajem_actions` (read it, save it to GitHub, then delete it).
   - Fixed values: `SERVER_HOST=102.204.205.85`, `SERVER_USER=ubuntu`, `SERVER_PORT=22`, `APP_DIR=/var/www/tnajem`, `STORAGE_DIR=/var/lib/tnajem/storage`, `BACKUP_DIR=/var/backups/tnajem`, `PG_BIN=/usr/lib/postgresql/18/bin`.
7. A last line: **READY FOR FIRST DEPLOY: yes/no**, with what's blocking if no.
