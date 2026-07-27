//  Daily Pricing Email Service — Sends posted fuel prices to external clients
//
//  Queries delivered orders for the configured dock (placeId), extracts the
//  latest sales price per product type, and emails a posted price list.
//  Recipients are pulled from company_contacts (IDs stored in settings, emails
//  resolved at send time so they stay in sync).

import { and, eq, gte, desc, inArray, sql, isNull } from 'drizzle-orm';
import { db } from '../../db';
import {
  orders,
  orderItems,
  places,
  counterparties,
  companyContacts,
  tenants,
  type TenantSettings,
} from '../../db/schema';
import { sendNotificationEmail } from '../../lib/email';

interface PostedPrice {
  productType: string;
  price: number;
  unit: string;
  currency: string;
  deliveredAt: string;
  orderNumber: string;
}

/**
 * Run due daily pricing emails for all tenants.
 * Called hourly by the scheduled job.
 */
export async function runDueDailyPricingEmails(now = new Date()): Promise<void> {
  const hourUtc = now.getUTCHours();
  const todayKey = now.toISOString().slice(0, 10);

  const allTenants = await db
    .select({ id: tenants.id, name: tenants.name, settings: tenants.settings })
    .from(tenants);

  for (const tenant of allTenants) {
    const settings = (tenant.settings ?? {}) as TenantSettings;
    const pricing = settings.dailyPricingEmail;
    if (!pricing?.enabled) continue;
    if (Math.round(pricing.hourUtc ?? 13) !== hourUtc) continue;

    // Check if already sent today
    const lastSentKey = (pricing as any).lastSentAt ?? '';
    if (lastSentKey.slice(0, 10) === todayKey) continue;

    if (!pricing.placeId) {
      console.warn(`[DailyPricing] No placeId configured for tenant ${tenant.id}, skipping`);
      continue;
    }

    try {
      await sendDailyPricingEmailForTenant(tenant.id, tenant.name, pricing);
      // Update lastSentAt
      const updatedSettings = {
        ...settings,
        dailyPricingEmail: { ...pricing, lastSentAt: now.toISOString() },
      };
      await db
        .update(tenants)
        .set({ settings: updatedSettings, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    } catch (err) {
      console.error(`[DailyPricing] Failed for tenant ${tenant.id}:`, err);
    }
  }
}

/**
 * Build and send the daily pricing email.
 */
async function sendDailyPricingEmailForTenant(
  tenantId: string,
  tenantName: string,
  settings: NonNullable<TenantSettings['dailyPricingEmail']>,
): Promise<void> {
  const lookbackHours = settings.lookbackHours ?? 24;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  // Get posted prices from delivered orders at the configured dock
  const prices = await getPostedPrices(tenantId, settings.placeId!, since);

  if (prices.length === 0) return; // Don't send empty email

  // Resolve recipient emails from contact IDs
  const recipientEmails = await resolveRecipientEmails(
    tenantId,
    settings.recipientContactIds ?? [],
    settings.extraEmails ?? [],
  );

  if (recipientEmails.length === 0) {
    console.warn(`[DailyPricing] No recipients for tenant ${tenantId}, skipping`);
    return;
  }

  // Get place name for the email
  const [place] = await db
    .select({ name: places.name })
    .from(places)
    .where(eq(places.id, settings.placeId!))
    .limit(1);

  const placeName = place?.name ?? 'Fuel Dock';
  const html = buildPricingEmailHtml(placeName, prices, since);
  const subject = settings.emailSubject ?? `${placeName} — Posted Prices for ${new Date().toISOString().slice(0, 10)}`;

  await sendNotificationEmail(recipientEmails, subject, html, {
    textContent: buildPricingEmailText(placeName, prices, since),
  });
}

/**
 * Query delivered orders at the specified dock and extract latest prices per product.
 */
async function getPostedPrices(
  tenantId: string,
  placeId: string,
  since: Date,
): Promise<PostedPrice[]> {
  // Query order items from delivered/invoiced/paid orders at the dock within the lookback window
  // Use COALESCE(deliveredAt, createdAt) since some orders don't have deliveredAt set
  const rows = await db
    .select({
      productType: orderItems.productType,
      salesPrice: orderItems.salesPrice,
      unit: orderItems.unit,
      salesCurrency: orderItems.salesCurrency,
      salesUnit: orderItems.salesUnit,
      deliveredAt: orders.deliveredAt,
      orderNumber: orders.orderNumber,
      orderId: orders.id,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.placeId, placeId),
        inArray(orders.status, ['DELIVERED', 'INVOICED', 'PAID']),
        sql`COALESCE(${orders.deliveredAt}, ${orders.createdAt}) >= ${since}`,
        // Only fuel products (GAL unit, exclude disposal/service/fee items)
        sql`LOWER(${orderItems.salesUnit}) = 'gal' OR LOWER(${orderItems.unit}) = 'gal'`,
      ),
    )
    .orderBy(desc(orders.deliveredAt), desc(orders.createdAt));

  // Keep only the latest price per product type (first occurrence wins since sorted by deliveredAt desc)
  const seen = new Set<string>();
  const prices: PostedPrice[] = [];

  for (const row of rows) {
    const key = row.productType.toLowerCase();
    if (seen.has(key)) continue;
    if (!row.salesPrice) continue;
    seen.add(key);

    prices.push({
      productType: row.productType,
      price: parseFloat(row.salesPrice),
      unit: row.salesUnit ?? row.unit ?? 'GAL',
      currency: row.salesCurrency ?? 'USD',
      deliveredAt: row.deliveredAt?.toISOString() ?? new Date().toISOString(),
      orderNumber: row.orderNumber ?? '',
    });
  }

  return prices.sort((a, b) => a.productType.localeCompare(b.productType));
}

/**
 * Resolve recipient emails from company contact IDs + extra emails.
 */
async function resolveRecipientEmails(
  tenantId: string,
  contactIds: string[],
  extraEmails: string[],
): Promise<string[]> {
  const emails: string[] = [...extraEmails];

  if (contactIds.length > 0) {
    // Join through counterparties to ensure contacts belong to this tenant's companies
    const contacts = await db
      .select({
        email: companyContacts.email,
      })
      .from(companyContacts)
      .innerJoin(counterparties, eq(companyContacts.counterpartyId, counterparties.id))
      .where(
        and(
          eq(counterparties.tenantId, tenantId),
          inArray(companyContacts.id, contactIds),
          isNull(companyContacts.deletedAt),
        ),
      );

    for (const c of contacts) {
      if (c.email) emails.push(c.email);
    }
  }

  return Array.from(new Set(emails.map((e) => e.trim()).filter(Boolean)));
}

/**
 * Build HTML email with posted prices table.
 */
function buildPricingEmailHtml(
  placeName: string,
  prices: PostedPrice[],
  since: Date,
): string {
  const dateStr = new Date().toISOString().slice(0, 10);

  const rows = prices
    .map((p) => {
      const priceStr = p.currency === 'USD'
        ? `$${p.price.toFixed(4)}`
        : `${p.price.toFixed(4)} ${p.currency}`;
      return `<tr>
        <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#111827;">${escHtml(p.productType)}</td>
        <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;">${priceStr}</td>
        <td style="padding:8px 16px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:12px;">per ${escHtml(p.unit)}</td>
      </tr>`;
    })
    .join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#111827;max-width:600px;">
      <h2 style="margin:0 0 4px;">${escHtml(placeName)}</h2>
      <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Posted Prices for ${dateStr}</p>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Product</th>
            <th style="padding:10px 16px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Price</th>
            <th style="padding:10px 16px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Unit</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="margin-top:20px;color:#9ca3af;font-size:11px;">
        Prices based on deliveries completed in the last 24 hours.<br>
        This is an automated daily email. Generated at ${new Date().toUTCString()}.
      </p>
    </div>
  `;
}

/**
 * Build plain text version.
 */
function buildPricingEmailText(
  placeName: string,
  prices: PostedPrice[],
  since: Date,
): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const lines = [
    `${placeName} — Posted Prices for ${dateStr}`,
    '',
    'Product          Price          Unit',
    '-------          -----          ----',
  ];

  for (const p of prices) {
    const priceStr = p.currency === 'USD' ? `$${p.price.toFixed(4)}` : `${p.price.toFixed(4)} ${p.currency}`;
    lines.push(`${p.productType.padEnd(16)} ${priceStr.padEnd(14)} per ${p.unit}`);
  }

  lines.push('', 'Prices based on deliveries completed in the last 24 hours.');
  return lines.join('\n');
}

/**
 * Preview the daily pricing email (for admin settings).
 */
export async function previewDailyPricingEmail(
  tenantId: string,
): Promise<{ html: string; priceCount: number; recipientCount: number }> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const settings = ((tenant?.settings ?? {}) as TenantSettings).dailyPricingEmail;
  if (!settings?.placeId) {
    return { html: '<p>No dock/location configured. Set the place in settings first.</p>', priceCount: 0, recipientCount: 0 };
  }

  const lookbackHours = settings.lookbackHours ?? 24;
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const prices = await getPostedPrices(tenantId, settings.placeId, since);

  const [place] = await db
    .select({ name: places.name })
    .from(places)
    .where(eq(places.id, settings.placeId))
    .limit(1);

  const placeName = place?.name ?? 'Fuel Dock';
  const html = buildPricingEmailHtml(placeName, prices, since);

  const recipientCount = await resolveRecipientEmails(
    tenantId,
    settings.recipientContactIds ?? [],
    settings.extraEmails ?? [],
  ).then((emails) => emails.length);

  return { html, priceCount: prices.length, recipientCount };
}

/**
 * Get daily pricing email settings for the current tenant.
 */
export async function getDailyPricingEmailSettings(): Promise<{
  enabled: boolean;
  placeId: string | null;
  placeName: string | null;
  hourUtc: number;
  recipientContactIds: string[];
  extraEmails: string[];
  lookbackHours: number;
  emailSubject: string;
}> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');

  const settings = (tenant.settings ?? {}) as TenantSettings;
  const p = settings.dailyPricingEmail;

  let placeName: string | null = null;
  if (p?.placeId) {
    const [place] = await db
      .select({ name: places.name })
      .from(places)
      .where(eq(places.id, p.placeId))
      .limit(1);
    placeName = place?.name ?? null;
  }

  return {
    enabled: p?.enabled ?? false,
    placeId: p?.placeId ?? null,
    placeName,
    hourUtc: p?.hourUtc ?? 13,
    recipientContactIds: p?.recipientContactIds ?? [],
    extraEmails: p?.extraEmails ?? [],
    lookbackHours: p?.lookbackHours ?? 24,
    emailSubject: p?.emailSubject ?? 'CMF Fuel Dock — Posted Prices',
  };
}

/**
 * Get customer contacts for the tenant (for recipient selection in admin UI).
 */
export async function getCustomerContactOptions(tenantId: string): Promise<
  Array<{ id: string; name: string; email: string | null; companyName: string }>
> {
  const rows = await db
    .select({
      id: companyContacts.id,
      name: companyContacts.name,
      email: companyContacts.email,
      companyName: counterparties.name,
    })
    .from(companyContacts)
    .innerJoin(counterparties, eq(companyContacts.counterpartyId, counterparties.id))
    .where(
      and(
        eq(counterparties.tenantId, tenantId),
        isNull(companyContacts.deletedAt),
      ),
    )
    .orderBy(counterparties.name, companyContacts.name);

  return rows.filter((r) => r.email); // only contacts with emails
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}