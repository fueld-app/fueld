# Panel digest — Atradius insurance cover (Riviera Marine), 20260924

Briefs: `review-panel-brief-atradius.md` (the original design brief, whose 8 questions were never answered) and `review-panel-brief-atradius-round2.md`.
Reviewed: the live feature at `8d38ef82` plus the working-tree fixes. Commits: `900a2056`, `d925dc34`, `b53bccfc`.

## Verdicts

| Reviewer | Verdict |
|---|---|
| kimi-k3 | **needs-fixes** — found 2 CRITICALs (status classification) |
| glm-5.3 | **needs-fixes** — found a CRITICAL (silent partial coverage) + a cross-tenant HIGH |
| deepseek-v4-pro | **needs-fixes** — 2 HIGH, and the double-currency bug |

All findings from all three are now fixed, except two that are deliberately deferred (below).

## This feature was live and unreviewed

Pierre had already imported his real file — 158 buyer rows, 17 matched, 141 unmatched, **€27.16M of active cover of which 84% was invisible**. A design brief with 8 open questions existed, but no review was ever produced, so those questions were being answered by accident in production. The panel was re-run to close that, and it found real money bugs.

## The bugs that mattered

**The mapping UI crashed, so Pierre could not map anything.** `atradius-import-modal.component.ts` read `GET /companies/local` as `ApiResponse<{id,name}[]>`; the endpoint is paginated and returns `{ companies, total }`. So the signal held an object, `@for (cp of counterparties())` threw `t[Symbol.iterator] is not a function`, and the whole modal render tore down immediately after a successful upload. Confirmed from the owner's console capture; there is no other mapping entry point, so the feature was fully blocked for its only user.

**Two statuses were classified inactive and dropped from the column** (−€450k of in-force cover). The file settles both, rather than leaving them to judgement:
- `Annulation future` is a cancellation dated AHEAD — in force until that date. Telford Marine cancels 2026-10-16 (live today); Flex Commodities cancelled 2026-09-19 (already lapsed).
- `Pas d'augmentation de couverture` means an INCREASE was refused and the standing cover holds — Team Bulk asked €300k and holds €100k, Hilf asked €300k and holds €150k, while REFUSED rows carry 0. So AE is the maintained cover.

**The expiry the code relied on could never fire.** `Date de fin` exists in the export but is EMPTY on all 158 rows, so `active: true` alone would have counted a future cancellation as in force *forever*. The governing date is `Date d'annulation` (populated on 14 rows). Both reviewers initially recommended `active: true` on the assumption the end-date guard would handle the cutover; checking the data showed that would have created a permanent overstatement, which is why it was verified against the file before shipping.

**A duplicate-header trap.** The export contains two columns literally named `Date d'annulation`, the second (`_1`) empty on every row, and column resolution kept the LAST match — so a naive alias would have bound the empty column and the date would have been silently always null. Resolution is now first-occurrence-wins.

**Cross-tenant mapping (HIGH).** `PUT /atradius/buyers/match` wrote whatever `counterpartyId` the request body supplied without checking it belongs to the caller's tenant, so a privileged user of one tenant could attribute cover to another tenant's counterparty and have it appear in that tenant's cover map. Now refused, with a test.

**The column read as complete when it was 16%.** An unmapped client rendered as "—", which a credit manager reads as "no insurance" rather than "not mapped yet". The header now states `3 of 158 Atradius buyers mapped — figures cover mapped clients only`, and an unmapped client reads "not mapped" with a tooltip.

Also fixed: the cover cell rendered the currency twice (`€EUR 871,000.00`), because `formatAmount` already prefixes it; and `listUnmatchedBuyers` claimed to list buyers "without a counterparty mapping" while returning every row of the latest import (latent — the modal used a different path, which is why it survived).

## Verified by use, not by reading

Seeded a local tenant with Pierre's real fixture and three real clients, ran the API and web app, and drove the actual browser:

