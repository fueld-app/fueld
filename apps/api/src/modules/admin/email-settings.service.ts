// ═══════════════════════════════════════════════════════════════════════
//  Email Settings Service — Templates + Rules CRUD
// ═══════════════════════════════════════════════════════════════════════

import { db } from '../../db';
import { emailTemplates, emailRules } from '../../db/schema';
import { eq, and, or, isNull } from 'drizzle-orm';

// ─── Email Templates ─────────────────────────────────────────────────

export async function getEmailTemplates(tenantId: string) {
  return db.select().from(emailTemplates).where(eq(emailTemplates.tenantId, tenantId));
}

export async function getEmailTemplate(tenantId: string, documentType: string) {
  const [tpl] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.documentType, documentType)))
    .limit(1);
  return tpl ?? null;
}

export async function upsertEmailTemplate(tenantId: string, documentType: string, subjectTemplate: string, bodyTemplate: string) {
  // Try update first
  const existing = await getEmailTemplate(tenantId, documentType);
  if (existing) {
    const [updated] = await db
      .update(emailTemplates)
      .set({ subjectTemplate, bodyTemplate, updatedAt: new Date() })
      .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.documentType, documentType)))
      .returning();
    return updated;
  }
  // Insert
  const [created] = await db
    .insert(emailTemplates)
    .values({ tenantId, documentType, subjectTemplate, bodyTemplate })
    .returning();
  return created;
}

export async function deleteEmailTemplate(tenantId: string, documentType: string) {
  await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.tenantId, tenantId), eq(emailTemplates.documentType, documentType)));
}

// ─── Email Rules ─────────────────────────────────────────────────────

export async function getEmailRules(tenantId: string) {
  return db.select().from(emailRules).where(eq(emailRules.tenantId, tenantId));
}

/**
 * Get rules that apply to a specific own company + document type.
 * Matches: exact company + exact doctype, exact company + any doctype,
 * any company + exact doctype, or any company + any doctype.
 */
export async function getApplicableEmailRules(tenantId: string, ownCompanyId: string | null, documentType: string) {
  const rows = await db
    .select()
    .from(emailRules)
    .where(
      and(
        eq(emailRules.tenantId, tenantId),
        or(
          ownCompanyId ? eq(emailRules.ownCompanyId, ownCompanyId) : isNull(emailRules.ownCompanyId),
          isNull(emailRules.ownCompanyId),
        ),
        or(
          eq(emailRules.documentType, documentType),
          isNull(emailRules.documentType),
        ),
      ),
    );

  // Deduplicate by email (prefer the most specific rule)
  const byEmail = new Map<string, typeof rows[0]>();
  for (const rule of rows) {
    const key = `${rule.ruleType}:${rule.email.toLowerCase()}`;
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, rule);
    } else {
      // More specific = both ownCompanyId AND documentType are set
      const specificity = (r: typeof rule) => (r.ownCompanyId ? 2 : 0) + (r.documentType ? 1 : 0);
      if (specificity(rule) > specificity(existing)) {
        byEmail.set(key, rule);
      }
    }
  }
  return Array.from(byEmail.values());
}

export async function createEmailRule(data: {
  tenantId: string;
  ownCompanyId?: string | null;
  documentType?: string | null;
  ruleType: 'CC' | 'BCC';
  email: string;
  label?: string | null;
}) {
  const [rule] = await db
    .insert(emailRules)
    .values({
      tenantId: data.tenantId,
      ownCompanyId: data.ownCompanyId || null,
      documentType: data.documentType || null,
      ruleType: data.ruleType,
      email: data.email,
      label: data.label || null,
    })
    .returning();
  return rule;
}

export async function deleteEmailRule(ruleId: string, tenantId: string) {
  await db
    .delete(emailRules)
    .where(and(eq(emailRules.id, ruleId), eq(emailRules.tenantId, tenantId)));
}

// ─── Template Rendering ──────────────────────────────────────────────

export interface TemplateVariables {
  vesselName: string;
  portName: string;
  orderNumber: string;
  documentLabel: string;
  eta?: string;
  etd?: string;
  deliveryWindow?: string;
  responseDeadlineFormatted?: string;
  senderName: string;
  companyName: string;
  paymentTerms: string;
  customerNote: string;
  supplierNote: string;
  invoiceNumber: string;
  supplierName?: string;
  contactName?: string;
  name?: string;
  quoteFormUrl?: string;
  nominationResponseUrl?: string;
}

/**
 * Render a template string by replacing {{variable}} and ${variable} placeholders.
 */
export function renderTemplate(template: string, vars: TemplateVariables): string {
  return template.replace(/\{\{(\w+)\}\}|\$\{(\w+)\}/g, (_, moustacheKey: string, dollarKey: string) => {
    const key = moustacheKey || dollarKey;
    return (vars as any)[key] ?? '';
  });
}

/**
 * Available template variables for documentation / admin UI.
 */
export const TEMPLATE_VARIABLES = [
  { key: 'vesselName', label: 'Vessel name', example: 'MV Atlantic Spirit' },
  { key: 'portName', label: 'Port name', example: 'Rotterdam' },
  { key: 'orderNumber', label: 'Order number', example: '20260209-000001' },
  { key: 'documentLabel', label: 'Document type label', example: 'Offer / Confirmation' },
  { key: 'eta', label: 'ETA date label', example: '12 Mar 2026' },
  { key: 'etd', label: 'ETD date label', example: '14 Mar 2026' },
  { key: 'deliveryWindow', label: 'Delivery window label', example: '12 Mar 2026 to 14 Mar 2026' },
  { key: 'responseDeadlineFormatted', label: 'Response deadline label', example: '2 days' },
  { key: 'senderName', label: 'Sender name', example: 'John Smith' },
  { key: 'companyName', label: 'Invoicing company name', example: 'Riviera Marine Ltd' },
  { key: 'paymentTerms', label: 'Payment terms', example: 'Credit 30 days' },
  { key: 'customerNote', label: 'Customer note', example: 'Please confirm by EOD' },
  { key: 'supplierNote', label: 'Supplier note / remark', example: 'Deliver before 16:00' },
  { key: 'invoiceNumber', label: 'Invoice number', example: 'INV-2026-001' },
  { key: 'supplierName', label: 'Supplier company name', example: 'Shell Marine Fuels' },
  { key: 'contactName', label: 'Supplier contact name', example: 'Jane Bunker' },
  { key: 'name', label: 'Preferred greeting name', example: 'Jane Bunker' },
  { key: 'quoteFormUrl', label: 'Secure supplier quote form URL', example: 'https://app.fueld.com/supplier-quote/abc123' },
  { key: 'nominationResponseUrl', label: 'Secure supplier nomination response URL', example: 'https://app.fueld.com/supplier-nomination/abc123' },
  // Bunker Booking email
  { key: 'captainName', label: 'Captain name (vessel person)', example: 'Sergiy' },
  { key: 'dates', label: 'Delivery dates (ETA → ETD)', example: '3rd to 7th of July' },
  { key: 'agent', label: 'Agent company name', example: 'Altarmar' },
  { key: 'physicalSupplier', label: 'Physical supplier company name', example: 'Trafigura' },
  { key: 'deliveryMethod', label: 'Delivery method', example: 'Via Barge' },
  { key: 'products', label: 'Product / Quantity lines block', example: 'Product: VLSFO 0.5%\nQnty: 350 - 400 MT' },
  { key: 'phone', label: 'Recipient phone number (WhatsApp)', example: '+4526131217' },
];
