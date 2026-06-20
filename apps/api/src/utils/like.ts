//  LIKE / ILIKE pattern helpers

/**
 * Escape LIKE/ILIKE wildcard characters (`%`, `_`) and the default escape
 * character (`\`) so a user-supplied search value is matched literally inside
 * a `%<value>%` pattern. PostgreSQL uses `\` as the default LIKE escape
 * character, so no `ESCAPE` clause is required when using drizzle's `ilike()`.
 *
 * Usage: `ilike(col, `%${escapeLikePattern(value)}%`)`
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}