#!/usr/bin/env bash
# =============================================================================
# Tnajem — VPS bootstrap (Ubuntu 24.04, run ONCE as root on a blank server)
#
#   Installs and configures everything the app needs, but does NOT deploy the
#   app itself (that is Claude Code's Phase B job, following DEPLOY.md):
#
#     1. System: updates, timezone Africa/Tunis, swap, automatic security updates
#     2. Access: an `ubuntu` user with your SSH key, then password + root login OFF
#     3. Firewall: only 22, 80, 443 open; fail2ban on SSH
#     4. Node 22 + pm2 (auto-start on boot for `ubuntu`)
#     5. Postgres 18, tuned to this server's RAM, reachable from localhost only,
#        with a `tnajem` database and TWO roles (owner for migrations, limited
#        app role for runtime — the Phase A+ requirement for the admin log)
#     6. nginx with a temporary "bientôt" page for tnajem.com, + certbot
#     7. Folders for ID scans and backups; a GitHub deploy key for `ubuntu`
#
#   Safe to re-run: every step checks before it changes anything.
#   Secrets are written to /root/tnajem-secrets.txt (chmod 600), never printed.
# =============================================================================
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"   # the account everything runs as
DOMAIN="tnajem.com"
DB_NAME="tnajem"
DB_OWNER="tnajem_owner"
DB_APP="tnajem_app"
PG_VERSION="18"
STORAGE_DIR="/var/lib/tnajem/storage"
BACKUP_DIR="/var/backups/tnajem"
SECRETS_FILE="/root/tnajem-secrets.txt"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0"; exit 1; }
. /etc/os-release
[[ "${ID}" == "ubuntu" ]] || { echo "This script expects Ubuntu (found ${ID})."; exit 1; }
[[ "${VERSION_ID}" == "24.04" ]] || warn "Written for Ubuntu 24.04, found ${VERSION_ID}. Continuing."
export DEBIAN_FRONTEND=noninteractive

# ----------------------------------------------------------------------------
log "1/7  System update, base packages, timezone, swap"
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install curl ca-certificates gnupg lsb-release git ufw fail2ban \
  unattended-upgrades nginx certbot python3-certbot-nginx build-essential htop jq openssl
timedatectl set-timezone Africa/Tunis
ok "timezone: $(timedatectl show -p Timezone --value)"

cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
ok "automatic security updates on"

if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-tnajem.conf
  ok "2 GB swap created (protects next build from running out of memory)"
else
  ok "swap already present"
fi

# ----------------------------------------------------------------------------
log "2/7  $DEPLOY_USER user + SSH hardening"
if ! id "$DEPLOY_USER" &>/dev/null; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER" >/dev/null
  usermod -aG sudo "$DEPLOY_USER"
  ok "user '$DEPLOY_USER' created"
else
  ok "user '$DEPLOY_USER' exists"
fi
# passwordless sudo for $DEPLOY_USER (login is key-only)
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"

install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
if [[ -s /root/.ssh/authorized_keys ]]; then
  cat /root/.ssh/authorized_keys >> "/home/$DEPLOY_USER/.ssh/authorized_keys"
  sort -u -o "/home/$DEPLOY_USER/.ssh/authorized_keys" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
  chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
  ok "your SSH key copied to '$DEPLOY_USER'"

  # 00- so it is read BEFORE cloud-init's 50-cloud-init.conf (first value wins in sshd)
  cat >/etc/ssh/sshd_config.d/00-tnajem.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
  if sshd -t; then
    systemctl reload ssh
    ok "password login and root login DISABLED (key-only, as '$DEPLOY_USER')"
  else
    rm -f /etc/ssh/sshd_config.d/00-tnajem.conf
    warn "sshd config test failed — left SSH unchanged"
  fi
else
  warn "No SSH key found in /root/.ssh/authorized_keys."
  warn "SSH hardening SKIPPED so you don't get locked out. Add your key, then re-run this script."
fi

# ----------------------------------------------------------------------------
log "3/7  Firewall + fail2ban"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ok "ufw: only 22, 80, 443 open"
systemctl enable --now fail2ban >/dev/null 2>&1
ok "fail2ban protecting SSH"

# ----------------------------------------------------------------------------
log "4/7  Node 22 + pm2"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get -y -qq install nodejs
fi
ok "node $(node -v), npm $(npm -v)"
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null 2>&1
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$DEPLOY_USER" --hp "/home/$DEPLOY_USER" >/dev/null
ok "pm2 $(pm2 -v) — starts on boot for '$DEPLOY_USER'"

# ----------------------------------------------------------------------------
log "5/7  Postgres $PG_VERSION"
if ! dpkg -s "postgresql-$PG_VERSION" >/dev/null 2>&1; then
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get -y -qq install "postgresql-$PG_VERSION"
fi
ok "$(sudo -u postgres psql -tAc 'select version()' | cut -d, -f1)"

