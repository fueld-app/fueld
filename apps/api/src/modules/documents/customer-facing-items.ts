/**
 * Customer-facing line-item rules.
 *
 * Shared by the document generators (CONFIRMATION / OFFER / NOMINATION / PFI /
 * INVOICE / broker confirmation) and by invoice materialization, which must sum
 * exactly the rows the customer will see. Kept in its own module so the orders
 * and documents modules depend on the rule rather than on each other.
 */

/**
 * True for legacy supplier credit-note placeholder lines: CREDIT_NOTE-type
 * product lines carrying no sell price. These are buy-side financial
 * adjustments, never customer-facing product rows.
 * A CREDIT_NOTE line WITH a (negative) sell price is a customer credit and
 * keeps rendering on documents until the credit-note document feature ships.
 */
export function isSupplierCreditPlaceholder<
  T extends { productType: string; salesPrice?: string | number | null },
>(item: T): boolean {
  return (
    (item.productType ?? '').toUpperCase() === 'CREDIT_NOTE' &&
    (item.salesPrice == null || item.salesPrice === '')
  );
}

/**
 * Filter for items rendered on customer/broker-facing generated documents.
 *
 * Excludes:
 *  - items flagged hideOnDocuments (e.g. broker commission line items)
 *  - supplier credit-note placeholder lines (see isSupplierCreditPlaceholder):
 *    they previously rendered as rows with a bare dash for the price.
 *    Zero-priced legitimate lines (e.g. fees included in the price) are NOT
 *    affected — only unpriced CREDIT_NOTE-type lines are excluded.
 */
export function customerFacingItems<
  T extends {
    productType: string;
    hideOnDocuments?: boolean | null;
    salesPrice?: string | number | null;
  },
>(items: T[]): T[] {
  return items.filter(
    (item) => !item.hideOnDocuments && !isSupplierCreditPlaceholder(item),
  );
}
