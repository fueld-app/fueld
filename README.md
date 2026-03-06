# Fueld

Bunker trading SaaS built as a Bun + TypeScript monorepo:

- **API**: Bun runtime, Elysia, Drizzle ORM, PostgreSQL
- **Web**: Angular (standalone components, zoneless change detection), Tailwind v4
- **Shared types**: `@fueld/types` workspace package
- **Prod deploy**: GitHub Actions → VPS (Ubuntu) using a **blue/green** systemd + nginx swap

---

## Repo layout

- `apps/api/` — backend service
  - `src/index.ts` — app bootstrap + migrations + WebSocket
  - `src/modules/*` — domain modules (controllers/services)
  - `src/db/schema.ts` — Drizzle schema
  - `drizzle/` — SQL migrations + Drizzle journal
  - `tests/` — Bun tests (unit/service/e2e)
- `apps/web/` — Angular app
  - `src/app/` — features, pages, core services
- `packages/types/` — shared DTOs/enums used by both API and web
- `deploy/` — VPS bootstrap + blue/green deploy script
- `.github/workflows/deploy.yml` — CI build + deploy pipeline
- `docker-compose.yml` — local PostgreSQL

---

## Prerequisites

- **Bun** (used as package manager + runtime)
- **Node.js** (used by Angular CLI tooling in CI; locally Bun runs `bunx ng …`)
- **PostgreSQL** (recommended via `docker-compose`)

---

## Quick start (local development)

### 1) Start Postgres

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` with:

- user: `fueld`
- password: `fueld`
- database: `fueld`

### 2) Install dependencies

```bash
bun install
```

### 3) Run API migrations

```bash
cd apps/api
DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld bun run db:migrate
```

### 4) Seed the dev DB (optional but useful)

```bash
cd apps/api
ADMIN_PASSWORD=password123 DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld bun run src/db/seed.ts
```

### 5) Run dev servers

From repo root:

```bash
bun run dev:api
bun run dev:web
```

- Web: `http://localhost:4200`
- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/swagger`

In production, nginx serves the web app at `/` and proxies the API under `/api/`.
So `https://<domain>/api/health` maps to `http://127.0.0.1:<slotPort>/health`.

---

## Environment variables

### API (local)

Minimum recommended for local dev:

```bash
DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld
CORS_ORIGIN=http://localhost:4200
APP_URL=http://localhost:4200
JWT_ACCESS_SECRET=dev-access-secret
JWT_REFRESH_SECRET=dev-refresh-secret
```

Common/optional:

- `PORT` — API port (default `3000`)
- `MIGRATIONS_DIR` — override migration folder resolution
- `TEST_DATABASE_URL` — test DB URL (see testing section)
- `WEBAUTHN_RP_NAME`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN` — passkeys/WebAuthn
- SMTP:
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`
- Lloyd’s List Intelligence:
  - `LLI_USERNAME`, `LLI_PASSWORD`
- QuickBooks:
  - `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REDIRECT_URI`, `QB_ENVIRONMENT`
- `CREDENTIALS_ENCRYPTION_KEY` — required in production for encrypting stored credentials and for backup/restore portability across VPS moves. In local development, the API can still fall back to a deterministic key derived from `DATABASE_URL`.

### Backup & versioning

- Admin backup/restore lives under the web admin area at `/admin/backup`.
- Exported archives include the PostgreSQL dump, managed uploads, and prompt markdown files. LLM model binaries are intentionally excluded in v1.
- Restores are destructive full replacements. The target instance must have the same schema version and the same `CREDENTIALS_ENCRYPTION_KEY` as the source instance.
- Semantic app version is stored in the repository `VERSION` file.
- Each deploy also generates `build-info.json`, which the API exposes through `/health` and uses for backup manifest metadata.

### Web

The Angular app uses the API via its configured base URL in code (see core HTTP services/interceptors). In production, nginx serves the SPA at `/` and proxies the API under `/api/`.

---

## Database & migrations

### Drizzle

- Schema: `apps/api/src/db/schema.ts`
- Migrations: `apps/api/drizzle/*.sql`

Commands (from `apps/api`):

```bash
bun run db:generate
bun run db:migrate
bun run db:studio
```

### API startup migration behavior

`apps/api/src/index.ts` runs migrations on startup by default.

