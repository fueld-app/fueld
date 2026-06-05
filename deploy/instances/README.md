# Fueld Instance Configurations

Each `.env` file in this directory defines a deployment target (staging, production, or a specific client).

## File Format

```bash
INSTANCE_NAME=client-slug          # Short identifier, used for GitHub environment names
DEPLOY_CHANNEL=stable|testing      # Deployment channel (informational)
VPS_HOST=203.0.113.10              # VPS IP address or hostname
VPS_USER=deploy                    # SSH user (must exist on VPS with passwordless sudo)
DOMAIN=client.example.com            # Primary domain for this instance
APP_DIR=/opt/fueld                 # Application directory on VPS (must match setup-vps.sh)
TLS_MODE=letsencrypt-nginx         # SSL mode: letsencrypt-nginx or cloudflare-wildcard
CERTBOT_EMAIL=ops@example.com      # Email for Let's Encrypt notifications
```

## Existing Instances

| File | Instance | Host | Domain | Purpose |
|------|----------|------|--------|---------|
| `staging.env` | staging | 31.70.79.3 | staging.fueld.app | Staging / pre-production validation |
| `riviera-marine.env` | riviera-marine | 139.162.157.31 | riviera-marine.fueld.app | Production — Riviera Marine |
| `template.env` | — | — | — | Copy this to create new instances |

## Adding a New Client Instance

1. **Copy template**: `cp template.env <client-slug>.env`
2. **Fill in values**: Edit the file with client-specific details
3. **Bootstrap VPS**: Run `setup-vps.sh` on the fresh VPS (see `../../deploy/setup-vps.sh`)
4. **Add SSH key**: Ensure the GitHub Actions SSH key is in `~deploy/.ssh/authorized_keys`
5. **Add GitHub secret** (if using separate keys): Create `VPS_SSH_KEY_<INSTANCE_NAME>` in repo secrets
6. **Deploy**: Use GitHub Actions "Deploy Instance" workflow → `workflow_dispatch` → select your instance

## SSH Key Strategy

### Option A: Shared Key (Simpler)
All instances use the same `VPS_SSH_KEY` GitHub secret. The same private key is authorized on all VPS deploy users.

**Pros**: Simple, one secret to manage  
**Cons**: Key compromise affects all instances

### Option B: Per-Instance Keys (More Secure)
Each instance has its own secret: `VPS_SSH_KEY_STAGING`, `VPS_SSH_KEY_RIVIERA_MARINE`, `VPS_SSH_KEY_CHANNELTX`, etc.

**Pros**: Isolation, fine-grained access control  
**Cons**: More secrets to manage, deploy.yml needs updating

The current `deploy.yml` supports both — see the `Setup SSH key` step which uses `secrets.VPS_SSH_KEY` by default but can be extended for per-instance keys.

## Post-Deploy Customization

After `setup-vps.sh` runs, you may need to customize `/opt/fueld/.env` for client-specific settings:

- `CORS_ORIGIN` — if the client accesses from a different domain
- `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` — must match the client's domain
- `LLI_USERNAME` / `LLI_PASSWORD` — Lloyd's List Intelligence credentials
- `QB_CLIENT_ID` / `QB_CLIENT_SECRET` — QuickBooks integration
- `ADMIN_PASSWORD` — change from auto-generated default

## DNS Setup

Before deploying, ensure the client's domain points to the VPS:

```
A record: client.example.com → <VPS_HOST>
```

If using Cloudflare wildcard certificates, ensure the domain is behind Cloudflare proxy.

## Database Seeding

New instances start with an empty database. To seed initial data:

```bash
# On the VPS, as deploy user
cd /opt/fueld
sudo -u postgres psql -d fueld -f /path/to/seed.sql
# Or run the API's seed script if available
```

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-----------|-----|
| Deploy fails at SSH step | Key not authorized | Add GitHub Actions public key to `~deploy/.ssh/authorized_keys` |
| Health check fails | Binary won't start | Check `journalctl -u fueld-api@blue` or `fueld-api@green` |
| Nginx 502 | Wrong upstream port | Verify `active-slot` file and systemd service status |
| SSL errors | Certificate not issued | Run certbot manually or check DNS propagation |
