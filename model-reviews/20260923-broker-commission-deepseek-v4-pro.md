Thinking...
We need answer as panel review. Need inspect diff, think deeply. Need produce findings numbered severity file:line at ca6929c3, one-line fix. Need answer 8 focus items explicitly. Need done well brief. Verified vs unverifiable. Final verdict.

We need be critical. We cannot execute code but can reason from diff and given facts. Need note severity especially NaN propagation? Need line numbers at ca6929c3. Need know reports.service line numbers from diff: defaultCommissionPerMt line around 2421? Actually diff hunk header @@ -2418,7 +2418,13, so new lines: reportDateField 2422? Need calculate. Let's parse diff. At ca6929c3 new file. Hunk 1 old 2418. New starts at 2418. Lines:

2418 ]) ...
2419 const reportDateField...
2420 const reportDateFallback...
2421? Actually old 2420 maybe. Need precise: Diff context:

@@ -2418,7 +2418,13 @@
   ]) as ...
   const reportDateField: string = bd.reportDateField ?? 'deliveredAt';
   const reportDateFallback: string = bd.reportDateFallback ?? 'eta';
-  const defaultCommissionPerMt: string = String(bd.defaultCommissionPerMt ?? 0);
+  // NOTE: ...
+  // ...
+  // ...
+  // Accept...
+  const defaultCommissionPerMt: string = String(bd.defaultCommissionRate ?? bd.defaultCommissionPerMt ?? 0);
   const commissionCurrency...

Thus old 2418? Let's count after hunk:
2418 `  ]) as ...`
2419 `  const reportDateField...`
2420 `  const reportDateFallback...`
2421 `- const default...`
2422? Actually hunk has 7 old lines? It says -2418,7 +2418,13. Old count 7: lines:
2418 ] as...
2419 reportDateField
2420 reportDateFallback
2421 old default
2422 commissionCurrency
2423 blank?
2424 // Build date filter? Hmm not important. New count 13 means adding 6 lines. New default line is 2426? Let's calculate new:
2418 ] as...
2419 reportDateField
2420 reportDateFallback
2421 // NOTE: the setting is...
2422 // `defaultCommissionPerFt`... maybe 5 comment lines? Actually four comment lines + const line = 5 replacing 1 = +4? Wait diff hunk count old 7 new 13 +6. Replaced 1 line with 5 lines = +4. Where +2 other? Hmm maybe context includes another blank? Need not exact maybe use approximate. We can give `apps/api/src/modules/reports/reports.service.ts:2421` for default fallback. Query select line from second hunk:
@@ -2436,7 +2442,11 @@
       productType...
       quantity...
       unit...
