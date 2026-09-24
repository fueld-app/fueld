# Atradius Insurance Cover — Operator Guide

## Overview

Atradius is the credit insurer. They cover part of what a customer owes you if that
customer defaults, and the amount they cover — the **insurance cover** — is decided
per buyer and can be lower than the credit limit your credit managers grant.

This feature puts the Atradius cover next to the management credit limit on the
**Customer Credit** page, so the credit team can see both numbers side by side.

The data comes from the monthly Atradius policy export, which you upload. There is
no Atradius API in play: the workflow is a file upload.

> **Cover and credit limit are deliberately not reconciled.** They are two
> different things — one is what the insurer will pay, the other is what you are
> willing to risk — and how they should sit together is a commercial decision for
> the credit managers, not something the software decides. Both are shown; neither
> overrides the other.

---

## 1. Is it on for my company?

It is a per-company feature. An **ADMIN** turns it on in
**Admin → Settings → Features**, under the *Atradius cover* toggle.

- Off (default) → nothing appears anywhere; the upload button and the column are hidden.
- On → the **Upload Atradius file** button and the **Atradius Cover** column appear
  on the Customer Credit page, for ADMIN, CREDITMANAGER and FINANCE users.

If you cannot see the button, that toggle is the first thing to check — the page
hides the whole feature silently when it is off, by design.

---

## 2. The monthly upload

### Steps
1. Export the policy and cover status from the Atradius platform (the same export
   you already produce — no reformatting needed).
2. Go to **Credit → Customer Credit**.
3. Click **Upload Atradius file** (top right, next to *Add Credit Line*).
4. Pick the Excel file. It is read immediately.
5. If some buyers could not be matched, work through the mapping list (§3).
6. Click **Save mappings**.

### What the import reads
Columns are found by **header name**, not by position, so Atradius reordering
columns will not silently break the import. If a required column is missing
altogether, the upload **fails with a clear error** rather than guessing — a wrong
column bound silently is worse than a failed upload.

The columns used are: buyer number, buyer name, the decision amount and its
currency, the cover status, the decision date, and the cancellation date.

In the current export those sit at these positions, which is useful when reading a
file by eye:

| Field | Column |
|---|---|
| Buyer number | `E` |
| Buyer name | `F` |
| Policy currency | `AC` |
| Decision amount | `AE` |
| Decision date | `AP` |
| Cancellation date | `AT` |
| Cover status | `AX` |

The two columns Pierre referred to — F (company) and AE (amount) — are among these,
and because lookup is by header they can move without breaking the import.

### Replacing vs. keeping history
**Each upload replaces the previous one.** That is intentional and matches how the
export works: it is a full snapshot of current cover, not a set of changes.

The previous import is still kept in the database as an audit record (who uploaded
what, when, how many rows), but only the latest upload drives the figures on screen.

Two people uploading at the same moment cannot corrupt each other's data — the
second waits for the first to finish, then replaces it.

---

## 3. The mapping step (first upload only, mostly)

Atradius names buyers as *Atradius* spells them, which is often not how the same
company is spelled in Fueld. Examples from a real file:

```
Atradius:  GEFO GESELLSCHAFT FÜROELTRANSPORTE MBH
Fueld:     GEFO Gesellschaft fur Oeltransporte mbH

Atradius:  ADI SERVIZI MARITTIMI S.R.L.
Fueld:     AdI Servizi Marittimi S.r.l.in A.S.
```

So the import matches what it can, and asks you about the rest.

### How matching works, in priority order
1. **Remembered mapping** — matched by the stable Atradius **buyer number**. This
   is what makes later uploads effortless.
2. **Exact name match** (case-insensitive) — automatic.
3. **Everything else** — appears in the mapping list for you to resolve by hand.

### Working through the list
- Each row shows the Atradius buyer name and number, and a **search box**.
- Type a few letters of the client name — the search runs against your client list,
  so you do not scroll through hundreds of entries.
- Where the system thinks it recognises a buyer, it shows a
  **"name suggests …"** link under the row. Click it to accept.
- **A suggestion is never applied on its own.** Those name guesses are precisely
  the ones that go wrong, and a wrong guess would put one client's cover against
  another. Accepting is a deliberate click.
- Click **Save mappings** when done.

### Why you only do this once
The mapping is stored against the Atradius buyer number, which does not change
between exports. So a buyer you map now is matched automatically in every future
upload.