Migration folder resolution:

1. `MIGRATIONS_DIR` env var (used in production, e.g. `/opt/fueld/drizzle`)
2. `apps/api/drizzle` (when running from monorepo root)
3. `apps/api/src/../drizzle` (when running inside `apps/api`)

At startup the API also asserts critical tables/columns exist (for example push subscriptions and password reset tokens) and will fail fast with a clear “run db:migrate” message if missing.

In production, migrations are applied on **every slot start** (blue/green) using `MIGRATIONS_DIR=/opt/fueld/drizzle` from `/opt/fueld/.env`.

---

## Backend architecture

### Entry point

- `apps/api/src/index.ts`
  - Creates the Elysia app and registers controllers
  - Enables Swagger and CORS
  - Runs pending migrations (unless disabled via `createApp({ runMigrations: false })`)
  - Exposes `GET /health` for deployment health checks
  - Hosts a WebSocket endpoint at `GET /ws?token=…`

### Modules

Backend features are organized as modules under `apps/api/src/modules/`:

- `auth/` — login, 2FA, passkeys, refresh token rotation, password reset
- `admin/` — admin endpoints (users, settings, integrations, security)
- `orders/` — inquiry/order lifecycle
- `documents/` — PDF generation (Offer/Confirmation, Proforma/Nomination, Invoice) using `pdfmake`
- `activity/` — activity/audit logging + real-time session tracking
- `prices/` — price polling + WS push
- `companies/`, `vessels/`, `lloyds/` — entity management + external sync
- `credit/` — credit lines and credit dashboards
- `push/` — push subscription endpoints
- `quickbooks/` — QuickBooks integration

### Database access

- `apps/api/src/db/index.ts` creates a `postgres` connection pool and a typed Drizzle client.
- By convention, modules use Drizzle queries directly (no heavy repository layer).

### Documents / PDFs

PDFs are generated server-side with `pdfmake` in `apps/api/src/modules/documents/document.service.ts`.

In production, the web app typically requests PDFs via API endpoints and displays them (or downloads) as needed.

---

## Frontend architecture

### Angular app setup

- Standalone components
- Router-driven feature pages (`apps/web/src/app/app.routes.ts`)
- Zoneless change detection (`provideZonelessChangeDetection()`)
- HTTP interceptor for auth (`apps/web/src/app/core/auth/auth.interceptor.ts`)
- PWA service worker enabled in production builds

### Feature organization

UI is grouped by “feature areas” under `apps/web/src/app/features/`:

- `trading/` — orders + inquiries
- `admin/` — users, our companies, places, teams, settings, etc.
- `dashboard/`, `credit/`, `companies/`, `vessels/`

---

## Shared types (`@fueld/types`)

`packages/types/` is a workspace package consumed by both apps.

- DTOs/enums are defined in `packages/types/src/*`.
- API responses typically wrap payloads in `ApiResponse<T>`.

---

## Testing

### Root test commands

From repo root:

```bash
bun test apps/api/tests packages/types/tests
bun test --coverage apps/api/tests packages/types/tests
```

### CI

CI runs on GitHub Actions via `.github/workflows/test.yml` and splits the suite into separate jobs:

- Types
- API (mocked)
- API (db)
- API (e2e)
- Web unit

Playwright UI tests are run locally (see below).

Each DB-backed API job provisions a **fresh Postgres database per job**, runs Drizzle migrations, then executes tests.

### Playwright UI tests

Playwright tests live in `apps/web/e2e/`.

```bash
cd apps/web
bun run pw:install
bun run test:e2e
```

### API test suites

From `apps/api`:

```bash
bun run test:mocked   # no DB
bun run test:db       # DB-backed unit/service tests
bun run test:e2e      # end-to-end tests
bun run test:all      # runs all groups
```

### Safe test database rules

DB-backed tests enforce safety checks (see `apps/api/README.md`):

- Rejects `NODE_ENV=production`
- Requires local DB host (`localhost`/`127.0.0.1`)
- Requires DB name to include `test`

Recommended pattern:

```bash
cd apps/api
DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld_test bun run db:migrate
TEST_DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld_test bun run test:e2e
```

### Web tests

From `apps/web`:

```bash
bun run test
```

---

## Deployment (VPS + blue/green)

This repo deploys to a single VPS using:

