# Manual VPS Deployment Guide

This document covers the **manual** deploy flow — when you're deploying from
your local machine instead of GitHub Actions. Use this for hotfixes, testing,
or when CI is unavailable.

---

## ⚠️ Critical Checklist Before Every Deploy

### 1. Database Migrations (MOST COMMON FAILURE POINT)

If you created a new migration file in `apps/api/drizzle/`, you **MUST**
register it in the drizzle journal. The API's migration runner reads
`meta/_journal.json` to discover migrations — a file that exists on disk
but is not in the journal **will be silently ignored**.

```bash
# Check: does your new migration appear in the journal?
cat apps/api/drizzle/meta/_journal.json | jq '.entries[-3:]'

# If your migration is NOT listed, add it:
# Option A: Use drizzle-kit to regenerate (preferred)
cd apps/api && bun run db:generate

# Option B: Manually add to the journal (quick fix)
# Edit meta/_journal.json and append to .entries:
# {
#   "idx": <next number>,
#   "version": "7",
#   "when": <timestamp_ms>,
#   "tag": "<filename_without_.sql>",
#   "breakpoints": true
# }
```

**Verify before deploying:**
```bash
# Your migration file exists:
ls apps/api/drizzle/00XX_your_migration.sql

# Your migration is in the journal:
cat apps/api/drizzle/meta/_journal.json | jq '.entries[-1].tag'
# Should output: "00XX_your_migration"
```

### 2. Build Configuration

- **Frontend**: Always build with the default `production` configuration.
  ```bash
  cd apps/web && sh scripts/ng.sh build
  # NOT: sh scripts/ng.sh build --configuration development
  ```
- **API**: Build with `--compile --minify --target=bun-linux-x64`.
  ```bash
  cd apps/api && bun run build:release
  ```

### 3. Build Metadata

Generate `build-info.json` so the API reports the correct version:
```bash
GIT_SHA=$(git rev-parse HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > build-info.json << EOF
{"appVersion":"0.1.0","deployVersion":"0.1.0+deploy.manual.sha.${GIT_SHA:0:8}","gitSha":"$GIT_SHA","gitBranch":"main","buildTime":"$BUILD_TIME","backupFormatVersion":1,"githubRunNumber":null}
EOF
```

---

## Full Manual Deploy Script

Copy-paste this block. It builds, packages, deploys to all 4 servers,
and verifies health checks.

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# ── 0. Pre-flight checks ──────────────────────────────────────────
echo "Pre-flight checks..."

