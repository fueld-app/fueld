# Panel digest — closing the standing deferrals (20260923)

Brief: `review-panel-brief-deferrals.md`
Final range: **`5294047a..bcc351fe`** (HEAD). Round-1 reviewed `ccea5ce2`; fixes landed in `e7369b9f`, `d669b50c`, `d847e075`, `ef0d392f`, `57777acb`, `ef4a9831`, `989e1583`.

## Verdicts

| Reviewer | Verdict |
|---|---|
| kimi-k3 | needs-fixes at `ccea5ce2` (found **2 CRITICALs**) → **ship-it** at `d847e075` |
| glm-5.3 | found a **HIGH** + the over-hedge → **ship-it** at `ef4a9831`, every claim live-probed |
| deepseek-v4-pro | **ship-it**, findings resolved |

## What was delivered

**Kantox hedging now dates the sell exposure per tranche** — a split order settles in instalments, but the hedge used one order-level value date, so a 50% cash-in-advance tranche was hedged to the same date as the 60-day balance. Each tranche gets its own entry, its own value date, and its own ref.

**Document references are unique per stream** — revision numbers are scoped to a stream, so date+revision was not unique: one live ref (`OFF-20260313-R001`) occurred **12 times**, another 5. Refs already written stay frozen on their rows and on documents in customers' hands.

**Two deferrals were documented as false premises rather than "fixed"** — `logActivity` already swallows all its own errors (a redundant guard I wrote was reverted), and the allocation residual is bounded at 0.004 and erased by `numeric(14,2)` (my "fix" was a no-op, and the test I wrote to prove it caught nothing revealed that).

## The bugs the panel caught

**Two CRITICALs in code I had just written** (Kimi, both confirmed empirically):

1. **Every tranche after the first would have gone unhedged.** The INITIAL fence is a partial unique index on `(tenant_id, order_id, leg) WHERE kind='INITIAL'`, and every SELL entry carries `leg='SO'`. A split order's second tranche violated it — and `pushPlannedEntry` treats a duplicate key as "already claimed" and returns **before submitting**, leaving a console line and nothing else. I reproduced the rejection against the real database. Migration 0129 widens the key to include `entry_ref`, restoring the fence's actual purpose (catching a double-push of the *same* entry).

2. **A payment over-cancelled a split order's hedge.** The close-delta loop gave the FULL payment to every open SELL row. With one row that was harmless; with one row per tranche, a 50k payment against two 50k entries cancelled 100k — the over-cancel that creates an opposite position. Now consumed across entries oldest-first, extracted as `planPaymentClosures` so the loop is testable.

**One HIGH from GLM that neither Kimi nor I caught:**

3. **Re-saving a CONFIRMED order double-hedged the exposure.** The hook fires on every CONFIRMED save with no real-transition guard. That was harmless while refs were a pure function of order data (a repeat hit the same ref and dedup skipped it) — but refs are now schedule-dependent, so adding a schedule and re-saving emitted `#S1`/`#S2` *beside* the existing `#S`, and Kantox accepted both.

**And the follow-ups that mattered more than they looked:**

4. A close that landed at Kantox but timed out locally ended FAILED, and the parent's cancelled total never advanced. The next payment then got a **fresh** ref that Kantox accepted → over-cancel. GLM made the argument that decided it: the sequencing fix had *removed the accidental protection* that used to make this harmless (the old repeated ref was rejected and swallowed). Fixed by making the sync retry recognise `KantoxDuplicateRefError`, exactly as the push path already did.
5. `splitSellLegByTranche` could **over-hedge**: 10 tranches of $0.05 summed to $0.09 (+80%), $1.00 across 150 to $1.49. Largest-remainder allocation made every case exact.
6. A raced close picking a taken ref was silently dropped; it now recounts and retries once.
7. Cancelling a FAILED entry pushed a naked negative (exposure that may never have been opened).

## Test integrity

Every new test was checked against the pre-fix commit. Verdicts: 5 of the new Kantox tests and the sub-cent split test fail against `ccea5ce2`; the value-date and split-shape tests **pass at base** (they are regression pins, not discriminators — stated rather than implied). In the *previous* batch, two of my four financing tests did not discriminate at all and had to be rewritten — the pattern is that a test I have not run against the base is not yet a test.

## Verification

- kantox 59, financing 38, invoice 42, document revisions 46; full API sweep **269 pass**, 1 pre-existing failure.
- Live probes: the second tranche entry rejected before 0129 and accepted after (duplicate same-ref still refused); the parent bump 0→30000 through a fail-then-retry, idempotent on a second pass; the `least()` clamp holding a racing pair at 50000 rather than 100000; no duplicate refs on any instance (Riviera 4 rows / 4 refs, others 0) so 0130 cannot fail to build.
- Migrations 0129/0130/0131 apply cleanly in rolled-back transactions and are journal-registered (the CI journal check greps the tags).

## Deferred with reviewer agreement

- **The re-CONFIRM stale-exposure gap** — a CANCELLED→CONFIRMED or schedule change still emits a new ref set beside live old tranches. No AMEND/reconcile path exists; pre-existing, now visible via `skippedRefs`.
- **The Kantox-side concurrent-close fence** — two payments recorded at once both close, and Kantox nets both (the local books are clamped, the platform is not). Needs reconciliation via `listEntries` per-entry amounts.
- The `verificationRef` 4-hex digest makes collision *unlikely*, not impossible; the SHA-256 fingerprint beside it is the identity. Claim corrected rather than the digest widened.

## Not done

Not deployed. Migrations 0129/0130/0131 must be applied to the four instances with this binary.