- **systemd** template unit: `fueld-api@blue` and `fueld-api@green`
- **nginx** for TLS + static SPA + reverse-proxy
- **blue/green swap** based on ports:
  - blue → `3000`
  - green → `3001`

### 1) One-time VPS bootstrap

Script: `deploy/setup-vps.sh` (Ubuntu 24.04)

It:

- Installs nginx, certbot (+ Cloudflare DNS plugin), PostgreSQL, UFW, fail2ban
- Creates a `deploy` user
- Creates `/opt/fueld/{blue,green,web,drizzle,geoip-data,uploads/...}`
- Writes `/opt/fueld/.env` (DB URL, JWT secrets, CORS, app URL, migration dir, etc.)
- Installs systemd unit template `/etc/systemd/system/fueld-api@.service`
- Configures nginx:
  - Serves Angular build from `/opt/fueld/web/browser`
  - Proxies the API at `/api/*` → `http://127.0.0.1:{3000|3001}/*`
  - Proxies WebSocket at `/ws`
  - Serves `/uploads/` directly from `/opt/fueld/uploads/`
- Obtains a wildcard TLS certificate for `*.fueld.app` via Cloudflare DNS

**Important:** it requires `CF_API_TOKEN` exported in the shell when running, because wildcard cert issuance uses DNS-01.

### 2) CI/CD pipeline

Workflow: `.github/workflows/deploy.yml`

On every push to `main`:

- Builds the API as a **standalone Bun binary** (`apps/api/app-release`, target `bun-linux-x64`)
- Builds the Angular app to `apps/web/dist/web/browser/`
- Builds happen on the runner and outputs are copied directly to the VPS via `scp` (no GitHub Actions artifacts)
- Executes the deploy script on the VPS

### 3) Blue/green swap logic

Script: `deploy/deploy.sh`

1. Reads current slot from `/opt/fueld/active-slot` (defaults to blue)
2. Moves new frontend build into `/opt/fueld/web`
3. Moves drizzle migrations into `/opt/fueld/drizzle`
4. Moves new binary into `/opt/fueld/{nextSlot}/app-release`
5. Starts `fueld-api@{nextSlot}` (API runs pending DB migrations on startup)
6. Health-checks `http://127.0.0.1:{nextPort}/health`
7. Writes nginx upstream file `/etc/nginx/conf.d/fueld-upstream.conf` to point to the new port and reloads nginx
8. Writes `/opt/fueld/active-slot`
9. Stops the old slot

If the new slot fails its health check, the script stops it and **leaves the current slot active**.

### 4) Operational commands (on VPS)

Useful commands:

```bash
# Check which slot is live
cat /opt/fueld/active-slot

# View service status
systemctl status fueld-api@blue --no-pager
systemctl status fueld-api@green --no-pager

# Tail logs
journalctl -u fueld-api@blue -f
journalctl -u fueld-api@green -f

# Test health directly
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3001/health

# Validate nginx config
nginx -t
```

### 5) First-time seed data

Local development has a dedicated seed script: `apps/api/src/db/seed.ts`.

For production, the repository currently **does not automatically deploy** the seed script onto the VPS as part of the blue/green deploy step.

Options:

1. **SSH and run from a repo checkout** on the VPS (recommended approach for repeatability).
2. **Copy the seed script + its imports** to the VPS and run it with Bun.

If you choose (2), keep in mind `seed.ts` imports other local files (schema + password hashing), so you must preserve the expected relative paths when copying.

---

## Troubleshooting

### API won’t start after deploy

Common causes:

- **Missing migrations** on the target DB.
  - The API will fail fast if required tables/columns are missing.
  - Fix by running migrations against the production `DATABASE_URL`.

### Blue/green slot health check fails

- Check logs for the new slot:

```bash
journalctl -u fueld-api@blue -n 200 --no-pager
journalctl -u fueld-api@green -n 200 --no-pager
```

- Ensure DB connectivity (credentials in `/opt/fueld/.env`).

---

## Notes for agents

- When adding DB-backed features: update Drizzle schema, add a migration in `apps/api/drizzle/`, and ensure startup schema assertions cover any “must exist” tables.
- When adding API-facing shapes: update `packages/types` so API and web stay aligned.
- Prefer writing tests in `apps/api/tests/` and keep DB-backed tests using a local `*_test` database.
