# Panel digest — document extraction + bank/accent (8bbbc799, c42fb3c9)

Three independent reviewers on **`8bbbc799`** (bank fail-closed + tenant accent) and **`c42fb3c9`** (extract shared footer/party blocks).

| Reviewer | Verdict |
|---|---|
| DeepSeek V4 Pro | **needs-fixes** |
| GLM 5.3 | **ship-it** |
| Kimi K3 | **needs-fixes** |

All three **independently confirmed** the extraction is behaviour-preserving (two reconstructed the pre-extraction source and diffed rendered output; all got byte-identical footers and party blocks across multiple input cases). All three confirmed the dead-code claim. All three confirmed the bank fallback removal is the right direction.

## The finding that mattered — I had introduced a regression

**DS (HIGH): the accent change was NOT behaviour-preserving.** Pre-change, BOTH live builders styled `sectionLabel` as `#111827` (near-black) with a plain `tableHeader`. My change set them to `accent`, which defaults to Fueld blue — so **every existing tenant's live documents silently changed appearance** without anyone choosing that.

I verified this directly (`git show 8bbbc799~1`), and it was a real regression. Fixed by splitting the resolver:

- `resolveDocAccent` — always returns a colour (rules, links). Fueld blue fallback.
- `resolveOptionalDocAccent` — returns **null** when the tenant configured no usable colour.
- Headings use `accentText = resolveOptionalDocAccent(...) ?? '#111827'`, so an unbranded tenant renders **exactly** as before, while a branded tenant gets their colour.

Verified: unbranded offer + proforma → `#111827` both (pre-change appearance); branded → their colour; pale-yellow → falls back.

## Other real defects fixed

**DS + Kimi: the colour had no legibility guard.** Kimi computed that `#F5C518` — the very colour I used and screenshotted as "verified" — is **1.63:1** against white, far below the WCAG large-text floor (3:1). Section headings and the table header would be near-invisible at print scale. I confirmed the ratio myself and added a contrast floor to the resolver; below 3:1 the accent falls back. My own test had asserted `resolveDocAccent('#abc') → '#aabbcc'`, which the guard now correctly rejects — proof the old test was pinning the hole.

**DS: `DOCUMENT_TEMPLATE_VERSION` was not bumped**, despite its own comment ("Bump this whenever document output changes so cached revisions regenerate"). Two earlier commits changed rendered output without bumping it, so a cached revision would keep serving the old appearance forever and the fix would look like it had not worked.

**DS: bumping it naively would have been worse.** The stream key embeds the version, so bump + the existing lookup would make an **already-issued invoice** miss and re-render into a new revision — silently restating a document the customer already holds and invalidating its fingerprint. Fixed by falling back to any revision for that invoice id, so a bump regenerates pre-issue documents but never restates an issued one. Proven by a test that drives the **real generator** against a stale-version revision and asserts the stored bytes are reused: **fails without the fallback, passes with it.**

**GLM + DS: the offer builder still leaked Fueld blue** — `sectionLabel`/`tableHeader` unthemed, and `phoneTextNode`/`emailTextNode` hardcoding `#1a56db` in the live "Direct Email/Phone" lines. Both fixed; the two builders now produce identical style blocks for the same tenant.

**Kimi (HIGH, partially refuted): `hasPayableBankDetails` had no production caller.** True as stated, but the premise was weaker than claimed: `/invoice/pdf` and `/proforma/pdf` **already** gate on `order.bankAccountId` before rendering, so an invoice with no remittance section could not be issued. The real defect was the reverse — the gate was **stricter** than the renderer, rejecting an order whose payable details would have resolved from the company default. Both gates now call the same resolver the renderer uses, which also gives the helper real callers.

## Corrections to my own claims

- **GLM refuted my dead-code test count.** I said deleting `buildInvoiceDocument`/`generateInvoicePdfBuffer` would remove "three failing tests". Wrong on both counts: those tests **pass** individually (they only failed under the environmental DB fault), and ~7 green tests pin the dead builders, not 3. Deletion needs the coverage migrated to the live path first — it is a cutover, not a cleanup.
- **DS: my "2432 chars each" was off by one** (2431).
- **GLM: my duplication claim held, but the remaining shared surface is larger than the extraction suggests** — ~215 lines (~47%) of each builder body is still line-shared or trivially variant: header closure, right meta block, `productCell`, vessel/delivery stack, document wrapper. The extraction is +7 net lines: the win is single-sourcing, not size.

## Deliberately not done

- **Deleting the dead ~595 lines.** All three agree it is dead and should go, but as a proper cutover (migrate the due-date + print-meta coverage to `buildProformaDocument`, drop the barrel line, then delete). Not bundled into a fix commit.
- **The tenant shell itself.** GLM's recommended order: (a) delete dead code; (b) finish accent consistency; (c) extract `buildDocumentShell({header, content, footer, accent, styles})` owning pageSize/margins/styles plus a parametrised header — that is where the remaining shared lines live. Do NOT force-unify the items tables (totals semantics genuinely differ).

## Caveats

- Nobody rendered Moxie's actual production invoices; all verification used synthesised inputs (mine too).
- No reviewer could reach the production DB, so my "latent, not live" bug assessment is unverified by them (I verified it before the panel, and the reviewer-visible part — `DEFAULT_BANK_DETAILS` gone from HEAD — holds).
- The accent's *visual* result is only verified as correct contrast, not as a design Moxie has approved.
