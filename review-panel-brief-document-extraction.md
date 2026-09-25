# Panel Review — extracting shared blocks from the document builders

Frozen commit: **`c42fb3c9`** in `/Users/patrickpereira/fueld`. Range: **`c42fb3c9~1..c42fb3c9`** (`git diff c42fb3c9~1 c42fb3c9`).

Also in scope, because it is the reason this refactor exists (review them together): **`8bbbc799`** — "never print another entity's bank account; use the tenant accent" (`git show 8bbbc799`). Review `8bbbc799~1..c42fb3c9` if you prefer one range.

## Context

Moxie (Daniek) asked by WhatsApp for "sleeker" invoices, attaching **their own** invoice as the reference. Comparing it to what Fueld renders shows the difference is structural, not cosmetic — so the plan is a tenant-scoped document shell. This commit is the behaviour-preserving prep: extracting blocks that the two live builders duplicated.

`apps/api/src/modules/documents/document.service.ts` is ~3570 lines with three layout functions:

| Function | ~Lines | Status |
|---|---|---|
| `buildProformaDocument` | 455 | **LIVE** — reached via `generateOrderInvoicePdfBuffer` (real invoices) and `generateProformaInvoicePdfBuffer` |
| `buildOfferDocument` | 449 | **LIVE** — offers, confirmations, nominations |
| `buildInvoiceDocument` + `generateInvoicePdfBuffer` | 463 + 132 | **DEAD** — no route; only a barrel re-export and three tests reference them |

## What changed in c42fb3c9

Two extractions, both from blocks that were **character-identical** between the two live builders:

- `buildDocumentFooter(params)` — page footer (issuer address, contacts, page number, revision/fingerprint line).
- `buildCustomerBlock(params)` — the "Bill To" party block.

Both are exported through `__documentTestUtils` for testing.

## Author's claims — reproduce or refute

1. **Behaviour-preserving.** Rendering an offer and a proforma with identical inputs produces matching footer text and matching party text (including the `Att.:` line and the country appended only when not already in the address). I verified by rendering both and comparing — verify independently, and specifically try inputs I may not have: no contact, no address, address that already contains the country, multi-line address, empty address with country only.
2. **The two footers were byte-identical before.** I measured 2432 chars each. Confirm from `c42fb3c9~1`.
3. **`buildInvoiceDocument`/`generateInvoicePdfBuffer` are genuinely unreachable.** I grepped `apps/api/src` and found only `documents/index.ts` (barrel) and tests. Confirm no route, controller, job, or other module calls them — including `verify.controller.ts`.
4. **The remittance block is NOT duplicated between the two live builders.** I initially believed it was, then found it exists only in `buildProformaDocument` and the dead `buildInvoiceDocument`. Check this claim — if I am wrong and there IS live duplication I missed, say so.

## Specific things I want challenged

- **`buildCustomerBlock`'s `fontSize` default of 10** — is that actually the size both call sites used, or did I silently change one? Diff the pre/post rendered text.
- **The footer's `senderName`** — the offer builder derived it differently from the proforma (`data.companyName?.trim() || 'Fueld Trading'` in both?). Confirm the passed value is identical at both call sites, since a divergence would rename the issuer in one document type.
- **Is deleting the dead code actually safe?** If you agree it is dead, say so explicitly and name anything that would break (`documents/index.ts` consumers, `verify.controller.ts`, the three tests in `document.service.formatting.test.ts`: "generates invoice PDF buffer through public API…", "covers generateInvoicePdfBuffer QR catch…", "covers generateInvoicePdfBuffer item-note mapping branch"). Note those three tests are ALREADY among the 14 pre-existing failures.
- **Did the extraction change the `printMeta` line semantics?** It is emitted only when `printMeta` is present; confirm the null path still omits it in both builders.
- **Any risk in `buildDocumentFooter` returning a closure** that captures `params` — e.g. pdfmake calling the footer with unusual page counts, or the closure being shared across documents.
- **Is `__documentTestUtils` export surface growth a problem?** I added `resolveDocAccent`, `buildCustomerBlock`, `buildDocumentFooter`, `hasPayableBankDetails`. Is exposing internals for tests the right call here, or should these be tested through the public render path?

## On 8bbbc799 (the bank + accent commit) — challenge these too

- **Fail-closed is the right direction?** I argue a missing remittance block is a visible config gap while a wrong account number is a silent financial hazard. Refute if you can construct a case where failing closed is worse (e.g. a tenant relying on the old default).
- **Is the accent validation sufficient?** `resolveDocAccent` accepts `#RRGGBB` and `#RGB`, else falls back. brandColor is user input written into the PDF.
- **Was the latent-bug assessment right?** On Moxie production I found 1 default bank account and all 3 issued invoices had both a `bank_account_id` and a company default, so no issued invoice ever printed Fueld's account. If you can reach the DB, verify; if not, say you could not.

## How to verify

```bash
cd /Users/patrickpereira/fueld
git diff c42fb3c9~1 c42fb3c9          # the refactor
git show 8bbbc799                     # bank + accent

# Tests (test DB is SHARED and truncateAll runs per file — run suites ONE AT A TIME)
cd apps/api
DATABASE_URL="postgres://fueld:fueld@localhost:5432/fueld_test" bun test tests/document.service.formatting.test.ts
DATABASE_URL="postgres://fueld:fueld@localhost:5432/fueld_test" bun test tests/date-format-documents.test.ts
DATABASE_URL="postgres://fueld:fueld@localhost:5432/fueld_test" bun test tests/document.revision-fingerprint-verify.test.ts
```

Baseline: these three suites give **98 pass / 14 fail**, and the 14 are pre-existing environmental failures (the test DB's migration tracker is stuck, so `_doEnsureTestSchemaCompat` supplies the missing schema). If you see far MORE failures, you probably ran something concurrently — that corrupts the shared DB.

To render a document yourself, `__documentTestUtils.buildOfferDocument` / `buildProformaDocument` are pure functions taking a plain data object; no DB needed.

## Author's known gaps

- I have not rendered Moxie's actual production invoices through the new code; I verified with synthesised inputs and local PDFs.
- The tenant shell itself (layout options, versioning on the revision) is NOT in this commit. This is only the extraction step.
