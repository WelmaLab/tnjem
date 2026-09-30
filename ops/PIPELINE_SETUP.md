# Tnajem — push-to-deploy pipeline setup
`git push origin production` → GitHub Actions runs the full test suite (`ci.yml`) → if green, writes `.env` from the **deploy** environment, SSHes into the VPS and runs `deploy.sh` (install → build → migrate as owner → config check → pm2 reload → smoke test).

Replace `VPS_IP` everywhere. Run order: **A → B → C → D → E**. Don't push to `production` before C is complete.

> **Private repo?** On a **free** GitHub plan, private repos can't use *Environments*. Either upgrade to GitHub Pro for this account, or tell Claude Code to switch `deploy.yml` from environment secrets to repository secrets.

---

## A · On your PC (PowerShell): a key only GitHub Actions uses
```powershell
ssh-keygen -t ed25519 -C "github-actions-tnajem" -f $env:USERPROFILE\.ssh\tnajem_actions -N '""'
type $env:USERPROFILE\.ssh\tnajem_actions.pub | ssh ubuntu@VPS_IP "cat >> ~/.ssh/authorized_keys"
ssh -i $env:USERPROFILE\.ssh\tnajem_actions ubuntu@VPS_IP "echo key-works"
```
Expect `key-works`. The **private** file `tnajem_actions` goes into GitHub in step C. Put a copy in your password manager too.

**Or create it on the VPS instead** (logged in as `ubuntu`):
```bash
ssh-keygen -t ed25519 -C "github-actions-tnajem" -f ~/.ssh/tnajem_actions -N ""
cat ~/.ssh/tnajem_actions.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/tnajem_actions          # copy ALL of it, BEGIN to END lines → SERVER_SSH_KEY
rm ~/.ssh/tnajem_actions           # once it's saved in GitHub, delete the private half here
```

## B · On the VPS (as `ubuntu`): folders, nginx, HTTPS, secrets
Copy the files from your PC first:
```powershell
cd "D:\work\Startups\New idea claude\9arini-app"
scp .\ops\nginx-tnajem.conf .\ops\cloudflare-realip.sh ubuntu@VPS_IP:/tmp/
ssh ubuntu@VPS_IP
```
Then, on the server:
```bash
# 1. App directory (APP_DIR). It must be EMPTY for the first deploy.
sudo mkdir -p /var/www/tnajem && sudo chown ubuntu:ubuntu /var/www/tnajem

# 2. Real nginx config (replaces the "bientôt" page)
sudo sed -i 's/\r$//' /tmp/nginx-tnajem.conf /tmp/cloudflare-realip.sh
sudo install -m 644 /tmp/nginx-tnajem.conf /etc/nginx/sites-available/tnajem
sudo bash /tmp/cloudflare-realip.sh          # visitor IPs behind Cloudflare; also runs nginx -t + reload

# 3. HTTPS. Cloudflare must still be on the GREY cloud (DNS only) for this step.
sudo certbot --nginx -d tnajem.com -d www.tnajem.com --redirect -m YOUR_EMAIL --agree-tos
#    Then in Cloudflare: orange cloud, SSL/TLS = Full (strict), Brotli + HTTP/3 on.

# 4. Generate the three app secrets. Run it three times, one value each for
#    AUTH_SECRET, DOC_ENCRYPTION_KEY and CRON_SECRET.
openssl rand -hex 32

# 5. Read the two database URLs the bootstrap created
sudo cat /root/tnajem-secrets.txt
```
Until the first deploy, the site answers **502**: nginx is waiting for the app. That's expected.

## C · GitHub: the `deploy` environment + secrets
**Web:** Repo → Settings → Environments → **New environment** → `deploy`
→ *Deployment branches and tags* → **Selected branches** → add `production`
→ credentials under **Environment secrets**, plain settings under **Environment variables**. The workflow reads either tab, and the split is listed in the chat answer of 26 Sept.

