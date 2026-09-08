// ═══════════════════════════════════════════════════════════════════════
//  Order routes — shared mapping from an order status to its list route.
//  Used by the global search, command palette, and order lists.
// ═══════════════════════════════════════════════════════════════════════

export type OrderListRoute =
  | '/trading/orders'
  | '/trading/inquiries'
  | '/trading/delivered-orders'
  | '/trading/invoiced-orders'
  | '/trading/completed-orders'
  | '/trading/cancelled-orders';

export function orderDetailRoute(status?: string): OrderListRoute {
  if (status === 'INQUIRY' || status === 'OFFER') return '/trading/inquiries';
  if (status === 'DELIVERED') return '/trading/delivered-orders';
  if (status === 'INVOICED') return '/trading/invoiced-orders';
  if (status === 'PAID') return '/trading/completed-orders';
  if (status === 'CANCELLED') return '/trading/cancelled-orders';
  return '/trading/orders';
}