# Verify migration journal is up to date with migration files
MIGRATION_FILES=$(ls apps/api/drizzle/*.sql 2>/dev/null | xargs -I{} basename {} .sql | sort)
JOURNAL_TAGS=$(cat apps/api/drizzle/meta/_journal.json | jq -r '.entries[].tag' | sort)
MISMATCH=$(diff <(echo "$MIGRATION_FILES") <(echo "$JOURNAL_TAGS") || true)
if [ -n "$MISMATCH" ]; then
  echo "❌ Migration files and journal are out of sync:"
  echo "$MISMATCH"
  echo "Fix: cd apps/api && bun run db:generate"
  exit 1
fi
echo "✅ Migrations in sync"

# ── 1. Build ──────────────────────────────────────────────────────
echo "Building API..."
cd apps/api && bun run build:release
cd ..

echo "Building frontend..."
cd apps/web && sh scripts/ng.sh build
cd ..

# ── 2. Generate build metadata ────────────────────────────────────
GIT_SHA=$(git rev-parse HEAD)
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cat > build-info.json << EOF
{"appVersion":"0.1.0","deployVersion":"0.1.0+deploy.manual.sha.${GIT_SHA:0:8}","gitSha":"$GIT_SHA","gitBranch":"main","buildTime":"$BUILD_TIME","backupFormatVersion":1,"githubRunNumber":null}
EOF

# ── 3. Package artifacts ─────────────────────────────────────────
gzip -c apps/api/app-release > /tmp/app-release.gz
COPYFILE_DISABLE=1 tar -C apps/web/dist/web/browser -czf /tmp/web-browser.tar.gz .
COPYFILE_DISABLE=1 tar -C apps/api/drizzle -czf /tmp/drizzle.tar.gz .
cp build-info.json /tmp/build-info.json

echo "Artifacts ready:"
ls -lh /tmp/app-release.gz /tmp/web-browser.tar.gz /tmp/drizzle.tar.gz /tmp/build-info.json

# ── 4. Deploy to all servers ──────────────────────────────────────
SERVERS=(
  "139.162.157.31:riviera-marine"
  "74.208.245.215:channeltx"
  "31.70.94.96:moxie"
  "31.70.79.3:staging"
)

for host in "${SERVERS[@]}"; do
  IP="${host%%:*}"
  NAME="${host##*:}"
  VPS="deploy@${IP}"
  APP_DIR="/opt/fueld"
  echo ""
  echo "═══ ${NAME} ═══"
  ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 "$VPS" \
    "rm -rf ${APP_DIR}/staging && mkdir -p ${APP_DIR}/staging" || { echo "SSH failed"; continue; }
  scp -o StrictHostKeyChecking=no /tmp/app-release.gz    "$VPS:${APP_DIR}/staging/app-release.gz"
  scp -o StrictHostKeyChecking=no /tmp/web-browser.tar.gz "$VPS:${APP_DIR}/staging/web-browser.tar.gz"
  scp -o StrictHostKeyChecking=no /tmp/drizzle.tar.gz    "$VPS:${APP_DIR}/staging/drizzle.tar.gz"
  scp -o StrictHostKeyChecking=no /tmp/build-info.json   "$VPS:${APP_DIR}/staging/build-info.json"
  scp -o StrictHostKeyChecking=no deploy/deploy.sh       "$VPS:${APP_DIR}/staging/deploy.sh"
  ssh -o StrictHostKeyChecking=no "$VPS" "cd ${APP_DIR} && bash staging/deploy.sh" 2>&1 | grep -E "✅|❌|Applied migration|Migration failed"
done

# ── 5. Verify health checks ───────────────────────────────────────
echo ""
echo "═══ Health Checks ═══"
for entry in "staging|staging.fueld.app" "riviera-marine|riviera-marine.fueld.app" "channeltx|channeltx.fueld.app" "moxie|moxie.fueld.app"; do
  IFS='|' read -r name domain <<< "$entry"
  printf "%-16s " "$name"
  sha=$(curl -sf --max-time 10 "https://${domain}/api/health" 2>/dev/null | jq -r '.data.gitSha // "?"' | cut -c1-8)
  [ "$sha" = "${GIT_SHA:0:8}" ] && echo "✅ sha:$sha" || echo "⚠️  sha:$sha (expected ${GIT_SHA:0:8})"
done
```

---

## Deploying to a Single Server

If you only need to deploy to one server (e.g., hotfix for Riviera Marine):

```bash
IP="139.162.157.31"  # riviera-marine
VPS="deploy@${IP}"
APP_DIR="/opt/fueld"

ssh -o StrictHostKeyChecking=no "$VPS" "rm -rf $APP_DIR/staging && mkdir -p $APP_DIR/staging"
scp -o StrictHostKeyChecking=no /tmp/app-release.gz     "$VPS:$APP_DIR/staging/"
scp -o StrictHostKeyChecking=no /tmp/web-browser.tar.gz  "$VPS:$APP_DIR/staging/"
scp -o StrictHostKeyChecking=no /tmp/drizzle.tar.gz      "$VPS:$APP_DIR/staging/"
scp -o StrictHostKeyChecking=no /tmp/build-info.json     "$VPS:$APP_DIR/staging/"
scp -o StrictHostKeyChecking=no deploy/deploy.sh         "$VPS:$APP_DIR/staging/"
ssh -o StrictHostKeyChecking=no "$VPS" "cd $APP_DIR && bash staging/deploy.sh"
```

---

## How the Deploy Works (Blue-Green)

```
┌─────────────────────────────────────────────────────┐
│  VPS at /opt/fueld/                                  │
│                                                      │
│  active-slot  ──► "green"  (currently serving)       │
│                                                      │
│  blue/app-release   (port 3000, stopped)             │
│  green/app-release  (port 3001, running)             │
│                                                      │
│  nginx ──► upstream fueld_api { 127.0.0.1:3001 }     │
│  web/browser/  (frontend static files)               │
│  drizzle/     (migration .sql files + meta/)         │
│  .env         (DATABASE_URL, secrets, etc.)          │
│  build-info.json  (version metadata)                 │
│  staging/     (upload area, cleaned after deploy)     │
└─────────────────────────────────────────────────────┘
```

1. **Upload** artifacts to `staging/` via SCP
2. **deploy.sh** extracts everything:
   - `drizzle.tar.gz` → `/opt/fueld/drizzle/` (migration files)
   - `app-release.gz` → `/opt/fueld/{next-slot}/app-release` (API binary)
   - `web-browser.tar.gz` → held in staging until API is healthy
   - `build-info.json` → `/opt/fueld/build-info.json`
3. **API starts** on the inactive slot (blue or green)
4. **Migrations run automatically** on API startup — the `runPendingMigrations()`
   function in `src/index.ts` reads `drizzle/meta/_journal.json`, finds
   unapplied entries, and executes the corresponding `.sql` files
5. **Health check** — `curl http://127.0.0.1:{port}/health`
6. **If healthy**: frontend is promoted, nginx switches upstream, old slot stops
7. **If unhealthy**: rollback — old slot stays active, new slot is stopped

---

## Migration System Details

### How Migrations Work

```
apps/api/drizzle/
├── 0001_initial.sql
├── 0002_*.sql
├── ...
├── 0098_risk_override_permanent.sql    ← the .sql file
└── meta/
    └── _journal.json                    ← MUST list every migration
```

The API's startup code (`src/index.ts → runPendingMigrations()`):

1. Creates `_applied_migrations` table if it doesn't exist
2. Reads `meta/_journal.json` to get the ordered list of migration tags
3. Queries `_applied_migrations` to see which are already done
4. For each unapplied migration:
   - Reads the `.sql` file
   - Splits on `--> statement-breakpoint`
   - Executes each statement
   - Records the tag in `_applied_migrations`

### Creating a New Migration

**Option A: Using drizzle-kit (preferred)**
```bash
cd apps/api
# 1. Edit the schema in src/db/schema.ts
# 2. Generate migration from the schema diff:
bun run db:generate
# This creates the .sql file AND updates meta/_journal.json automatically
```

**Option B: Manual (for hand-written SQL)**
```bash
# 1. Write the SQL file
cat > apps/api/drizzle/0099_your_migration.sql << 'SQL'
ALTER TABLE your_table ADD COLUMN new_col text;
SQL

# 2. Add to journal — THIS STEP IS MANDATORY
# Get the next idx:
NEXT_IDX=$(cat apps/api/drizzle/meta/_journal.json | jq '.entries | length')
# Add the entry:
jq --arg idx "$NEXT_IDX" \
   '.entries += [{"idx": ($idx|tonumber), "version": "7", "when": now*1000, "tag": "0099_your_migration", "breakpoints": true}]' \
   apps/api/drizzle/meta/_journal.json > /tmp/journal.json && \
   mv /tmp/journal.json apps/api/drizzle/meta/_journal.json

# 3. Verify it's there:
cat apps/api/drizzle/meta/_journal.json | jq '.entries[-1]'
```

### Verifying Migrations Ran on a Server

```bash
# Get the DATABASE_URL from the VPS
DB_URL=$(ssh deploy@<IP> "grep DATABASE_URL /opt/fueld/.env" | cut -d= -f2-)

# Check if a specific migration was applied
ssh deploy@<IP> "PGPASSWORD='...' psql -U fueld -h localhost -d fueld \
  -c \"SELECT tag FROM _applied_migrations WHERE tag LIKE '0098%';\""

# Check if a column is nullable (example)
ssh deploy@<IP> "PGPASSWORD='...' psql -U fueld -h localhost -d fueld \
  -c \"SELECT is_nullable FROM information_schema.columns \
       WHERE table_name='risk_overrides' AND column_name='expires_at';\""
```

---

## Server Reference

| Server | IP | Domain | SSH |
|--------|-----|--------|-----|
| Riviera Marine | 139.162.157.31 | riviera-marine.fueld.app | `deploy@139.162.157.31` |
| ChannelTX | 74.208.245.215 | channeltx.fueld.app | `deploy@74.208.245.215` |
| Moxie | 31.70.94.96 | moxie.fueld.app | `deploy@31.70.94.96` |
| Staging | 31.70.79.3 | staging.fueld.app | `deploy@31.70.79.3` |

All servers use:
- SSH user: `deploy` with key-based auth
- App directory: `/opt/fueld`
- Blue-green slots: blue=port 3000, green=port 3001
- Systemd service: `fueld-api@{blue,green}`
- Nginx reverse proxy with TLS
- PostgreSQL 16 on localhost

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Migration didn't run | Not in `meta/_journal.json` | Add entry to journal, redeploy |
| Frontend shows old version | Service worker cache | Hard-refresh (Cmd+Shift+R) or clear SW cache |
| Column shift in Safari | Overlay `<td>` counted as column | Use overlay `<a>` inside existing `<td>` |
| API won't start | Missing env var or bad migration | `journalctl -u fueld-api@blue --no-pager -n 50` |
| Health check fails | API crashed on startup | Check `journalctl` for migration errors |
| `role "deploy" does not exist` | Wrong psql user | Use `PGPASSWORD=... psql -U fueld -h localhost -d fueld` |

---

## Post-Deploy Verification

```bash
# 1. Health check (all servers)
for d in staging.fueld.app riviera-marine.fueld.app channeltx.fueld.app moxie.fueld.app; do
  printf "%-25s " "$d"
  curl -sf "https://$d/api/health" | jq -r '.data.gitSha[:8]'
done

# 2. Check migration status (on a specific server)
ssh deploy@139.162.157.31 "PGPASSWORD='...' psql -U fueld -h localhost -d fueld \
  -c 'SELECT tag FROM _applied_migrations ORDER BY applied_at DESC LIMIT 5;'"

# 3. Check which slot is active
ssh deploy@139.162.157.31 "cat /opt/fueld/active-slot"

# 4. Check API process is running
ssh deploy@139.162.157.31 "ps aux | grep app-release | grep -v grep"
```