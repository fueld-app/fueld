//  Bunker Booking email — composed from order data + a configurable template.
//
//  Sent on convert-to-order (configurable) and via the manual "Send Bunker
//  Booking" action. Recipients: vessel captain person + agent contact; CC: own
//  ops team via email rules for doc type 'BUNKER_BOOKING'.

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { vesselPersons, companyContacts } from '../../db/schema';
import { getEmailTemplate, getApplicableEmailRules, renderTemplate } from '../admin/email-settings.service';
import { getTimezoneSettings, getBookingEmailSettings } from '../admin/settings.service';

/** Order shape we need (a subset of getOrderById output). */
interface BookingItem {
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string | null;
  description?: string | null;
}

interface BookingOrder {
  id: string;
  tenantId: string;
  orderNumber?: string | null;
  vesselId: string;
  vessel?: { name: string } | null;
  place?: { name: string } | null;
  eta?: string | null;
  etd?: string | null;
  agentContactId?: string | null;
  agentContact?: { email?: string | null } | null;
  agent?: { name?: string | null } | null;
  supplier?: { name?: string | null } | null;
  deliveryMethod?: string | null;
  items?: BookingItem[];
  isBrokerDeal?: boolean | null;
  orderSuppliers?: Array<{ isPrimary: boolean; company?: { name?: string | null } | null }> | null;
}

const DEFAULT_SUBJECT = '${vesselName} @ ${place}';

//  Structured HTML layout (matches the Confirmation/Nomination email style):
//  greeting, an order-details table, a products table and a closing note.
//  Previously this was plain text with \n line breaks which collapsed into a
//  single run-on blob in HTML email clients.
const DEFAULT_BODY = `<div style="font-family: 'Segoe UI', Arial, sans-serif; color: #111827;">
<p>Dear Captain of <strong>\${vesselName}</strong>,</p>

<p>Please note that we have booked bunkers for your good lady as follows:</p>

<table style="border-collapse: collapse; margin: 0 0 16px; width: 100%; max-width: 560px;">
  <tr>
    <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px; width: 150px;">Vessel:</td>
    <td style="padding: 4px 0; font-weight: 600;">\${vesselName}</td>
  </tr>
  <tr>
    <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Place:</td>
    <td style="padding: 4px 0; font-weight: 600;">\${place}</td>
  </tr>
  <tr>
    <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Dates:</td>
    <td style="padding: 4px 0; font-weight: 600;">\${dates}</td>
  </tr>
  <tr>
    <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Physical Supplier:</td>
    <td style="padding: 4px 0; font-weight: 600;">\${physicalSupplier}</td>
  </tr>
  <tr>
    <td style="padding: 4px 16px 4px 0; color: #6b7280; font-size: 13px;">Delivery Method:</td>
    <td style="padding: 4px 0; font-weight: 600;">\${deliveryMethod}</td>
  </tr>
</table>

\${products}

<p style="margin-top: 16px;">Agents: kindly assist us with the coordination of this supply and do the needful to secure a smooth operation without any delays.</p>

{{#if senderName}}<p>Best regards,<br/>\${senderName}</p>{{/if}}
</div>`;

/** Build the products table HTML for the booking email body. */
function buildBookingProductsHtml(items: BookingItem[]): string {
  if (!items.length) return '';
  const rows = items
    .map((item) => {
      const desc = item.description ? ` - ${escapeHtml(item.description)}` : '';
      return `<tr>
    <td style="padding: 6px 16px; border: 1px solid #e5e7eb;">${escapeHtml(item.productType)}${desc}</td>
    <td style="padding: 6px 16px; border: 1px solid #e5e7eb; text-align: right; white-space: nowrap;">${escapeHtml(formatQty(item))}</td>
  </tr>`;
    })
    .join('\n');
  return `<table style="border-collapse: collapse; margin: 0 0 8px; width: 100%; max-width: 560px;">
  <tr>
    <th style="padding: 6px 16px; border: 1px solid #e5e7eb; background: #f9fafb; text-align: left; font-size: 13px; color: #374151;">Product</th>
    <th style="padding: 6px 16px; border: 1px solid #e5e7eb; background: #f9fafb; text-align: right; font-size: 13px; color: #374151;">Quantity</th>
  </tr>
${rows}
</table>`;
}