| Secret | Value |
|---|---|
| `SERVER_HOST` | `VPS_IP` |
| `SERVER_USER` | `ubuntu` |
| `SERVER_PORT` | `22` |
| `SERVER_SSH_KEY` | the **whole private file** `tnajem_actions` (BEGIN/END lines included) |
| `APP_DIR` | `/var/www/tnajem` |
| `DATABASE_URL` | the **APP RUNTIME (limited)** URL, `tnajem_app`, from `/root/tnajem-secrets.txt` |
| `MIGRATION_DATABASE_URL` | the **MIGRATIONS (owner)** URL, `tnajem_owner` |
| `AUTH_SECRET` · `DOC_ENCRYPTION_KEY` · `CRON_SECRET` | the three `openssl rand -hex 32` values (**`DOC_ENCRYPTION_KEY` also into your password manager**) |
| `NEXT_PUBLIC_SITE_URL` | `https://tnajem.com` |
| `CORS_ORIGINS` | `https://tnajem.com,https://www.tnajem.com` |
| `TRUSTED_PROXIES` | `127.0.0.1` |
| `ADMIN_EMAILS` | your admin e-mail(s), comma-separated |
| `OTP_CHANNEL` · `LOG_LEVEL` | `email` · `info` |
| `STORAGE_DRIVER` · `STORAGE_DIR` | `local` · `/var/lib/tnajem/storage` |
| `BACKUP_DIR` · `PG_BIN` | `/var/backups/tnajem` · `/usr/lib/postgresql/18/bin` |
| `MAIL_HOST` · `MAIL_PORT` · `MAIL_SECURE` | e.g. Resend: `smtp.resend.com` · `587` · `false` |
| `MAIL_USER` · `MAIL_PASS` | e.g. Resend: `resend` · your API key |
| `MAIL_FROM_NAME` · `MAIL_FROM_ADDRESS` · `MAIL_REPLY_TO` | `Tnajem` · `no-reply@tnajem.com` · your support address |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | InnoviaBurst's number, digits only (e.g. `216XXXXXXXX`) |
| `SENTRY_DSN` · `SENTRY_ENVIRONMENT` | optional (EU region) · `production` |
| **leave unset** | `PAYMENTS_ENABLED`, `ALLOW_MINORS`, `COOKIE_DOMAIN` |

The deploy refuses to touch the server if a required secret is missing, and it lists key names only, never values.

**Or with the GitHub CLI** (PowerShell, after `gh auth login`):
```powershell
$R = "ghouili/9arini"      # your repo
gh api -X PUT "repos/$R/environments/deploy" -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST "repos/$R/environments/deploy/deployment-branch-policies" -f name=production
Get-Content -Raw $env:USERPROFILE\.ssh\tnajem_actions | gh secret set SERVER_SSH_KEY --env deploy -R $R
gh secret set SERVER_HOST   --env deploy -R $R --body "VPS_IP"
gh secret set SERVER_USER   --env deploy -R $R --body "ubuntu"
gh secret set SERVER_PORT   --env deploy -R $R --body "22"
gh secret set APP_DIR       --env deploy -R $R --body "/var/www/tnajem"
gh secret set DATABASE_URL  --env deploy -R $R          # prompts; paste the value (nothing is echoed)
gh secret set MIGRATION_DATABASE_URL --env deploy -R $R
# …same pattern for every row of the table
gh secret list --env deploy -R $R                       # names only, to check
```

## D · Commit the pipeline changes and create `production`
```powershell
cd "D:\work\Startups\New idea claude\9arini-app"
git checkout launch-hardening
git add deploy.sh .github/workflows/deploy.yml ops/
git commit -m "deploy: owner role for migrations, ALLOW_MINORS passthrough, ops files"
git push origin launch-hardening
git checkout -B production launch-hardening
git push -u origin production          # ← this push starts the first deploy
```
From now on, to deploy: merge into `production` and push.

## E · Watch and verify
- GitHub → **Actions** → *Deploy to production*: the **ci** job runs first (~15–25 min with Playwright), then **deploy**.
- On the VPS:
```bash
pm2 status                                   # tnajem-api + tnajem-web online
curl -s http://127.0.0.1:4000/health         # {"ok":true,"db":true,...}
curl -sI https://tnajem.com | head -1         # HTTP/2 200
curl -sI "https://tnajem.com$(curl -s https://tnajem.com/fr | grep -o '/_next/static/[^"]*\.js' | head -1)" | grep -i cache-control
#                                            # → public, max-age=31536000, immutable
```
- Log in with your admin e-mail. The code arrives by e-mail, which proves the mail setup.

**If the deploy fails:** the Actions log shows which step failed. `deploy.sh` builds before it restarts anything, so a failed build leaves the previous version online. Paste Claude the failing step's log.
**Emergency deploy without tests:** Actions → Deploy to production → *Run workflow* → tick `skip_tests`.