- **155 dropdowns rendered, each with 5 options** (AdI Servizi, GEFO, Sky Fusion, …) — no longer empty.
- **Zero console errors** on upload — the `Symbol.iterator` crash is gone.
- Summary `158 rows / 3 matched / 155 need mapping` matching the DB exactly; "Previous import replaced" confirming replace semantics.
- Rows render `EUR 1,000,000.00` / `EUR 800,000.00` with **no double-currency artefact**; `AdI Servizi` correctly shows no cover (its row is `Refusée`, €0).
- Banner reads `3 of 158 Atradius buyers mapped`, matching the live count.
- Re-import proved persisted mapping by buyer number survives: 3 mappings carried across, `matched_count=3` consistent with 3 live matched rows.
- Local servers and seed data cleaned up; the test harness truncates the rest (verified: residue 0).

## Deferred, with the panel's agreement

- **Aggregation is right as written** — winning row per buyer_number (latest decision, NULLS LAST), then summed across buyer_numbers mapped to one counterparty. Handles multi-decision buyers and several buyer numbers per company (DYNACOM). Not changed. Note Pierre's current export has one row per buyer, so the multi-decision path is untested against real data.
- **The 500-option native `<select>`** should become the existing `searchable-dropdown` component, and `limit: '500'` should warn when `total > list.length`. A usability fix, not a correctness one — the picker works and Pierre can map.
- **Concurrent uploads** have no tenant lock; single uploader today.
- **Per-currency aggregation** — EUR and USD would currently be summed as bare numbers and labelled "EUR/USD". Unreachable with an all-EUR policy, latent otherwise.


## Round 3 — the deferred usability items (`3a299e4f` → `6eefeb32`)

Panel: kimi-k3 and deepseek-v4-pro **needs-fixes** on a defect in the swap I had just written; glm-5.3 needs-fixes, noting all three top items were already fixed in the working tree.

**The defect worth recording: a name-match guess was being applied by default.** The import response carries a normalized-name suggestion per unmatched buyer, and the modal pre-filled `selections` from it. Since Save applies whatever is selected, every guessed match became a MANUAL mapping without the user confirming anything — and those guesses are precisely the ones that are often wrong (`GEFO GESELLSCHAFT FÜROELTRANSPORTE MBH` vs `GEFO Gesellschaft fur Oeltransporte mbH`). A wrong guess writes one client's insured cover onto another. It existed in the old `<select>` too, which is why it survived two rounds; the swap made it more discoverable. Now a one-click hint ("name suggests X") that must be taken deliberately. Riviera's live data confirms nothing was mis-applied: 17 mappings, all EXACT.

Also fixed: `limit=50` truncation on broad/unfiltered searches (my "never truncated" comment was false), an out-of-order async-search race across ~150 shared pickers (sequence token), `chosenLabels` never refreshing so a renamed client stayed offered under its old name, and a `saveMappings` re-entry guard.

**A self-inflicted regression, caught only by browser verification:** my block edit deleted the two lines storing the import response, so the summary stopped rendering while the upload still returned 201. Tests and typecheck were green; only driving the real UI caught it. Restored and re-verified: 158 pickers, zero native selects, `admiral` narrowed to one client, selection and clear both work.

**GLM raised `/companies/local` as tenant-blind.** Not a defect here: each tenant has its own Postgres (recorded in project memory, and the reason `invoices` carries no `tenantId`), so an unscoped query cannot cross tenants. Verified rather than assumed.

**Deferred, unchanged:** the picker should arguably use the component's async `selectedLabel` rather than a local label cache; the concurrency test is timing-dependent (a fully-serialized run would pass even without the lock, so it is a smoke test rather than proof).

## Reply to Pierre

His email asked for: (1) the cover column on the credit limits page — done; (2) monthly Excel upload with replace — done, and it survives re-upload through persisted mapping; (3) whether to ask Atradius for an API — his call, and worth answering directly. The honest answer includes the mapping step: his file's buyer names do not match Fueld's spellings (`GEFO GESELLSCHAFT FÜROELTRANSPORTE MBH` vs `GEFO Gesellschaft fur Oeltransporte mbH`), so 141 buyers need mapping ONCE and are then remembered by buyer number.