If you need to change or clear a mapping later, run the upload and change it in the
list — **clearing** a row (the ✕ on the search box) removes the mapping.

---

## 4. Reading the Atradius Cover column

The column sits next to **Credit** on the Customer Credit page and shows the
insured amount per client.

| What you see | What it means |
|---|---|
| A figure, e.g. `€250,000.00` | Insured cover for that client, in that currency |
| `0 EUR` | Mapped, but the cover is zero — see the status note below |
| `not mapped` | This client has no Atradius buyer mapped to it yet |
| `EUR 100,000.00 + USD 50,000.00` | Insured in more than one currency |

### Two currencies
If a client's cover spans several currencies, there is **no single figure** to
show — adding EUR and USD together produces a number that means nothing on a credit
surface. Those rows list the parts instead of one misleading total.

### `0 EUR` is not the same as `not mapped`
- **`0 EUR`** — the buyer *is* mapped, and the current decision leaves no cover in
  force. The zero is a real, deliberate answer.
- **`not mapped`** — nobody has said which Fueld client this Atradius buyer is, so
  there is no answer yet.

This distinction matters: the first is a fact about the customer, the second is
work still to do.

### Partial totals on a first upload
Under the upload button the page states how many buyers are mapped, e.g.
**"17 of 158 Atradius buyers mapped — figures cover mapped clients only"**.

Until the mapping is finished, **read the column as partial**. It never presents a
partial picture as if it were complete, but the total will genuinely be low before
the mapping is done.

---

## 5. What the cover statuses mean

The export is in French. Each row is one decision about one buyer, and a buyer can
have several. The import keeps the **latest decision per buyer number**, then sums
across buyers mapped to the same client.

| Export status | Meaning | Counts as cover? |
|---|---|---|
| `Approuvée` | Approved | Yes |
| `Réduite` | Reduced — the amount column already reflects the reduction | Yes |
| `Partiellement acceptée` | Partially accepted | Yes |
| `Réémise` | Reissued | Yes |
| `Conditions de couverture modifiées` | Cover conditions modified | Yes |
| `Annulation future` | Cancellation **scheduled ahead** — cover is still in force until that date | Yes, until the cancellation date |
| `Pas d'augmentation de couverture` | An *increase* was refused — the standing cover still holds | Yes |
| `Refusée` | Refused — no cover | No |
| `Annulée` | Cancelled | No |

Two of these are easy to get wrong, and both are worth knowing because they were
verified against a real export rather than assumed:

- **`Annulation future` is not dead cover.** A cancellation dated in the future
  still pays a claim until that date. It stops counting only once its cancellation
  date has passed — so one buyer can be in force today and out of force next month
  with no new decision in between.
- **`Pas d'augmentation` is not an absence of cover.** It means the *requested
  increase* was declined; the existing cover stands. In the real file these buyers
  held cover while refused requests showed a zero amount.

A row whose cancellation date has passed stops counting regardless of status.

---

## 6. Quick Reference

| I want to… | Where |
|---|---|
| Turn the feature on/off | Admin → Settings → Features → *Atradius cover* |
| Upload the monthly export | Customer Credit → **Upload Atradius file** |
| Map an unmatched buyer | Upload, then use the search box on the row |
| Accept a suggested match | Click the **"name suggests …"** link on the row |
| Remove a mapping | Upload, then ✕ the search box on that row |
| See the cover column | Customer Credit table → **Atradius Cover** |
| Check when cover was last updated | Under the upload button |
| Check how much is mapped | Under the upload button ("N of M buyers mapped") |

---

## 7. Notes for operators / support

- **No cover showing for a client you expected?** Check §4: the client may be
  **not mapped**, or mapped with zero in-force cover. The column distinguishes them.
- **Everything looks empty?** The feature toggle (Admin → Features) hides the
  entire UI when off, including the column.
- **Upload failed with "Could not locate the … column by header"?** The file is not
  being seen as an Atradius policy export, or the header row is missing. This is a
  deliberate hard failure — a wrong column bound silently would produce plausible
  but wrong figures.
- **Wrong figure after a re-classification?** Figures come only from the **latest**
  upload, so re-uploading the export is what refreshes them.
- **Who can upload?** ADMIN, CREDITMANAGER and FINANCE.
- **Is this tenant-specific?** Yes. Cover data is scoped to the company, and the
  feature flag is per company. A buyer can only be mapped to a client that belongs
  to the same company — the API refuses cross-company mapping outright.
