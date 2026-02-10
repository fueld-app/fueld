#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Fueld VPS Initial Setup — Ubuntu 24.04
#  Run once as root: bash setup-vps.sh
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

DOMAIN="riviera-marine.fueld.app"
BASE_DOMAIN="fueld.app"
WILDCARD_DOMAIN="*.fueld.app"
DEPLOY_USER="deploy"
DB_NAME="fueld"
DB_USER="fueld"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24)}"
ADMIN_PASSWORD="$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 20)"
CF_API_TOKEN="${CF_API_TOKEN:-}"

echo "═══════════════════════════════════════════════════════════"
echo "  Fueld VPS Setup — $DOMAIN ($WILDCARD_DOMAIN)"
echo "═══════════════════════════════════════════════════════════"

# ─── 1. System updates ───────────────────────────────────────────────
echo ""
echo "▶ Updating system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

# ─── 2. Install required packages ────────────────────────────────────
echo "▶ Installing Nginx, Certbot, utilities..."
apt-get install -y -qq \
  nginx \
  certbot python3-certbot-nginx python3-certbot-dns-cloudflare \
  postgresql postgresql-contrib \
  curl unzip jq git ufw fail2ban

# ─── 3. Firewall ─────────────────────────────────────────────────────
echo "▶ Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 'Nginx Full'
ufw --force enable
echo "  ✓ Firewall enabled (SSH + Nginx)"

# ─── 4. Fail2Ban ─────────────────────────────────────────────────────
echo "▶ Configuring Fail2Ban..."
systemctl enable fail2ban
systemctl start fail2ban
echo "  ✓ Fail2Ban active"