-      commissionPerMt: orderItems.commissionPerUnit,
+      // comment...
+      // ...
+      // ...
+      itemCommissionPerUnit: orderItems.commissionPerUnit,
+      orderCommissionPerMt: orders.commissionPerMt,
...
Old 2436 context line? New 2442. New comment lines start 2442? We'll refer lines maybe 2445/2446. Third hunk:
@@ -2470,7 +2480,15 @@
   let grandTotalCommission = 0;
 
   for (const r of filtered) {
-    const rate = ...
+    // ...
+    // ...
+    // ...
+    // ...
+    const rate = ...
...
New loop rate line maybe 2486? Need not exact, can use hunk approximate. But asked file:line at ca6929c3. We can cite new rate resolution line and quantity multiplication maybe 2486-2493. Need maybe use "reports.service.ts:2485-2490". Fine.

Need answer focus items.

Let's understand code. There are potential issues:

- Rate resolution uses `!= null`; if itemCommissionPerUnit is '0' string? parseFloat('0') = 0, rate 0. If order rate nonzero, per-line 0 wins. Need decide. Sibling `order-financing` uses `parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0`, so 0, NaN, null, undefined, empty string all fall through. Given `commissionPerUnit` likely numeric string in DB, `'0'` as string is truthy? Wait in JS, non-empty string '0' is truthy. But `parseNumber('0')` likely returns 0, then `0 || ...` falls through because 0 falsy. So sibling does not let 0 line rate override. Current fix does. Which is correct? Need reason.

If per-line rate of 0 is meaningful "this line earns no commission", then should override. But does any UI allow setting 0? Tenant default can be 0? Broker deal toggle seeds order rate from default. If per-line `commissionPerUnit` can be 0, maybe deliberate no commission. However `sanitizeNumeric` preserves '0'. Database numeric likely can store 0. The design doc maybe says per-line override? Need know. The current query selects `orderItems.commissionPerUnit` maybe nullable numeric. If a line has 0, this fix gives zero. But is that desired? Could be yes: an explicit per-line rate of zero is a meaningful signal, e.g. a particular product type excluded. But if UI doesn't set it except maybe imported/API and treats blank as null, 0 may be accidental. The sibling reference uses `||`, which conflates 0 with absent. The author asks specifically. Need panel answer: likely HIGH? Maybe not critical because 0 is rare. Need decide if it's a bug: inconsistency with order-financing could create same order showing commission in one report but not financing. That is a defect. We can recommend `parseNumber` guard with `Number.isFinite` and maybe treat explicit 0 as zero? Need know.

We can say: "Use the same resolution semantics as order-financing unless there is a product decision that per-line zero is meaningful; if explicit 0 is meaningful, update sibling too and add test." That might be a HIGH/MEDIUM finding.

- NaN propagation: `parseFloat(String(r.itemCommissionPerUnit))` if value is garbage string e.g. 'abc' yields NaN. The code does no Number.isFinite. Then `commissionAmount = rate * qty` -> NaN. `grandTotalCommission += NaN` -> NaN. `toFixed` maybe `"NaN"`. Does any writer allow non-numeric? `sanitizeNumeric` only sanitizes 'null' etc; it doesn't validate numeric. It might be possible through API to send "abc"? Need see Elysia/TypeBox schema likely numeric? They said silently 422s bodies with undeclared fields, but fields typed as string? Need know order creation? The helper `createBrokerDeal` likely sends `commissionPerUnit` as string. If schema allows string? Need inspect? We only have diff. The author says `sanitizeNumeric` at orders.service.ts:2077 (but provided 1971 maybe). It doesn't guarantee clean number. So NaN propagation is pre-existing? Pre-fix the per-line value could be garbage and NaN; fallback default parse could also be NaN if settings corrupt. But new code now also parses orderCommissionPerMt which might be garbage; likely same risk. The fix didn't introduce, but because report now uses order-level field, new surface? Order-level seeded by UI from tenant default likely numeric. But still report total poisoning is high severity if any bad value. Need finding: HIGH (money report), `reports.service.ts:2486-2493`, "coerce with `Number.parseFloat` and fallback if `!Number.isFinite(rate)`; never allow NaN into total". Severity maybe HIGH because entire report total can be NaN and downstream invoice orders could be wrong. But is it pre-existing? We can mark HIGH or MEDIUM? Since this function creates real orders/invoices, if any bad data causes NaN, severe. But likelihood low because DB numeric columns? Wait if Postgres column numeric, can it store 'abc'? No. The selected `commissionPerUnit` and `commissionPerMt` are probably numeric type. So parseFloat(String(numeric)) yields number or NaN? If DB returns number or string? Drizzle might return string for numeric. For numeric DB value always "3" or null, never "abc". Unless column is text? The sanitizeNumeric suggests fields stored numeric? If column is text? They call parseFloat on strings because drizzle numeric returns string. If DB schema numeric(10,4), non-numeric impossible. So NaN risk maybe from malformed tenant settings? `defaultCommissionRate` likely numeric type? Could be text in settings JSON? Need not high? We can note it's pre-existing/low likelihood but report total poisoning unacceptable. Maybe MEDIUM.

- Date-field fallback: configured `deliveredAt` -> `eta`. The report includes orders not delivered. Is that correct? This is business rule. Moxie may invoice on delivery, but broker commission earned at confirmed? Need not code defect; config choice. Focus item answer: It is configurable per tenant; Frederik's order has deliveredAt null and eta within range so included. If "commission report Moxie will invoice from" should likely use deliveredAt only, but that's a tenant setting/product decision. This fix did not change date fallback. We can raise as MEDIUM/HIGH? Since commission maybe not earned, but if they intentionally use eta to accrue? The design doc may allow fallback. Need not block. Could mention "not introduced; confirm with Moxie; default `reportDateField ?? 'deliveredAt'` with fallback `eta` means un-delivered deals can appear. For invoice-grade report, require `deliveredAt` or separate status filter." But maybe report is used for accrual not invoice? Author says create commission order flow creates real orders from totals. So if included before delivery, real invoice could be created. This is HIGH maybe. However it's pre-existing and not part of fix. We need focus.

- Quantity vs delivered quantity: report uses `orderItems.quantity`; business rule 3 $/mt leveret/delivered. If partial delivered, overcommissions. Given `delivered_quantity` exists but NULL for Moxie broker items. Need answer: This is a defect or product gap, not introduced. Could be HIGH if invoicing; use `COALESCE(orderItems.delivered_quantity, orderItems.quantity)`? But if delivered_quantity NULL for all broker items, maybe they don't track. Could ask customer. Need maybe finding: HIGH/MEDIUM: reports.service.ts quantity line, "commission report should use delivered quantity (or a configurable quantity field) for delivered-based commission; currently overstates on partial deliveries." But if delivered_quantity is null, fallback to ordered quantity? Business rule says leveret. Need perhaps high.

- Unit conversion: Mxie has GAL/M3, rate per MT. Report multiplies raw quantity by per-MT rate. This is severe: For line in GAL, rate per MT times gallons yields wrong. Design doc says not implemented. Does fix make worse? It changes source of rate but not unit handling; if before they got 0, now for GAL line with order-level rate they multiply gallons by per-MT rate, producing a nonzero wrong number. That makes unit mismatch worse in sense previously zero hid it. This could be CRITICAL/HIGH: The fix unmasks unit mismatch by applying order-level rate to non-MT quantity, producing over/under commissions for GAL/M3. Need assess. Moxie has line items in GAL/M3 historically. The report now reports nonzero for them. If they invoice from this, wrong money. Need finding HIGH probably. One-line fix: "Before applying a per-MT rate, convert quantity to MT using unit conversion table (or exclude/flag non-MT lines), as design doc M1 says not implemented." Since this change increases impact, maybe HIGH.

But we need be precise: The query selects `quantity` and `unit`. Does report group or display unit? It likely includes unit maybe. It uses `qty = parseFloat(quantity) || 0`, no unit conversion. For `unit='GAL'`, `rate` per MT, commission = rate*quantity. Wrong. This is pre-existing if per-line rate existed, but before order-level rate fallback caused zero on many broker deals. For a line with per-line rate and unit GAL, it was already wrong. But now order-level fallback can affect GAL lines too. The author asks "Does fix's change of rate source make any unit mismatch worse, or orthogonal?" We need answer: It broadens exposure; not orthogonal. We can mark HIGH.

- Tenant default dead code? UI seeds order rate on toggle, so tenant default branch may be dead in normal UI flow. But API/imports could create broker deal without order rate; test added for that. Dead fallback can mask future rename as before, but at least test sets only current key. We can answer: It's not dead code because API/import/other flows may not seed; keep but ensure settings controller and report share a single typed constant to avoid rename drift. Finding NIT/MEDIUM: centralize settings key.

- Multi-line orders: summing per-line with per-line rate override or order rate fallback. If two lines and no per-line rates, each line gets order rate and sum = order rate × sum quantities. That's correct if order rate is per MT for all items. If one line has per-line override and other not, per-line override for first and order rate for second. Is that intended? Maybe yes per-line override should be per line. No double-counting unless order-level rate also applied separately. The query doesn't group by order? It returns each order item as row then groups by customer/order maybe but sums commissionAmount per line. No double counting. Answer: no double-counting; summing per-line is correct as long as unit conversion handled. But if order has two lines and order-level rate is per order? The field is commission_per_mt, per MT, so per line quantity sum. Good.

- Tests: two new tests fail against old for right reason? Need evaluate. First test old code: itemCommissionPerUnit not selected? Old code selected commissionPerMt as orderItems.commissionPerUnit. In first new test, createBrokerDeal with commissionPerUnit null, then update order commissionPerMt '3'. Old query returns r.commissionPerMt = null (since item null), so rate = parseFloat(defaultCommissionPerMt). default settings has defaultCommissionRate 5? Wait test sets defaultCommissionRate 3? It sets `enableBrokerDeals(seeded.tenant.id, { defaultCommissionRate: 3 });`. Old code reads `bd.defaultCommissionPerMt` (legacy) which is unset, so fallback 0. So old report total 0, new expected 240. Yes fails for right reason. But careful: In old test, before update order commissionPerMt? Old query didn't select order-level, so setting order commissionPerMt has no effect. Good.

Second new test: createBrokerDeal commissionPerUnit '7', then update order commissionPerMt '3'. Old query selected itemCommissionPerUnit as commissionPerMt, so rate 7, total 700. Wait old code would pass this test! Author claims "Both confirmed to fail against ca6929c3~1 by reverting the fix and re-running (2 fail / 13 pass)." But if old code selects item commissionPerUnit '7', then total = 700, which matches expected. Why would it fail? Maybe createBrokerDeal sets commissionPerUnit but old query field name? Let's inspect test helper not in diff. Maybe `createBrokerDeal` with `commissionPerUnit: '7'` stores per-line? likely yes. Old code reads `orderItems.commissionPerUnit` as `commissionPerMt`, so should be 700. Then test expects 700. So not fail. Unless old code's query selection `commissionPerMt: orderItems.commissionPerUnit` and the row object property is `commissionPerMt`; loop uses `r.commissionPerMt`. Yes. That is 7. Then order-level 3 is irrelevant. So old code would pass second test. Author's claim "Both confirmed to fail" seems false for second test. Need investigate. Maybe createBrokerDeal sets `commissionPerUnit` on order_items as `null` if passed? No, it's passed '7'. Maybe `sanitizeNumeric` or DB column? Hmm.

Could there be `commissionPerUnit` not selected due to field name? No old query had `commissionPerMt: orderItems.commissionPerUnit`, so yes.

But maybe old code's fallback test now changed to only defaultCommissionRate, and old code would fail that (13 pass, 2 fail? The new first and fallback? There are 15 tests; old code fails the modified fallback test and first new order-level test. Second new per-line precedence passes old code. Author says both new tests fail—incorrect. Let's read test names: They added two tests: order-level fallback and per-line precedence. They also modified existing fallback. Against old code:
- modified fallback: fails because legacy key missing.
- new order-level fallback: fails because order rate ignored.
- new per-line precedence: passes.
Thus "reverting only rate-resolution expression -> 13 pass, 2 fail" would be true if the two failing are modified fallback + order-level fallback, not both new tests. The author specifically said "Both were confirmed to fail against ca6929c3~1" about "two tests were added: order-level fallback ... and per-line precedence." That seems inaccurate. Need mention in panel: Focus item 8 answer: No, the per-line precedence test would not fail against the old implementation; it only verifies that the new code preserves existing behavior. The author's verification claim is overstated. This is a review finding (LOW/NIT? Verification claim issue). It doesn't mean code bad, but test doesn't defend changed precedence. Could mark LOW/NIT.

Need check test count: original maybe 13? Adding two = 15. Old code fails modified fallback and first new = 2, so 13 pass. If they "reverting only rate-resolution expression" maybe they revert both query selection and rate expression? They said "reverting only the rate-resolution expression" but to fail new first, need also revert query selection? The rate-resolution expression alone old: `const rate = r.commissionPerMt != null ? parseFloat(String(r.commissionPerMt)) : parseFloat(defaultCommissionPerMt);` If query selection new returns itemCommissionPerUnit and orderCommissionPerMt but loop old reads r.commissionPerMt (undefined), so all rates default. Then first new passes? Actually new first item null, order 3, old expression r.commissionPerMt undefined != null false => defaultCommissionRate 3 => 80*3=240, passes. So reverting only rate expression with new query would still pass first. So they likely reverted both hunk 2 and 3. The claim is imprecise.

We need maybe not focus too much on author's verification claim, but output asks answer focus 8.

Need maybe inspect line numbers for findings.

Let's derive precise line numbers from diff new file. Need possibly use `git diff` with context but not actual file. We can give line ranges. Let's reconstruct second hunk new:

Old hunk `@@ -2436,7 +2442,11 @@` means new starts at 2442. Lines:
2442       productType: orderItems.productType,
2443       quantity: orderItems.quantity,
2444       unit: orderItems.unit,
2445       // Per-line override, else the order-level rate. Both are stored; only the
2446       // per-line one is typically set, and the order rate is what the UI seeds
2447       // from the tenant default when a deal is marked as a broker deal.
2448       itemCommissionPerUnit: orderItems.commissionPerUnit,
2449       orderCommissionPerMt: orders.commissionPerMt,
2450       deliveredAt: orders.deliveredAt,
...
So query rate fields at 2448-2449.

Third hunk `@@ -2470,7 +2480,15 @@` new starts 2480:
2480   let grandTotalCommission = 0;
2481 
2482   for (const r of filtered) {
2483     // Commission rate resolution...
2484     // doc: per-line override → order-level rate → tenant default. Reading only
2485     // the per-line field meant any deal priced without a per-line rate
2486     // (the common case) reported zero.
2487     const rate = r.itemCommissionPerUnit != null
2488       ? parseFloat(String(r.itemCommissionPerUnit))
2489       : (r.orderCommissionPerMt != null
2490         ? parseFloat(String(r.orderCommissionPerMt))
2491         : parseFloat(defaultCommissionPerMt));
2492     const qty = parseFloat(String(r.quantity)) || 0;
2493     const commissionAmount = rate * qty;
2494     grandTotalCommission += commissionAmount;
...
So NaN issue lines 2487-2494. Quantity issue line 2492. Unit issue maybe line 2492 and missing conversion. Multi-line sum line 2494.

Need formulate findings.

Potential findings:

1. HIGH: Unit mismatch: `reports.service.ts:2492` multiplies raw `quantity` by per-MT `rate` without converting `unit` (GAL/M3) to MT. The fix broadens the path by applying order-level per-MT rate to lines that may not be MT. One-line fix: convert quantity to MT using unit conversion (or exclude/flag non-MT) before `rate * qty`. Severity maybe HIGH because invoices real orders. But if design doc says not implemented, maybe known gap; however report consumed by invoice creation, so high.

2. HIGH/MEDIUM: NaN propagation: `reports.service.ts:2487-2494`. parseFloat can return NaN; `commissionAmount.toFixed(2)` yields "NaN", total poisoned. One-line fix: use a safe `toFiniteRate` / `Number.isFinite(parsed) ? parsed : fallback` and guard `qty`, never accumulate NaN. Severity maybe HIGH due money total, but low likelihood because DB numeric. Maybe MEDIUM.

3. MEDIUM: `!= null` precedence diverges from `order-financing.ts` `||`. `reports.service.ts:2487` allows per-line `0` to override non-zero order/tenant default. If 0 is not intended as explicit no-commission signal, this creates inconsistency with financing. One-line fix: use the same falsy/`||` or `parseNumber` guard as sibling, or define and test explicit-zero semantics and update sibling. Severity MEDIUM.

4. MEDIUM: Report includes undelivered deals by fallback `deliveredAt -> eta`. `reports.service.ts:2419-2420` (or filter). Because downstream creates commission orders/invoices, Moxie may invoice unearned commission. One-line fix: make fallback opt-in per tenant; for invoice-grade report require `deliveredAt` or status delivered. Severity MEDIUM? Pre-existing but relevant.

5. MEDIUM: Uses ordered quantity not delivered quantity. `reports.service.ts:2492`; business rule leveret. One-line fix: use `COALESCE(delivered_quantity, quantity)` or add report config for quantity field. Severity HIGH? Because overcommissions partial deliveries. But maybe `delivered_quantity` null so fallback ordered. Need high if invoicing. Could be combined with #4? Separate.

6. LOW/NIT: Test claim inaccurate: per-line precedence test does not fail against old implementation, so it doesn't defend the new rate-resolution order. Test should assert against a minimal old query? Could be not code.

7. NIT: `defaultCommissionRate ?? defaultCommissionPerMt` reads settings keys by string, same rename could recur. Centralize typed settings key or add compile-time reference from settings controller. `reports.service.ts:2426`.

Need maybe include "query selected both item and order fields" no issue.

Need answer focus items in order.

Focus item 1: Precedence and `!= null`. We can say:

The intended precedence per-line → order-level → tenant default is correct and matches sibling/design doc. However `!= null` is not the same as `order-financing.ts`'s `parseNumber(...) || ...`. A per-line value of `'0'` (or `0`) will now override a non-zero order rate. If explicit zero means "no commission for this line", that's arguably correct; but there is no test or UI indication that zero is meaningful, and sibling treats it as absent. This divergence can produce different profit/report totals for the same deal. Recommend either use the same guard (`||` after numeric coercion) or make zero semantics explicit in both places with a test.

Focus item 2: NaN propagation. Pre-existing in the per-line path; new order-level path increases surface. DB numeric columns make non-numeric unlikely, but settings JSON/default strings can be malformed. `parseFloat` can yield NaN; there is no guard before multiplication. This poisons grand total and exports. Recommend safe numeric parse.

Focus item 3: Date fallback. Business config; the report intentionally uses `reportDateField`/`reportDateFallback`. Frederik's order has no deliveredAt, so fallback includes it. If report is used to create commission orders/invoices, this is risky. Need confirm Moxie's revenue recognition; maybe require status/delivery. Not introduced by fix.

Focus item 4: Quantity. It uses ordered quantity. If commission is "leveret" (delivered), then partial deliveries overstate. Need raise with customer; `delivered_quantity` exists but null. Not introduced. Could be high.

Focus item 5: Unit conversion. The fix is not orthogonal: by reading order-level per-MT rate for all lines, it now applies a per-MT rate to non-MT lines that previously may have reported 0 (or only used per-line). That can create wrong non-zero commissions. Need unit conversion or filter. High.

Focus item 6: Tenant default branch. UI seeds order rate on toggle, so fallback may be rare, but API/import/other flows may not seed. Keep, but prevent rename regression by sharing settings keys/types.

Focus item 7: Multi-line orders. Summing per-line is correct if each line's quantity is in the same unit as rate; no double-counting. If order rate is per MT and all lines MT, sum per-line equals order rate × total quantity. If mixed units, unit issue applies. No double-counting.

Focus item 8: Tests. The modified fallback test and order-level fallback test fail against old code for the right reason. The per-line precedence test would have passed old code (it already selected per-line), so the claim "both new tests fail" is inaccurate. It only protects the new expression from regressing, not proving precedence. Could add a test that uses a zero per-line rate to lock intended semantics and catch divergence.

Need maybe note "done well": Comments explain bug, fallback compatibility, tests use real regression Moxie case, root cause clear.

Verified-by-reading: We can verify logic from diff and provided sibling/helper; cannot run tests or inspect DB. We can say "test results not independently executed; verification claims partly unverifiable, one claim contradicted by reading."

Need final verdict. Given there are HIGH/medium issues around unit conversion, quantity/delivered, date fallback. But these are pre-existing or design gaps; the fix itself solves underreporting. Do we block? The report creates real orders/invoices. If unit mismatch means the fix may now produce materially wrong non-zero commissions for non-MT items, and quantity vs delivered means overcommissions, maybe needs-fixes or blocked? Need decide.

The requested panel likely expects review of fix. The root cause fixed, but focus items identify issues. The author asks "attack these." Need final verdict maybe "needs-fixes" because unit conversion and delivered quantity are serious enough for invoice-grade report. But are they within diff? The diff doesn't introduce them, but the fix broadens unit mismatch exposure. If Moxie has GAL/M3 historical broker items, now report will produce wrong commissions; this is severe. Could be blocked? We need weigh: The change under review is a bug fix for reported $0.00. Rejecting because of pre-existing unit gap may be too harsh; but if report is used for money, we should not ship without at least guard for non-MT quantities. The author asks final line exactly. We can choose "needs-fixes" with 2-3 sentences: The core fallback fix is correct and well-tested, but before shipping, address unit conversion and delivered/undelivered quantity because the report is used to create real commission orders; the current change will turn $0 rows into potentially wrong non-zero amounts for non-MT lines. Also align zero semantics with order-financing. Maybe "blocked" if we think must fix unit conversion first. The final verdict line must be exactly `VERDICT: <ship-it | needs-fixes | blocked>` + 2-3 sentences. We can write `VERDICT: needs-fixes` and sentence.

Need maybe include line numbers for findings. Let's formulate numbered findings with severity and one-line fix.

Potential finding on `defaultCommissionPerMt` fallback maybe okay.

Let's draft:

1. **HIGH** — `apps/api/src/modules/reports/reports.service.ts:2492` — Non-MT quantities are multiplied by a per-MT rate without conversion. The fix now makes this path reachable via order-level fallback for all lines. Fix: convert `qty` to MT using unit conversion or exclude/flag non-MT lines before commission calculation.

2. **HIGH/MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2487-2494` — `parseFloat` can return `NaN`, and `grandTotalCommission += NaN` poisons the whole report/export/invoice. Fix: use a safe parse helper that returns `0`/fallback on non-finite values; never accumulate NaN.

3. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2487` — `!= null` makes per-line `0` override a non-zero order rate, diverging from `order-financing.ts:239` (`||`). Fix: align the two implementations or explicitly define/test zero-rate semantics.

4. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2492` — Uses `orderItems.quantity` even though commission is on delivered/leveret quantity. Partial deliveries overstate commission. Fix: use `COALESCE(orderItems.delivered_quantity, orderItems.quantity)` or a tenant quantity-field setting.

5. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2419-2420` — `deliveredAt -> eta` fallback can include undelivered orders in an invoice-grade report. Fix: make fallback configurable and/or require delivered status before allowing commission-order creation.

6. **LOW** — `apps/api/src/modules/reports/reports.service.ts:2426` — Stringly-typed settings key still risks future rename drift. Fix: share a typed constant between settings controller and report.

7. **NIT** — `apps/api/tests/broker-deal-commission-report.e2e.test.ts` around new per-line test — The new per-line precedence test does not fail against the old implementation, so the verification claim is overstated. Fix: add a zero-rate precedence test and correct claim.

Need ensure not too many high. Could combine #4/#5? They are distinct. We can keep 7.

Need answer "Verified-by-reading vs unverifiable": 
- Verified by reading: precedence chain, fallback key rename, query selected order-level, tests modify fallback, NaN no guard, unit no conversion, quantity uses ordered qty, date fallback.
- Unverifiable: actual test run, production numbers, exact schema/unit data distribution, UI/import flows.

Need maybe mention line numbers in test? For NIT, we can cite test file line maybe new test starts around 190? Diff hunk `@@ -168,6 +171,55 @@` new test order-level at 171? Let's calculate: It inserted after line 168 maybe first new test starts 171. Per-line test maybe around 210? Not necessary.

Need be concise but thorough.

Let's ensure final answer obeys output format exactly: (1) numbered findings, (2) explicit answers to 8 focus items, (3) done well, (4) verified-by-reading vs unverifiable, (5) final line exactly.

Need maybe include "severity (CRITICAL/HIGH/MEDIUM/LOW/NIT)" in each. We have no CRITICAL. Is unit mismatch CRITICAL? Maybe if money invoices real orders, maybe HIGH. Let's assess if any finding should be CRITICAL. The report creating real orders from wrong unit could be CRITICAL: For Moxie historical GAL/M3, the fix may produce false non-zero commission and a user could create an invoice. But design doc M1 says not implemented; maybe known. Severity maybe HIGH not CRITICAL. If it were production data with mixed units, could be material. The author mentions Moxie has line items in GAL/M3 historically. This could cause serious overbilling. Maybe we should mark CRITICAL: "Unit mismatch will produce wrong monetary amounts for any non-MT line; because the output feeds create-commission-order flow, this can create real invoices." Is that critical? The panel review should weigh severity accordingly. I think `CRITICAL` might be justified. But final verdict "needs-fixes" maybe aligns. Let's consider if the report's consumers include UI/CSV/XLSX and create commission order. If someone exports and invoices, wrong. Moxie's historical data includes GAL/M3. The fix turns these from $0 to wrong. That's severe. Let's mark finding 1 CRITICAL. It's not introduced but unmasked/broadened. The review focus item 5 asks "Does fix make worse?" We can say yes.

But if unit conversion is already a known audit note M1, maybe the code owner may not want to fix in this PR. Still a panel should flag CRITICAL. Final verdict maybe blocked? Hmm. The fix could ship with a guard to exclude non-MT from fallback? That would avoid creating wrong invoices. The original bug for Moxie example was MT. But if they have GAL lines, report currently maybe shows wrong. Need block.

Could we say "needs-fixes" rather than blocked? The final line allowed "blocked" if severe. Need choose. I lean `needs-fixes` because core fix is good but not ready due unit/quantity issues. However if CRITICAL unit mismatch, maybe "blocked" might be more appropriate. The instruction says final line exactly `VERDICT: <ship-it | needs-fixes | blocked>` + 2-3 sentences. We can use `needs-fixes` to indicate not ship as-is but not fundamental. But if critical finding maybe blocked? They ask "weigh severity accordingly" and money derived. Maybe `blocked` if there is a CRITICAL bug. Let's decide.

We need maybe answer focus item 5: "Does the fix’s change of rate source make any unit mismatch worse, or is it orthogonal?" If we mark CRITICAL, we say it's worse. That would justify blocked/needs-fixes. But maybe the panel should not block a bug fix due to pre-existing design gap. Yet this report creates real invoices; shipping would produce wrong money for GAL/M3. I'd say `needs-fixes` at least, maybe `blocked` is stronger. The prompt: "Money derived from this function becomes a real invoice — weigh severity accordingly." That suggests we should block if any high severity.

Maybe use `VERDICT: needs-fixes` because fix addresses root cause but before using for Moxie commission/invoicing, unit conversion and quantity semantics must be resolved. "needs-fixes" allows ship after fixes. "blocked" might imply don't merge. I think final `needs-fixes` is safer.

Let's refine findings.

Finding 1 line 2492: We should cite also query fields line 2444 `unit` available. One-line fix: "Apply unit conversion before `rate * qty`; if no conversion exists for the line's `unit`, exclude or flag it rather than using raw quantity."

Finding 2 line 2487-2494. One-line fix: "Use a safe numeric parser such as `const n = Number.parseFloat(...); Number.isFinite(n) ? n : 0` and guard `qty`; never add `NaN`."

Finding 3 line 2487. One-line fix: "Use `parseNumber(r.itemCommissionPerUnit) || ...` to match order-financing, or if explicit zero is meaningful, change both and add test."

Finding 4 line 2492. One-line fix: "Use `COALESCE(orderItems.delivered_quantity, orderItems.quantity)` or a report setting, not raw ordered quantity."

Finding 5 line 2419-2420/date filter. One-line fix: "For invoice-grade output, do not use `eta` fallback; require deliveredAt/status or flag estimated rows."

Finding 6 line 2426. One-line fix: "Replace stringly-typed `bd.defaultCommissionRate ?? bd.defaultCommissionPerMt` with a shared typed settings accessor."

Finding 7 test. One-line fix: "Correct the verification claim; add an explicit `commissionPerUnit: '0'` test to lock zero semantics."

Need maybe include "line numbers at ca6929c3" — we can provide approximations. For first line `reports.service.ts:2492`, but if actual line is 2493? We'll use hunk line approximations with `~`. It says at ca6929c3; maybe okay. Could write `reports.service.ts:2487-2494` etc.

Let's ensure no invented line numbers too wrong. We can use `~` to indicate approximate. But final should be precise enough. The hunk new line numbers can be calculated; we did. `2492` is `const qty`. Good.

Now answer focus items explicitly. Need be concise but not too short. We'll write paragraphs numbered 1-8.

Focus 1: Precedence is correct; `!= null` issue as above.
Focus 2: NaN propagation pre-existing but broadened; numeric columns likely make it low probability but total poisoning unacceptable.
Focus 3: Date fallback is tenant config, risky for invoicing; not introduced.
Focus 4: Ordered qty vs delivered; defect for leveret.
Focus 5: Unit conversion is not orthogonal; it is broadened.
Focus 6: Fallback not dead, but rare; centralize.
Focus 7: Summing per-line is fine; no double-counting.
Focus 8: Tests: modified fallback and order-level fail old; per-line precedence would pass old. Author claim inaccurate.

Need mention "line 239 order-financing" maybe.

Now "What is done well": 
- Root cause correctly identified; fallback key compatibility; query selection explicit; comments; regression test for Moxie case; test modifies old false positive.
- Good documentation.

"Verified-by-reading vs unverifiable": 
- Verified by reading: all code logic, test logic, key rename, NaN etc.
- Unverifiable: actual test run, production reproduction, schema and data distribution, UI/import flows.

Need final line exactly: `VERDICT: needs-fixes — The core fallback fix is correct and the Moxie regression is well captured, but the report now turns previously zero rows into potentially wrong non-zero commissions for non-MT quantities and uses ordered rather than delivered quantity; those must be addressed before this is used to create invoices.`

Need ensure final line starts exactly `VERDICT: needs-fixes` and then 2-3 sentences. The instruction says final line exactly `VERDICT: <ship-it | needs-fixes | blocked>` + 2-3 sentences. We can make it one line. Good.

Let's think if we need mention "CRITICAL" in findings. If final verdict needs-fixes, okay.

Could there be issue with `defaultCommissionPerMt` being string from settings JSON; `String(bd.defaultCommissionRate ?? bd.defaultCommissionPerMt ?? 0)` if defaultCommissionRate is numeric 3, okay. If `0`, string '0'. Good.

Potential bug: `parseFloat(defaultCommissionPerMt)` where `defaultCommissionPerMt` is string; if empty? settings can set ''. `parseFloat('')` NaN. Another NaN source. But settings likely numeric. Finding 2 covers.

Potential issue: `grandTotalCommission += commissionAmount` but commissionAmount maybe `undefined`? rate NaN -> NaN. No.

Potential issue: `commissionAmount.toFixed(2)` on huge? fine.

Potential issue: `parseFloat(String(r.quantity)) || 0` treats quantity '0' as 0, okay. Negative? no.

Potential issue: per-line rate maybe string '0.0000', `!= null` true, parseFloat 0, rate 0. If order rate non-zero, zero override. We noted.

Need maybe mention "order-financing.ts uses `parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0`; if parseNumber returns 0 for '0', `||` falls through." Good.

Need maybe mention "Elysia/TypeBox silently 422s bodies with undeclared fields" not relevant except test helper maybe. Could ignore.

Let's craft final answer elegantly.

Need be careful final answer not too long? Oververbosity 5. We can include all sections.

Let's draft infinal.
...done thinking.

## (1) Numbered findings

1. **CRITICAL** — `apps/api/src/modules/reports/reports.service.ts:2492`  
   `rate * qty` multiplies a per-MT rate by raw `orderItems.quantity` with no unit conversion. The fix now applies the order-level per-MT rate to all lines, including historical GAL/M3 lines, turning some previously zero rows into wrong non-zero commission amounts.  
   **Fix:** convert `qty` to MT before multiplying, or exclude/flag non-MT lines.

2. **HIGH** — `apps/api/src/modules/reports/reports.service.ts:2487-2494`  
   `parseFloat` can return `NaN`; `grandTotalCommission += NaN` poisons the entire report total, CSV/XLSX export, and any downstream commission order/invoice.  
   **Fix:** use a safe numeric parse (`Number.isFinite(n) ? n : fallback`) and never accumulate `NaN`.

3. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2487`  
   `!= null` makes an explicit per-line `0` override a non-zero order rate. This diverges from `order-financing.ts:239`, which uses `parseNumber(...) || ...` and therefore treats `0` as absent. The two money paths can disagree for the same deal.  
   **Fix:** align semantics with `order-financing.ts`, or explicitly define and test zero-rate behaviour in both places.

4. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2492`  
   Uses `orderItems.quantity`, but Moxie’s stated rule is “3 $/MT leveret” / delivered. A partially delivered order would commission on the full ordered quantity.  
   **Fix:** use `COALESCE(orderItems.delivered_quantity, orderItems.quantity)` or a tenant-configurable quantity field.

5. **MEDIUM** — `apps/api/src/modules/reports/reports.service.ts:2419-2420`  
   The `deliveredAt → eta` fallback can include undelivered orders. Since this report can create real commission orders/invoices, that may invoice commission not yet earned.  
   **Fix:** make fallback explicitly opt-in, or require delivered/status before allowing invoice creation from the report.

6. **LOW** — `apps/api/src/modules/reports/reports.service.ts:2426`  
   The fallback still reads a stringly-typed settings key. A future rename could silently regress again.  
   **Fix:** share a typed settings constant/accessor between settings controller and report.

7. **NIT** — `apps/api/tests/broker-deal-commission-report.e2e.test.ts`  
   The new “prefers the per-line rate” test would have passed against the old implementation, so the claim that both added tests fail against `ca6929c3~1` is overstated.  
   **Fix:** add an explicit per-line `0` vs order-rate test to lock the intended precedence semantics.

## (2) Answers to the 8 focus items

1. **Precedence and `!= null`**  
   The precedence chain itself is correct and matches the design doc and sibling implementation. The questionable part is `!= null`: it lets a per-line `0` override a non-zero order rate. That may be semantically correct if `0` means “this line earns no commission”, but `order-financing.ts` currently treats `0` as absent via `||`. This inconsistency is the main logic risk in the fix.

2. **NaN propagation**  
   Yes, `parseFloat` can yield `NaN`, and `rate * qty`, `toFixed(2)`, and `grandTotalCommission += ...` all propagate it. It is partly pre-existing, but the new order-level fallback widens the surface. Database numeric columns make it unlikely, but malformed tenant settings or bad string data are enough. This should be hardened because the total becomes `NaN` for the whole report.

3. **Date-field fallback**  
   The report intentionally uses `reportDateField ?? 'deliveredAt'` with `reportDateFallback ?? 'eta'`. Frederik’s example is included because `delivered_at` is null and `eta` falls in range. If this report is invoice-grade, that is risky: commission may not yet be earned. This is a tenant/product decision, not introduced by this diff, but it should be confirmed before Moxie uses the report for invoicing.

4. **Ordered vs delivered quantity**  
   This is a real defect for a “leveret” commission rule. The code multiplies ordered quantity. If Moxie has partial deliveries, the report will overstate commission. `delivered_quantity` exists but is null for their broker items today, so the business currently may not rely on it. Still, the report should not silently use ordered quantity if the customer’s rule is delivered quantity.

5. **Unit conversion**  
   Not orthogonal. The fix makes unit mismatch worse in practice: it now reads an order-level per-MT rate for every line and applies it to raw quantities. Any GAL/M3 broker line that previously reported zero can now report a wrong non-zero commission. That is more dangerous than the prior zero because it looks plausible and can become an invoice.

6. **Tenant-default branch**  
   It may be rare in normal UI flow because the UI seeds the order rate on broker toggle, but API/import/other flows may not. Keep the fallback, but centralize the settings key to avoid the exact rename regression that caused this bug.

7. **Multi-line orders and group-by**  
   Summing per line is correct if every line’s quantity is in the same unit as the rate. There is no double-counting from the group-by itself. If the order rate is per MT and all lines are MT, sum-per-line equals `orderRate × totalQuantity`. Mixed units are broken by finding 1, not by summation logic.

8. **Do the two new tests defend the change?**  
   The modified tenant-default fallback test and the order-level fallback test fail against the old code for the right reason. The per-line precedence test would **not** fail against the old implementation because the old query already read `orderItems.commissionPerUnit`. It protects the new expression from a future regression but does not prove the precedence change.

## (3) What is done well

- Root cause is correctly identified: two separate faults, and the fix addresses both.
- The new query selection makes the two possible rate sources explicit.
- The tenant fallback accepts both current and legacy keys, which is practical for deployed instances.
- The added Moxie-style order-level fallback test captures the actual production failure mode.
- The comments in the code explain why the fallback key rename mattered.

## (4) Verified-by-reading vs unverifiable

**Verified by reading:**  
- Rate resolution precedence in the new code.
- The legacy settings-key fallback.
- The new order-level query fields.
- Absence of unit conversion.
- Absence of safe numeric parsing.
- Use of ordered quantity rather than delivered quantity.
- Date-field fallback still `deliveredAt → eta`.
- The test claim issue: the per-line precedence test would pass against the old implementation.

**Unverifiable:**  
- Actual test execution (`15 pass` / `2 fail`).
- Production reproduction numbers against Moxie DB.
- Exact schema/unit distribution in Moxie data.
- Whether any writer can persist non-numeric `commissionPerUnit` or `commissionPerMt`.

---

VERDICT: needs-fixes — The core fallback fix is correct and fixes the reported Moxie zero-commission bug, but the report is used to create real invoices and still multiplies raw quantities by per-MT rates without unit conversion, uses ordered rather than delivered quantity, and can include undelivered deals via `eta` fallback. Those issues must be resolved or explicitly guarded before this is used for commission invoicing.

