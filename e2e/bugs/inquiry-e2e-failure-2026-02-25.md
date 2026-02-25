# E2E: Flaky "Create Inquiry" failure — 2026-02-25

Summary
- Intermittent failure reported for Playwright spec `e2e/trading/inquiry-to-order.spec.ts` when running CI; locally the spec passed when re-run.

Reproduction (what I ran)

1. Install Playwright browsers:

```bash
bun run pw:install
```
2. Run the single spec with clean servers and test DB:

```bash
E2E_REUSE_EXISTING_SERVERS=0 TEST_DATABASE_URL=postgres://fueld:fueld@localhost:5432/fueld_test bun run test:e2e -- e2e/trading/inquiry-to-order.spec.ts
```

Observed result
- Locally the spec passed: 1 passed (12.8s).
- CI reported a failure previously (flaky / environment likely). I had to free ports 3000 and 4200 before Playwright could start servers.

Relevant files
- Playwright spec: `e2e/trading/inquiry-to-order.spec.ts`
- Playwright config: `playwright.config.ts`
- Seed helpers: `apps/api/tests/helpers/seed-playwright.ts`

Likely causes / recommendations
- Flaky due to port conflicts, race conditions starting web/api servers, or timing under CI load.
- Suggestions:
  - Use `reuseExistingServer: true` in CI or ensure CI isolates ports.
  - Add small retries or increased timeouts around modal opening and server-wait steps in the spec.
  - Harden seed/setup to guarantee the seeded entities exist before the UI interactions.

Assignee
- @Tech Lead

Next steps
- Please triage and assign to the Web E2E owner or take ownership. I can open a GitHub issue with this content if you want — confirm and I'll create it.

Logs / commands
- Commands run are included above; full local logs are available on request.
