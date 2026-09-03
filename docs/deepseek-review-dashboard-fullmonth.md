### P0
None

### P1
None

### P2
- **Test assertion weakness (this_month)**: The test checks `range.to.getMonth()` equals `range.from.getMonth()`, but this would also pass if `to` were the last day of the *previous* month (e.g., if `from` is Feb 1 and `to` is Jan 31, both have month index 0). The test should explicitly assert `range.to.getFullYear()` matches `range.from.getFullYear()` and that `range.to` is the last day of the *same* month as `from`. This is a minor robustness issue, not a functional bug.

### Verdict
**Approve** — The change correctly implements full-period presets for `this_week`, `this_month`, and `this_quarter` while preserving the intentional year-to-date behavior for `this_year`. The implementation is clean, uses proper end-of-day timestamps, and aligns with the stated rationale for delivery-basis mode. The test coverage is adequate, though the `this_month` test could be slightly more precise. No P0/P1 issues found.

---

## Executor disposition (2026-09-03)

- P2 (this_month test robustness): applied — test now asserts same year, same month, last day of that month, 23:59.