MEM_MB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 ))
SB_MB=$(( MEM_MB / 4 )); ECS_MB=$(( MEM_MB * 3 / 4 ))
PG_CONF_DIR="/etc/postgresql/$PG_VERSION/main/conf.d"
install -d "$PG_CONF_DIR"
cat >"$PG_CONF_DIR/tnajem.conf" <<EOF
# Tnajem tuning — generated for ${MEM_MB} MB RAM
listen_addresses = 'localhost'
max_connections = 100
shared_buffers = ${SB_MB}MB
effective_cache_size = ${ECS_MB}MB
work_mem = 16MB
maintenance_work_mem = 256MB
random_page_cost = 1.1
timezone = 'Africa/Tunis'
log_min_duration_statement = 500
EOF
systemctl restart "postgresql@$PG_VERSION-main"
ok "tuned for ${MEM_MB} MB RAM (shared_buffers=${SB_MB}MB), localhost only"

touch "$SECRETS_FILE"; chmod 600 "$SECRETS_FILE"
role_exists() { sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$1'" | grep -q 1; }
if ! role_exists "$DB_OWNER"; then
  OWNER_PW=$(openssl rand -hex 24)
  sudo -u postgres psql -q -c "CREATE ROLE $DB_OWNER LOGIN PASSWORD '$OWNER_PW';"
  echo "MIGRATIONS (owner):  postgresql://$DB_OWNER:$OWNER_PW@127.0.0.1:5432/$DB_NAME" >> "$SECRETS_FILE"
fi
if ! role_exists "$DB_APP"; then
  APP_PW=$(openssl rand -hex 24)
  sudo -u postgres psql -q -c "CREATE ROLE $DB_APP LOGIN PASSWORD '$APP_PW';"
  echo "APP RUNTIME (limited): postgresql://$DB_APP:$APP_PW@127.0.0.1:5432/$DB_NAME" >> "$SECRETS_FILE"
fi
if ! sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1; then
  sudo -u postgres psql -q -c "CREATE DATABASE $DB_NAME OWNER $DB_OWNER;"
fi
sudo -u postgres psql -q -d "$DB_NAME" <<SQL
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB_NAME TO $DB_APP;
GRANT USAGE ON SCHEMA public TO $DB_APP;
-- every table/sequence the owner creates later (migrations) is usable by the app,
-- but the app can never CREATE, ALTER, DROP or disable triggers:
ALTER DEFAULT PRIVILEGES FOR ROLE $DB_OWNER IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $DB_APP;
ALTER DEFAULT PRIVILEGES FOR ROLE $DB_OWNER IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO $DB_APP;
SQL
ok "database '$DB_NAME' owned by '$DB_OWNER'; app connects as '$DB_APP'"

# ----------------------------------------------------------------------------
log "6/7  nginx (temporary page) + certbot"
install -d /var/www/tnajem-maintenance
cat >/var/www/tnajem-maintenance/index.html <<'EOF'
<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tnajem — bientôt</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#FBF7F0;color:#101F33;font-family:system-ui,sans-serif;text-align:center">
<div><h1 style="margin:0 0 8px">Tnajem · تنجّم</h1><p style="margin:0;color:#5C6879">Un prof vérifié, en ligne. Bientôt.</p></div></body></html>
EOF
cat >/etc/nginx/sites-available/tnajem <<EOF
# TEMPORARY — replaced by the full config from DEPLOY.md §6 during Phase B
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN www.$DOMAIN;
  root /var/www/tnajem-maintenance;
  location / { try_files \$uri /index.html; }
}
EOF
ln -sf /etc/nginx/sites-available/tnajem /etc/nginx/sites-enabled/tnajem
rm -f /etc/nginx/sites-enabled/default
sed -i 's/# server_tokens off;/server_tokens off;/' /etc/nginx/nginx.conf
nginx -t -q && systemctl reload nginx
ok "nginx serving a 'bientôt' page for $DOMAIN (HTTPS comes next, see below)"

# ----------------------------------------------------------------------------
log "7/7  App folders + GitHub deploy key"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$STORAGE_DIR"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$BACKUP_DIR"
ok "ID scans:  $STORAGE_DIR   (700, owner $DEPLOY_USER)"
ok "backups:   $BACKUP_DIR"
KEY="/home/$DEPLOY_USER/.ssh/github_tnajem"
if [[ ! -f "$KEY" ]]; then
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "tnajem-vps-deploy" -f "$KEY" -q
  cat >>"/home/$DEPLOY_USER/.ssh/config" <<EOF
Host github.com
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
  chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/config"; chmod 600 "/home/$DEPLOY_USER/.ssh/config"
fi

# ----------------------------------------------------------------------------
IP=$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')
cat <<EOF

=============================================================================
 DONE. Server is ready for Phase B.
=============================================================================
 Server IP ........ $IP
 Login from now ... ssh $DEPLOY_USER@$IP        (root login is off)
 DB secrets ....... $SECRETS_FILE   (read with: sudo cat $SECRETS_FILE)

 YOUR NEXT STEPS
 1. BEFORE closing this window: open a NEW terminal and check
       ssh $DEPLOY_USER@$IP
    works. If it doesn't, fix it from this window.

 2. Add this read-only Deploy key on GitHub
    (repo → Settings → Deploy keys → Add, "Allow write access" OFF):

$(cat "$KEY.pub")

 3. Cloudflare DNS: A records  $DOMAIN  and  www  →  $IP
    Proxy status GREY (DNS only) for now.

 4. When  http://$DOMAIN  shows the "bientôt" page, get the certificate:
       sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect -m YOUR_EMAIL --agree-tos
    Then switch Cloudflare to ORANGE (proxied), SSL mode "Full (strict)".

 5. Copy $SECRETS_FILE into your password manager.
=============================================================================
EOF
