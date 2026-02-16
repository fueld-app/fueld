# API (local development)

## Safe test database configuration

All DB-backed tests in `apps/api/tests` are guarded to prevent accidental writes to production-like databases.

### Rules enforced by tests

- `NODE_ENV=production` is rejected.
- DB host must be local (`localhost` or `127.0.0.1`).
- Database name must include `test`.
- Production-like URL patterns are rejected.

### Recommended setup

```bash
# 1) Create local test DB once
bun -e "import postgres from 'postgres'; const sql=postgres('postgres://fueld:fueld@localhost:5432/postgres',{max:1}); try { await sql.unsafe('CREATE DATABASE fueld_test'); } catch (e) { if (!String(e?.message ?? e).toLowerCase().includes('already exists')) throw e; } finally { await sql.end({timeout:5}); }"

# 2) Run migrations on the test DB
cd apps/api
DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld_test bun run db:migrate

# 3) Run tests against isolated DB
TEST_DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld_test bun run test:e2e
```

If `TEST_DATABASE_URL` is not set, tests still enforce the safety checks on the resolved DB URL.
