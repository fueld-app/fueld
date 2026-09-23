# Panel digest — Phase 1 split payment terms, ROUND 2 verification (20260923)

Brief: `review-panel-brief-phase1-round2.md`
Range reviewed: **`82f263fa..7d692e1c`** (HEAD moved 4 times during the round: `5173ae64` → `eeb48a01` → `99f089ee` → `7d692e1c`; all three reviewers re-pulled after each move and verified the tree clean against it).
Round 1 (on `82f263fa`): `20260923-phase1-split-terms-*.md`, all three needs-fixes/blocked.

## Verdicts

| Reviewer | Verdict |
|---|---|
| kimi-k3 | **ship-it** |
| glm-5.3 | **ship-it** |
| deepseek-v4-pro | **ship-it** |

Round-1 findings closed: **12/12** unanimous. The two CRITICALs (render guard rejecting every tranche; void/reissue duplicating the receivable) are closed and independently traced.

## The bug the panel forced out (worth remembering)

Round 1's CRITICAL was mine to begin with, and my **first fix was also wrong** — twice. Recorded because the same shape will recur:

1. **Round-1 code**: the PDF render guard compared the order's FULL lines total to a tranche's frozen SHARE → threw on the first render of every tranche, after burning N invoice numbers.
2. **My fix #1 (5173ae64)** composed the two cases with `&&`: `|linesTotal − frozen| > eps && |share − frozen| > eps`. For a tranche this is **fail-open** — if an edited total happened to equal the tranche's frozen amount, the first term was satisfied and the guard passed. Self-caught; branched per case in `eeb48a01`.
3. **My fix #2 (eeb48a01)** derived the tranche's expected share from its **position in the current live set**. Kimi caught that the sibling filter (`['SENT','PAID','OVERDUE']`) dropped `PARTIALLY_PAID` — and because the residual is absorbed by the LAST tranche, dropping any member changes which share absorbs it. Fixing the status list was not enough: voiding the deposit made the *middle* tranche look like the residual absorber and produced a **spurious refusal on a correct document**. Rewritten in `99f089ee` to **reconstruct** the issuance-time schedule (percents in seq order, VOID rows included, live row wins a seq collision) and re-split with the same last-tranche absorption, compared in rounded cents.

**Lesson:** a guard whose expected value is derived from the *current* population of the thing it guards will break whenever the population changes under a frozen artifact. Reconstruct from the issuance-time inputs. And never compose two mutually-exclusive validity conditions with `&&`.

## Remaining items — all deferred with reasons

| # | Item | Severity | Disposition |
|---|---|---|---|
| NEW-2 | Split sibling payment rows carry no group id | LOW | Ship-safe: no payment edit/delete route exists (only `POST /orders/:id/payments`; verified). **Must be revisited the moment one ships** — the split would double-count. |
| NEW-1 (DeepSeek) | No per-invoice QuickBooks sync route | MEDIUM | The refusal is correct (safe failure); `syncInvoiceToQuickBooks` has no HTTP caller, so split orders cannot reach QB at all. Phase 2. |
| NEW-3 | Sub-cent residual discarded (`> 0.004`) | LOW | Invisible to `numeric(14,2)`, collections, and `amountPaid`. |
| NIT-4 | Half-cent coincidence in the cents guard | NIT | Same tolerance class the unscheduled guard always had. |
| — | `verificationRef` label collision | — | Display label, not identity (verify resolves by token/orderId); pre-existing since Phase 0. |
| — | No per-tranche PDF line proration | — | Deliberate: full quantities are the delivery truth; the "Order total" reconciliation row satisfies the reviewers' Q1 concern (GLM: "exactly that"). |
| — | No web UI for the schedule | — | Phase 1 is API-only; the API now reaches every tranche, so the UI needs no schema/service work. |

## Test integrity

Reviewers verified the count **per commit** (33 → 37 → 38 → 39 → 40 in `invoice.service.test.ts`, +1 HTTP test) and, more importantly, **which tests fail against which base**. DeepSeek named the gap that mattered: the first void-survivor test used a *symmetric* schedule, where a survivor's share is unchanged however you derive it, so it passed at the intermediate positional fixes and did not pin the reconstruction. Closed in `0dd90cab` with an **asymmetric 20/30/50** schedule that voids the residual-absorbing last tranche.

## Verification

- `bun test tests/invoice.service.test.ts` → **40 pass**.
- Serial sweep of 12 affected suites → **191 pass, 2 fail**; both pre-existing (`quickbooks.service > isAppConfigured…`, `documents.controllers.e2e > returns the agent contact…`).
- Real renders via `pdftotext`: `Deposit — 50% of order. Total amount due to Company  342,102.00 USD` / `Order total  684,204.00 USD`; balance due `2026-10-11` (= delivered 2026-09-20 + 21 d).
- Guard exercised **both directions** on real renders: unmodified 3-tranche schedule renders all three; prices edited after issuance refuses all three.

## Residual risk / not done

- Phase 1 has **not been deployed**; migrations `0126`+`0127` are journal-driven and must be applied per VPS. `0127` drops `invoices_one_per_order` and creates `invoices_one_live_per_tranche`; `invoices` is empty on all tenants, so no rewrite risk.
- Nothing downstream consumes the schedule yet (no web UI), so the feature is API-only.
