//  Bunker Booking email — composed from order data + a configurable template.
//
//  Sent on convert-to-order (configurable) and via the manual "Send Bunker
//  Booking" action. Recipients: vessel captain person + agent contact; CC: own
//  ops team via email rules for doc type 'BUNKER_BOOKING'.

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { vesselPersons, companyContacts, tenants } from '../../db/schema';
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
  /** Order's responsible user (salesRep) — preferred for the signature block. */
  salesRep?: { id: string; name: string; email: string | null; phone: string | null; skype: string | null; whatsapp: string | null } | null;
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

{{#if signatureHtml}}\${signatureHtml}{{/if}}
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

/**
 * Build the line-based product block for the booking email body:
 *   Product: <name> - <description>
 *   Qnty: <range>
 * Used by tenants whose custom template is line-based (e.g. Moxie) instead
 * of the table layout. All values HTML-escaped.
 */
export function buildBookingProductLinesHtml(items: BookingItem[]): string {
  if (!items.length) return '';
  return items
    .map((item) => {
      const desc = item.description ? ` - ${escapeHtml(item.description)}` : '';
      return `<p style="margin: 8px 0 0;">Product: ${escapeHtml(item.productType)}${desc}<br/>Qnty: ${escapeHtml(formatQty(item))}</p>`;
    })
    .join('\n');
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
  // Stem range (fra-til): quantity_min is the minimum, quantity is the full/target
  if (min && stripNum(min) !== stripNum(item.quantity)) return `${stripNum(min)} - ${stripNum(item.quantity)} ${unit}`;
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

/** Resolve To (vessel captain email(s) + agent contact email) + CC (email rules) + always-BCC. */
export async function resolveBookingRecipients(
  order: BookingOrder,
): Promise<{ to: string[]; cc: string[]; bcc: string[] }> {
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

  const bookingSettings = await getBookingEmailSettings();

  // CC from email rules for BUNKER_BOOKING
  const rules = await getApplicableEmailRules(order.tenantId, null, 'BUNKER_BOOKING');
  const cc = rules.filter((r) => r.ruleType === 'CC').map((r) => r.email).filter(Boolean);

  // On broker deals, always CC the configured broker deal email + agent email
  if (order.isBrokerDeal) {
    if (bookingSettings.brokerDealCcEmail) cc.push(bookingSettings.brokerDealCcEmail);
    if (agentEmail?.trim()) cc.push(agentEmail.trim());
  }

  // Always-BCC (e.g. Moxie's shared happier@ mailbox) from tenant settings
  const bcc = bookingSettings.bccEmail?.trim() ? [bookingSettings.bccEmail.trim()] : [];

  return { to: Array.from(to), cc, bcc };
}

/**
 * Sender info for the booking-email closing block / signature.
 * Accepts a plain string (display name only) for backward compatibility.
 */
export interface BookingSender {
  name: string;
  email?: string | null;
  phone?: string | null;
  skype?: string | null;
  whatsapp?: string | null;
}

function toBookingSender(sender?: BookingSender | string): BookingSender | undefined {
  if (!sender) return undefined;
  return typeof sender === 'string' ? { name: sender } : sender;
}

/**
 * The signature shows the ORDER'S RESPONSIBLE user (salesRep) when known,
 * falling back to the sender (Moxie: "insert Frederik auto signature if
 * responsible is Frederik").
 */
export function resolveSignatureUser(order: BookingOrder, sender?: BookingSender): BookingSender | undefined {
  if (order.salesRep?.name?.trim()) {
    const rep = order.salesRep;
    // Per-field fallback to the sender's contact details when the responsible
    // user hasn't populated theirs (e.g. rep set but phone/skype empty).
    return {
      name: rep.name,
      email: rep.email ?? sender?.email ?? null,
      phone: rep.phone ?? sender?.phone ?? null,
      skype: rep.skype ?? sender?.skype ?? null,
      whatsapp: rep.whatsapp ?? sender?.whatsapp ?? null,
    };
  }
  return sender;
}

/**
 * Build the closing block for the booking email: "Best regards," + a styled
 * signature (name, contact lines, optional logo) when signature data exists,
 * falling back to the legacy "Best regards,\u200bName" markup otherwise.
 *
 * All interpolated values are HTML-escaped.
 */
export function buildBookingSignatureHtml(
  sender: BookingSender,
  opts: { fromEmail?: string | null; logoUrl?: string | null; website?: string | null } = {},
): string {
  const name = sender.name?.trim();
  if (!name) return '';

  const email = opts.fromEmail?.trim() || sender.email?.trim() || '';
  const website = opts.website?.trim() || '';
  const logoUrl = opts.logoUrl?.trim() || '';

  const hasContact = Boolean(sender.phone?.trim() || sender.skype?.trim() || sender.whatsapp?.trim() || email || website || logoUrl);

  // Legacy fallback: plain "Best regards, Name" when there is no signature data.
  if (!hasContact) {
    return `<p>Best regards,<br/>${escapeHtml(name)}</p>`;
  }

  const contactLines: string[] = [];
  const mLine = [sender.phone?.trim() ? escapeHtml(sender.phone.trim()) : '', sender.skype?.trim() ? `s: ${escapeHtml(sender.skype.trim())}` : '']
    .filter(Boolean)
    .join(' ◦ ');
  if (mLine) contactLines.push(`m: ${mLine}`);
  if (sender.whatsapp?.trim()) contactLines.push(`whatsapp: ${escapeHtml(sender.whatsapp.trim())}`);
  if (email) contactLines.push(`e: <a href="mailto:${escapeHtml(email)}" style="color: #0563C1;">${escapeHtml(email)}</a>`);
  if (website) {
    const site = website.replace(/^https?:\/\//, '');
    contactLines.push(`w: <a href="https://${escapeHtml(site)}" style="color: #0563C1;">${escapeHtml(site)}</a>`);
  }

  const contactHtml = contactLines
    .map((line) => `<span style="display: inline-block; margin: 1px 0;">${line}</span>`)
    .join('<br/>');

  return `<p style="margin: 16px 0 0;">Best regards,</p>
<table style="border-collapse: collapse; width: 300px; max-width: 300px; margin: 8px 0 0;">
  <tr>
    <td style="border-bottom: 1.5pt solid #16348C; padding: 0 0 2px;">
      <span style="font-size: 9pt; font-weight: bold; color: #16348C;">${escapeHtml(name)}</span>
    </td>
  </tr>
  <tr>
    <td style="padding: 4px 0 0; font-size: 9pt; color: #16348C;">${contactHtml}</td>
  </tr>
</table>${
    logoUrl
      ? `<img src="${escapeHtml(logoUrl)}" width="220" style="margin-top: 8px; display: block;" alt="logo" />`
      : ''
  }`;
}

/**
 * Build the template variables for the booking email.
 * `plain` values are for the subject line (no escaping); `html` values are
 * HTML-escaped for safe inclusion in the HTML body. `products` and
 * `signatureHtml` are already valid HTML (built with escaping in
 * buildBookingProductsHtml / buildBookingSignatureHtml).
 */
function buildBookingVars(order: BookingOrder, captainName: string, dates: string, senderName: string, signatureHtml: string) {
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
  // Line-based product block (pre-built escaped HTML) — used by line-based custom templates
  const productLines = buildBookingProductLinesHtml(order.items ?? []);
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
    // Pre-built escaped HTML (buildBookingProductsHtml / buildBookingProductLinesHtml /
    // buildBookingSignatureHtml escape all values)
    signatureHtml,
    productLines,
  };
  return { plain, html };
}

/** Pure renderer (no DB) — used by composeBookingEmail and unit tests. */
export function renderBookingEmail(
  order: BookingOrder,
  captainName: string,
  timezone?: string | null,
  sender?: BookingSender | string,
  signatureHtml?: string,
): { subject: string; body: string } {
  const senderInfo = toBookingSender(sender);
  const dates = formatDates(order.eta ?? null, order.etd ?? null, timezone);
  const closing = signatureHtml ?? buildBookingSignatureHtml(senderInfo ?? { name: '' });
  const { plain, html } = buildBookingVars(order, captainName, dates, senderInfo?.name ?? '', closing);

  const subject = renderTemplate(DEFAULT_SUBJECT, plain as any);
  const body = renderTemplate(DEFAULT_BODY, html as any);
  return { subject, body };
}

/**
 * Resolve the signature "e:" line: explicit signatureFromEmail override,
 * else the tenant's shared-sender mailbox, else the sender's own email.
 */
async function resolveSignatureFromEmail(tenantId: string, sender?: BookingSender): Promise<string | null> {
  try {
    const { signatureFromEmail } = await getBookingEmailSettings();
    if (signatureFromEmail?.trim()) return signatureFromEmail.trim();
    const [t] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const shared = (t?.settings ?? {} as any).microsoftSharedSenderEmail;
    if (shared) return String(shared).trim();
  } catch {
    // Settings unavailable — fall through to sender email
  }
  return sender?.email?.trim() || null;
}

/** Compose subject + html body from the order + the BUNKER_BOOKING template. */
export async function composeBookingEmail(
  order: BookingOrder,
  sender?: BookingSender | string,
): Promise<{ subject: string; body: string }> {
  const senderInfo = toBookingSender(sender);
  const tpl = await getEmailTemplate(order.tenantId, 'BUNKER_BOOKING');
  const [{ defaultTimezone }, bookingSettings] = await Promise.all([
    getTimezoneSettings(),
    getBookingEmailSettings(),
  ]);
  const captainName = await resolveCaptainName(order.vesselId);
  const dates = formatDates(order.eta ?? null, order.etd ?? null, defaultTimezone);

  // The signature shows the ORDER'S RESPONSIBLE user (salesRep) when known,
  // falling back to the sender (Moxie: "insert Frederik auto signature if
  // responsible is Frederik").
  const signatureUser = resolveSignatureUser(order, senderInfo);

  let signatureHtml = '';
  if (signatureUser?.name?.trim()) {
    const fromEmail = await resolveSignatureFromEmail(order.tenantId, signatureUser);
    signatureHtml = buildBookingSignatureHtml(signatureUser, {
      fromEmail,
      logoUrl: bookingSettings.signatureLogoUrl,
      website: bookingSettings.signatureWebsite,
    });
  }
  const { plain, html } = buildBookingVars(order, captainName, dates, signatureUser?.name ?? '', signatureHtml);

  const subject = renderTemplate(tpl?.subjectTemplate ?? DEFAULT_SUBJECT, plain as any);
  const body = renderTemplate(tpl?.bodyTemplate ?? DEFAULT_BODY, html as any);
  return { subject, body };
}

export { DEFAULT_SUBJECT, DEFAULT_BODY, formatDates, formatQty };