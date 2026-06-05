# New Client VPS Bootstrap Checklist

Use this checklist when bringing a new production server online for a client.

## Pre-Flight

- [ ] Client domain registered and DNS A record points to VPS IP
- [ ] VPS provider account has fresh Ubuntu 24.04 server ready
- [ ] VPS root password or rescue console access available
- [ ] Cloudflare API token ready (if using `cloudflare-wildcard` TLS mode)
- [ ] Client slug decided (e.g., `acme-corp`, used for filenames)

## Step 1: Initial Server Access

```bash
# From your local machine — add your SSH key to root
ssh-copy-id root@<VPS_IP>
# Or manually: ssh root@<VPS_IP>, then paste your public key into /root/.ssh/authorized_keys
```

## Step 2: Run Bootstrap Script

SSH into the VPS as root and run:

```bash
# Option A: Let's Encrypt (recommended for client-owned domains)
DOMAIN=client.fueld.app \
TLS_MODE=letsencrypt-nginx \
CERTBOT_EMAIL=ops@fueld.app \
bash <(curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/setup-vps.sh)

# Option B: Cloudflare Wildcard (if domain is behind Cloudflare)
DOMAIN=client.fueld.app \
TLS_MODE=cloudflare-wildcard \
CF_API_TOKEN=your_cloudflare_api_token \
CERTBOT_EMAIL=ops@fueld.app \
bash <(curl -fsSL https://raw.githubusercontent.com/<owner>/<repo>/main/deploy/setup-vps.sh)
```

Or clone the repo and run locally:
```bash
git clone <repo-url> /tmp/fueld
cd /tmp/fueld/deploy
DOMAIN=client.fueld.app TLS_MODE=letsencrypt-nginx bash setup-vps.sh
```

## Step 3: Save Generated Secrets

The script outputs:
- Database password
- Admin password
- JWT secrets (stored in `/opt/fueld/.env`)

**Save these immediately** — they won't be shown again.

```bash
# Backup the .env file
scp root@<VPS_IP>:/opt/fueld/.env ./<client>-<date>.env.backup
```

## Step 4: Customize Environment

Edit `/opt/fueld/.env` on the VPS for client-specific settings:

```bash
ssh deploy@<VPS_IP>
sudo nano /opt/fueld/.env
```

Key settings to review:
- `CORS_ORIGIN` — should match client's access domain
- `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` — must match `DOMAIN`
- `APP_URL` — should be `https://<DOMAIN>`
- `LLI_USERNAME` / `LLI_PASSWORD` — Lloyd's List Intelligence (if subscribed)
- `QB_CLIENT_ID` / `QB_CLIENT_SECRET` — QuickBooks (if integrated)
- `ADMIN_PASSWORD` — change from auto-generated to client-provided or secure default

## Step 5: Add GitHub Actions SSH Access

The `deploy` user was created by `setup-vps.sh` with your root SSH key copied over.

If using a **shared key** (same as staging):
- Ensure `VPS_SSH_KEY` secret in GitHub repo contains the private key that matches `~deploy/.ssh/authorized_keys`

If using a **per-instance key** (recommended for clients):
```bash
# On the VPS, as deploy user
ssh-keygen -t ed25519 -f ~/.ssh/github_actions_<client> -C "github-actions-<client>"
cat ~/.ssh/github_actions_<client>.pub >> ~/.ssh/authorized_keys
# Copy the private key to GitHub secrets as VPS_SSH_KEY_<INSTANCE_NAME>
```

## Step 6: Create Instance Config

Create `deploy/instances/<client-slug>.env`:

```bash
INSTANCE_NAME=<client-slug>
DEPLOY_CHANNEL=stable
VPS_HOST=<VPS_IP>
VPS_USER=deploy
DOMAIN=<client-domain>
APP_DIR=/opt/fueld
TLS_MODE=letsencrypt-nginx
CERTBOT_EMAIL=ops@fueld.app
```

Commit and push:
```bash
git add deploy/instances/<client-slug>.env
git commit -m "infra: add <client> production instance"
git push
```

## Step 7: Seed Database (Optional)

For a fresh client with no data:
```bash
# Run migrations automatically on first deploy (the API does this)
# Or manually:
cd /opt/fueld/blue
sudo -u deploy ./app-release db:migrate
```

For a client migrating from another system, restore from backup:
```bash
# On VPS
sudo -u postgres pg_restore -d fueld /path/to/backup.sql
```

## Step 8: First Deploy

1. Go to GitHub → Actions → "Deploy Instance"
2. Click "Run workflow"
3. Select your `<client-slug>` instance
4. Choose branch/tag to deploy (usually `main`)
5. Run workflow

## Step 9: Verify

```bash
# Check health
curl -sf https://<client-domain>/api/health

# Check systemd status
ssh deploy@<VPS_IP> "systemctl status fueld-api@blue fueld-api@green fueld-llm"

# Check nginx
ssh deploy@<VPS_IP> "sudo nginx -t && sudo systemctl status nginx"

# Check SSL
curl -vI https://<client-domain> 2>&1 | grep -i "subject:\|issuer:\|ssl"
```

## Step 10: Handover

- [ ] Admin credentials shared with client securely (1Password, etc.)
- [ ] Domain and DNS documented
- [ ] VPS provider credentials documented
- [ ] `.env` backup stored securely
- [ ] GitHub environment configured (if using environment protection rules)
- [ ] Monitoring/alerts set up (if applicable)
- [ ] Client onboarding call scheduled

## Troubleshooting

### Bootstrap fails at SSL step
- DNS A record may not have propagated yet
- For Let's Encrypt: ensure port 80 is open (`ufw allow 'Nginx Full'`)
- For Cloudflare: ensure API token has `Zone:Read` and `DNS:Edit` permissions

### Deploy fails at SSH step
- Verify `~deploy/.ssh/authorized_keys` contains the correct public key
- Check `VPS_SSH_KEY` (or `VPS_SSH_KEY_<INSTANCE_NAME>`) GitHub secret matches
- Ensure VPS firewall allows SSH (port 22)

### Health check fails after deploy
- Check `journalctl -u fueld-api@blue` or `fueld-api@green`
- Verify database is running: `sudo -u postgres psql -c "SELECT 1"`
- Check `.env` file permissions: `chmod 600 /opt/fueld/.env`
- Verify migrations ran: check `/opt/fueld/drizzle` directory exists

### Nginx 502 Bad Gateway
- Check active slot: `cat /opt/fueld/active-slot`
- Verify systemd service is active: `systemctl is-active fueld-api@blue`
- Check nginx upstream config: `cat /etc/nginx/conf.d/fueld-upstream.conf`

## Rollback

If deploy fails, the blue-green script automatically keeps the previous slot active. To manually rollback:

```bash
ssh deploy@<VPS_IP>
# Switch nginx back to the other port
sudo tee /etc/nginx/conf.d/fueld-upstream.conf >/dev/null <<EOF
upstream fueld_api {
    server 127.0.0.1:<OTHER_PORT>;
}
EOF
sudo nginx -t && sudo systemctl reload nginx
```
