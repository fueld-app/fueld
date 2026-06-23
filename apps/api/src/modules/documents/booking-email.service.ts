//  Bunker Booking email — composed from order data + a configurable template.
//
//  Sent on convert-to-order (configurable) and via the manual "Send Bunker
//  Booking" action. Recipients: vessel captain person + agent contact; CC: own
//  ops team via email rules for doc type 'BUNKER_BOOKING'.

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { vesselPersons, companyContacts } from '../../db/schema';
import { getEmailTemplate, getApplicableEmailRules, renderTemplate } from '../admin/email-settings.service';
import { getTimezoneSettings } from '../admin/settings.service';

/** Order shape we need (a subset of getOrderById output). */
interface BookingItem {
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string | null;
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
}

const DEFAULT_SUBJECT = 'Bunkers booked for ${vesselName} at ${place}';
const DEFAULT_BODY = `Dear Captain \${captainName}
Please note that we have booked bunkers for your good lady \${vesselName}.
Place: \${place}
Dates: \${dates}
Agent: \${agent}
Physical: \${physicalSupplier}
Method: \${deliveryMethod}
\${products}
Agents; kindly assist us with the coordination of this supply and do the needful to secure a smooth operation without any delays.`;

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

  return { to: Array.from(to), cc };
}

/** Pure renderer (no DB) — used by composeBookingEmail and unit tests. */
export function renderBookingEmail(order: BookingOrder, captainName: string, timezone?: string | null): { subject: string; body: string } {
  const vesselName = order.vessel?.name ?? '';
  const place = order.place?.name ?? '';
  const dates = formatDates(order.eta ?? null, order.etd ?? null, timezone);
  const agent = order.agent?.name ?? '';
  const physicalSupplier = order.supplier?.name ?? '';
  const deliveryMethod = order.deliveryMethod ?? '';

  const products = (order.items ?? [])
    .map((item) => `Product: ${item.productType}\nQnty: ${formatQty(item)}`)
    .join('\n');

  const vars: Record<string, string> = {
    captainName,
    vesselName,
    place,
    dates,
    agent,
    physicalSupplier,
    deliveryMethod,
    products,
    orderNumber: order.orderNumber ?? '',
  };

  const subject = renderTemplate(DEFAULT_SUBJECT, vars as any);
  const body = renderTemplate(DEFAULT_BODY, vars as any);
  return { subject, body };
}

/** Compose subject + html body from the order + the BUNKER_BOOKING template. */
export async function composeBookingEmail(order: BookingOrder): Promise<{ subject: string; body: string }> {
  const tpl = await getEmailTemplate(order.tenantId, 'BUNKER_BOOKING');
  const { defaultTimezone } = await getTimezoneSettings();
  const captainName = await resolveCaptainName(order.vesselId);

  const vars: Record<string, string> = {
    captainName,
    vesselName: order.vessel?.name ?? '',
    place: order.place?.name ?? '',
    dates: formatDates(order.eta ?? null, order.etd ?? null, defaultTimezone),
    agent: order.agent?.name ?? '',
    physicalSupplier: order.supplier?.name ?? '',
    deliveryMethod: order.deliveryMethod ?? '',
    products: (order.items ?? []).map((item) => `Product: ${item.productType}\nQnty: ${formatQty(item)}`).join('\n'),
    orderNumber: order.orderNumber ?? '',
  };

  const subject = renderTemplate(tpl?.subjectTemplate ?? DEFAULT_SUBJECT, vars as any);
  const body = renderTemplate(tpl?.bodyTemplate ?? DEFAULT_BODY, vars as any);
  return { subject, body };
}

export { DEFAULT_SUBJECT, DEFAULT_BODY, formatDates, formatQty };