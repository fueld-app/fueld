# Panel digest — companies tenancy fix (rounds 1 and 2)

Panel: deepseek-v4-pro:0813, glm-5.3, kimi-k3 (ollama HTTP API, no-tools directive, `think:false`).
Raw: `20260930-companies-tenancy-*.md` (round 1) and `-r2-*.md` (round 2).

## Verdicts
| round | deepseek | kimi | glm |
|---|---|---|---|
| 1 | NO-GO | APPROVE-WITH-CONDITIONS | NO-GO (implied; MUSTs listed) |
| 2 | NO-GO (3 reads unscoped) | APPROVE-WITH-CONDITIONS | length-capped, MUSTs listed |

**Round 1 was reviewed on a partial fix, and the panel was right.** I had fixed the
`params.id` surface only. All three found the same three holes one level down:

1. **`getCompanyBySeasearcherId` unscoped** — and therefore `importCompanyFromSeasearcher`'s
   dedupe, so tenant B could be handed tenant A's record of the same Seasearcher company and
   then skip creating its own. (glm MUST-1, kimi MUST-1, deepseek M5/M6)
2. **Child-resource routes take the CHILD id** (`/contacts/:contactId`, `/emails/:emailId`,
   `/offices/:officeId`, `/attachments/:attachmentId`), so the `params.id` guard never fires.
   glm called this the same bug class, "just one level down". (glm MUST-2, kimi MUST-2, deepseek M1)
3. **`setParentCompany` takes `parentId` from the BODY**, unchecked, so a cross-tenant parent
   link could be created and then traversed by every group/hierarchy route. (glm MUST-3,
   kimi MUST-3, deepseek M1)
4. deepseek additionally found **seven update functions that take a `tenantId` but never use
   it in the `WHERE`** (`syncCompanyFromSeasearcher`, `acceptSeasearcherValue`, `keepMineValue`,
   `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser`,
   `deleteCompany`) — I had threaded the parameter without applying it. That was a fair hit and
   the most embarrassing of the set, since it defeated the whole point of a REQUIRED parameter.

All fixed, plus: child-resource handlers now return 404 instead of 200-with-`success:false`
(deepseek S1), the raw-SQL credit-groups comment corrected (deepseek M3/M6 — the join
`c.parent_id = p.id` implies nothing about tenants, so the parent-only filter was stated as
weaker than it is), and the websocket skip now logs instead of failing silently.

## Round 2 found reads-inside-writes
deepseek and kimi independently spotted the pattern I had missed: I scoped the `UPDATE` but not
the `SELECT` that precedes it in `updateCompanyContact`, `deleteCompanyContact`, and
`updateCompanyEmail`'s `isPrimary` pre-fetch. The write is correctly refused, but the foreign row
has already been loaded and the function's branching (`source === 'seasearcher'` soft-delete,
the unset-previous-primary step) already ran on it. Fixed by scoping the reads too.

kimi also found that `getCompanyById`'s `isMissingCompanyRegistrationColumnError` fallback still
read by id alone — so scoping would silently disappear during a schema-migration window, exactly
when the fallback fires. And that `getCompanyBySeasearcherId`'s `opts.includeDeleted` was dead
surface (removed). Both real; both fixed.

The customer-ledger asymmetry deepseek flagged (supplier ledger threaded `tenantId`, customer did
not) is now symmetric.

## Verified-by-me, not taken on trust
- **The test bites.** Disabling the route guard fails `answers 404 for another tenant's company`;
  disabling the child-resource scoping fails two more. A guard test that cannot fail is worthless,
  so both were demonstrated. (kimi's round-1 complaint that the tests could not catch these was
  correct — they couldn't, before.)
- **Round-1 refutations:** none needed this time; every round-1 MUST reproduced.
- **deepseek's M3 (SQL injection in `getTopCreditGroups`)** — not a vulnerability: the value is
  bound, not concatenated. Its second half (the comment overstating the join) was correct and fixed.

## Design decisions the panel accepted
- One `onBeforeHandle` rather than 36 per-route checks; 404 not 403; explicit REQUIRED `tenantId`
  rather than an ambient/automatic repository filter. Round 2: "the design is sound and correctly
  executed", "the child-resource scoping via `inArray(…, ownedCompanyIds(tenantId))` is the right
  pattern, consistently applied".

## Left as-is, stated in the code
`getChildCompanies`/`getParentCompany`/`getGroup*` still take only an id (reachable only via
guarded routes; cross-tenant links now refused). `getTopCreditGroups` filters the parent only.