# ─── 5. Create deploy user ───────────────────────────────────────────
echo "▶ Creating deploy user..."
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
  mkdir -p /home/$DEPLOY_USER/.ssh
  # Copy root's authorized_keys so the same SSH key works
  if [ -f /root/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/authorized_keys
  fi
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys 2>/dev/null || true
  # Allow deploy user to restart services without password
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/systemctl restart fueld-api@*, /bin/systemctl start fueld-api@*, /bin/systemctl stop fueld-api@*, /bin/systemctl reload nginx, /bin/systemctl status fueld-api@*, /usr/bin/tee" > /etc/sudoers.d/fueld-deploy
  chmod 440 /etc/sudoers.d/fueld-deploy
  echo "  ✓ Deploy user created"
else
  echo "  ✓ Deploy user already exists"
fi

# ─── 6. PostgreSQL ───────────────────────────────────────────────────
echo "▶ Configuring PostgreSQL..."
systemctl enable postgresql
systemctl start postgresql

# Create database and user
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"
# Allow the user to create schemas
sudo -u postgres psql -d $DB_NAME -c "GRANT ALL ON SCHEMA public TO $DB_USER;"

echo "  ✓ PostgreSQL: database=$DB_NAME, user=$DB_USER"

# ─── 7. Install Bun ──────────────────────────────────────────────────
echo "▶ Installing Bun..."
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  # Make bun available system-wide
  ln -sf /root/.bun/bin/bun /usr/local/bin/bun
  ln -sf /root/.bun/bin/bunx /usr/local/bin/bunx
  echo "  ✓ Bun installed"
else
  echo "  ✓ Bun already installed"
fi

# ─── 8. Create application directories ───────────────────────────────
echo "▶ Creating application directories..."
mkdir -p /opt/fueld/{blue,green,web,drizzle,uploads/avatars,uploads/logos}
chown -R $DEPLOY_USER:$DEPLOY_USER /opt/fueld

# Write active slot
echo "blue" > /opt/fueld/active-slot
chown $DEPLOY_USER:$DEPLOY_USER /opt/fueld/active-slot

echo "  ✓ /opt/fueld directory structure created"

# ─── 9. Generate JWT secrets ─────────────────────────────────────────
echo "▶ Generating application secrets..."
JWT_ACCESS=$(openssl rand -base64 48)
JWT_REFRESH=$(openssl rand -base64 48)

cat > /opt/fueld/.env <<EOF
# ═══════════════════════════════════════════════════════════════
#  Fueld Production Environment — generated $(date -Iseconds)
# ═══════════════════════════════════════════════════════════════

# Database
DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME

# JWT (persistent across deploys → sessions survive restarts)
JWT_ACCESS_SECRET=$JWT_ACCESS
JWT_REFRESH_SECRET=$JWT_REFRESH

# Application
PORT=3000
CORS_ORIGIN=https://$DOMAIN
APP_URL=https://$DOMAIN

# WebAuthn / Passkeys
WEBAUTHN_RP_NAME=Fueld
WEBAUTHN_RP_ID=$DOMAIN
WEBAUTHN_ORIGIN=https://$DOMAIN

# Admin seed password (auto-generated)
ADMIN_PASSWORD=$ADMIN_PASSWORD

# Drizzle migrations directory
MIGRATIONS_DIR=/opt/fueld/drizzle

# Lloyd's List Intelligence (optional)
# LLI_USERNAME=
# LLI_PASSWORD=

# QuickBooks (optional)
# QB_CLIENT_ID=
# QB_CLIENT_SECRET=
# QB_REDIRECT_URI=https://$DOMAIN/api/quickbooks/callback
# QB_ENVIRONMENT=production
EOF

chown $DEPLOY_USER:$DEPLOY_USER /opt/fueld/.env
chmod 600 /opt/fueld/.env
echo "  ✓ Environment file created at /opt/fueld/.env"

# ─── 10. Systemd services (blue-green) ───────────────────────────────
echo "▶ Installing systemd services..."
cat > /etc/systemd/system/fueld-api@.service <<'UNIT'
[Unit]
Description=Fueld API (%i)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/opt/fueld
EnvironmentFile=/opt/fueld/.env
Environment=SLOT=%i

# Port: blue=3000, green=3001
ExecStartPre=/bin/bash -c 'if [ "%i" = "green" ]; then echo PORT=3001 > /tmp/fueld-%i-port; else echo PORT=3000 > /tmp/fueld-%i-port; fi'
ExecStart=/bin/bash -c 'source /tmp/fueld-%i-port && export PORT && exec /opt/fueld/%i/app-release'

# Robustness
Restart=always
RestartSec=3
StartLimitIntervalSec=60
StartLimitBurst=10

# Resource limits
LimitNOFILE=65535
MemoryMax=1G

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/fueld/uploads /opt/fueld/.env /tmp
PrivateTmp=true

# Graceful shutdown
TimeoutStopSec=30
KillMode=mixed
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
echo "  ✓ Systemd template unit installed (fueld-api@blue, fueld-api@green)"

# ─── 11. Nginx ───────────────────────────────────────────────────────
echo "▶ Configuring Nginx..."

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Upstream config (swapped during blue-green deploy)
cat > /etc/nginx/conf.d/fueld-upstream.conf <<EOF
upstream fueld_api {
    server 127.0.0.1:3000;
}
EOF

cat > /etc/nginx/sites-available/$DOMAIN.conf <<'NGINX'
# ─── HTTP → HTTPS redirect ───────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name *.fueld.app;

    # Allow ACME challenges for Certbot
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# ─── HTTPS ────────────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name *.fueld.app;

    # SSL (managed by Certbot — placeholders until certs are issued)
    ssl_certificate /etc/letsencrypt/live/fueld.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/fueld.app/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_min_length 256;

    # ─── Frontend (Angular SPA) ───────────────────────────────────────
    root /opt/fueld/web/browser;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;

        # Cache static assets aggressively
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # ─── API proxy ────────────────────────────────────────────────────
    location /api/ {
        proxy_pass http://fueld_api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # File uploads
        client_max_body_size 10M;

        # Timeouts
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }

    # ─── WebSocket proxy ─────────────────────────────────────────────
    location /ws {
        proxy_pass http://fueld_api/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # ─── Uploads (served via API) ─────────────────────────────────────
    location /uploads/ {
        alias /opt/fueld/uploads/;
        expires 1h;
        add_header Cache-Control "public";
    }

    # ─── Swagger docs (optional, remove in hardened prod) ─────────────
    location /api/swagger {
        proxy_pass http://fueld_api/swagger;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/
echo "  ✓ Nginx configured"

# ─── 12. SSL Certificates ────────────────────────────────────────────
echo "▶ Obtaining wildcard SSL certificate ($WILDCARD_DOMAIN)..."

if [ -z "$CF_API_TOKEN" ]; then
  echo "❌ CF_API_TOKEN is required for wildcard certificates via Cloudflare DNS."
  echo "   Export it before running:"
  echo "   CF_API_TOKEN=your_cloudflare_token bash setup-vps.sh"
  exit 1
fi

mkdir -p /root/.secrets/certbot
cat > /root/.secrets/certbot/cloudflare.ini <<EOF
dns_cloudflare_api_token = $CF_API_TOKEN
EOF
chmod 600 /root/.secrets/certbot/cloudflare.ini

# Request wildcard cert via DNS-01 (Cloudflare)
certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/certbot/cloudflare.ini \
  -d "$WILDCARD_DOMAIN" \
  --cert-name "$BASE_DOMAIN" \
  --non-interactive --agree-tos --email admin@fueld.app

# Now enable the full config
ln -sf /etc/nginx/sites-available/$DOMAIN.conf /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# Auto-renewal
systemctl enable certbot.timer
systemctl start certbot.timer
echo "  ✓ SSL certificate issued and auto-renewal enabled"

# ─── 13. Log rotation ────────────────────────────────────────────────
cat > /etc/logrotate.d/fueld <<EOF
/var/log/fueld/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 deploy deploy
}
EOF
mkdir -p /var/log/fueld
chown deploy:deploy /var/log/fueld

# ─── Done ─────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ VPS Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Domain:       $DOMAIN"
echo "  DB User:      $DB_USER"
echo "  DB Pass:      $DB_PASSWORD"
echo "  DB Name:      $DB_NAME"
echo "  DB URL:       postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME"
echo "  Env File:     /opt/fueld/.env"
echo "  App Dir:      /opt/fueld/"
echo ""
echo "  Admin Login:  admin@fueld.app"
echo "  Admin Pass:   $ADMIN_PASSWORD"
echo ""
echo "  ⚠️  SAVE THE PASSWORDS ABOVE — they won't be shown again."
echo ""
echo "  Next steps:"
echo "  1. Add VPS_SSH_KEY to GitHub repository secrets"
echo "  2. Push code to trigger first deployment"
echo "  3. After first deploy, run: bun run /opt/fueld/seed.ts"
echo ""