/** Escape text for safe inclusion in HTML email bodies. */
function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ordinal day + month name, e.g. "3rd of July". */
function formatDayMonth(iso: string, timezone?: string | null): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: timezone ?? undefined };
    const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(d);
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${ordinal(Number(day))} of ${month}`;
  } catch {
    const day = d.getUTCDate();
    const month = d.toLocaleString('en-GB', { month: 'long' });
    return `${ordinal(day)} of ${month}`;
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "3rd to 7th of July" (cross-month → "3rd of July to 2nd of August"). */
function formatDates(eta: string | null, etd: string | null, timezone?: string | null): string {
  if (eta && etd) {
    const a = formatDayMonth(eta, timezone);
    const b = formatDayMonth(etd, timezone);
    if (a && b) return a === b ? a : `${a} to ${b}`;
  }
  if (eta) return formatDayMonth(eta, timezone);
  if (etd) return formatDayMonth(etd, timezone);
  return 'TBD';
}

function formatQty(item: BookingItem): string {
  const min = item.quantityMin;
  const max = item.quantityMax;
  const unit = item.unit ?? 'MT';
  if (min && max) return `${stripNum(min)} - ${stripNum(max)} ${unit}`;
  if (max) return `${stripNum(max)} ${unit}`;
  return `${stripNum(item.quantity)} ${unit}`;
}

function stripNum(v: string): string {
  const n = parseFloat(v);
  return Number.isFinite(n) ? String(n) : v;
}

/** Resolve the physical supplier name from the primary order supplier leg, falling back to the order's supplier field. */
function resolvePhysicalSupplier(order: BookingOrder): string {
  // Prefer the primary order supplier leg's company name
  if (order.orderSuppliers && order.orderSuppliers.length > 0) {
    const primary = order.orderSuppliers.find((s) => s.isPrimary) ?? order.orderSuppliers[0];
    if (primary?.company?.name) return primary.company.name;
  }
  // Fall back to the order's legacy supplier field
  return order.supplier?.name ?? '';
}

/** Find the captain's name from the vessel's persons (title 'Captain'). */
async function resolveCaptainName(vesselId: string): Promise<string> {
  const persons = await db
    .select()
    .from(vesselPersons)
    .where(eq(vesselPersons.vesselId, vesselId));
  const captain = persons.find((p) => p.title.toLowerCase() === 'captain');
  return captain?.name ?? 'Captain';
}

/** Resolve To (vessel captain email(s) + agent contact email) + CC (email rules). */
export async function resolveBookingRecipients(order: BookingOrder): Promise<{ to: string[]; cc: string[] }> {
  const to = new Set<string>();

  // Captain person email(s)
  const persons = await db
    .select()
    .from(vesselPersons)
    .where(eq(vesselPersons.vesselId, order.vesselId));
  for (const p of persons) {
    if (p.email?.trim()) to.add(p.email.trim());
  }

  // Agent contact email
  let agentEmail = order.agentContact?.email ?? null;
  if (!agentEmail && order.agentContactId) {
    const [c] = await db.select({ email: companyContacts.email }).from(companyContacts).where(eq(companyContacts.id, order.agentContactId)).limit(1);
    agentEmail = c?.email ?? null;
  }
  if (agentEmail?.trim()) to.add(agentEmail.trim());

  // CC from email rules for BUNKER_BOOKING
  const rules = await getApplicableEmailRules(order.tenantId, null, 'BUNKER_BOOKING');
  const cc = rules.filter((r) => r.ruleType === 'CC').map((r) => r.email).filter(Boolean);

  // On broker deals, always CC the configured broker deal email + agent email
  if (order.isBrokerDeal) {
    const { brokerDealCcEmail } = await getBookingEmailSettings();
    if (brokerDealCcEmail) cc.push(brokerDealCcEmail);
    if (agentEmail?.trim()) cc.push(agentEmail.trim());
  }

  return { to: Array.from(to), cc };
}

/**
 * Build the template variables for the booking email.
 * `plain` values are for the subject line (no escaping); `html` values are
 * HTML-escaped for safe inclusion in the HTML body. `products` is already
 * valid HTML (built with escaping in buildBookingProductsHtml).
 */
function buildBookingVars(order: BookingOrder, captainName: string, dates: string, senderName: string) {
  const plain: Record<string, string> = {
    captainName,
    vesselName: order.vessel?.name ?? '',
    place: order.place?.name ?? '',
    dates,
    agent: order.agent?.name ?? '',
    physicalSupplier: resolvePhysicalSupplier(order),
    deliveryMethod: order.deliveryMethod ?? '',
    products: buildBookingProductsHtml(order.items ?? []),
    orderNumber: order.orderNumber ?? '',
    senderName,
  };
  const html: Record<string, string> = {
    ...plain,
    captainName: escapeHtml(plain.captainName),
    vesselName: escapeHtml(plain.vesselName),
    place: escapeHtml(plain.place),
    dates: escapeHtml(plain.dates),
    agent: escapeHtml(plain.agent),
    physicalSupplier: escapeHtml(plain.physicalSupplier),
    deliveryMethod: escapeHtml(plain.deliveryMethod),
    orderNumber: escapeHtml(plain.orderNumber),
    senderName: escapeHtml(plain.senderName),
  };
  return { plain, html };
}

/** Pure renderer (no DB) — used by composeBookingEmail and unit tests. */
export function renderBookingEmail(
  order: BookingOrder,
  captainName: string,
  timezone?: string | null,
  senderName?: string,
): { subject: string; body: string } {
  const dates = formatDates(order.eta ?? null, order.etd ?? null, timezone);
  const { plain, html } = buildBookingVars(order, captainName, dates, senderName ?? '');

  const subject = renderTemplate(DEFAULT_SUBJECT, plain as any);
  const body = renderTemplate(DEFAULT_BODY, html as any);
  return { subject, body };
}

/** Compose subject + html body from the order + the BUNKER_BOOKING template. */
export async function composeBookingEmail(
  order: BookingOrder,
  senderName?: string,
): Promise<{ subject: string; body: string }> {
  const tpl = await getEmailTemplate(order.tenantId, 'BUNKER_BOOKING');
  const { defaultTimezone } = await getTimezoneSettings();
  const captainName = await resolveCaptainName(order.vesselId);
  const dates = formatDates(order.eta ?? null, order.etd ?? null, defaultTimezone);
  const { plain, html } = buildBookingVars(order, captainName, dates, senderName ?? '');

  const subject = renderTemplate(tpl?.subjectTemplate ?? DEFAULT_SUBJECT, plain as any);
  const body = renderTemplate(tpl?.bodyTemplate ?? DEFAULT_BODY, html as any);
  return { subject, body };
}

export { DEFAULT_SUBJECT, DEFAULT_BODY, formatDates, formatQty };