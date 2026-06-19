// ═══════════════════════════════════════════════════════════════════════
//  Settings Operations Service — order numbers, vessel roles, delivery
//  documentation, inquiry settings, WhatsApp, financing, etc.
// ═══════════════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { tenants, whatsappNotificationRules, type TenantSettings } from '../../db/schema';

async function getTenantSettingsRow() {
  const [tenant] = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants).limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  return { tenantId: tenant?.id ?? '', settings };
}

async function updateTenantField<T>(key: string, value: T): Promise<T> {
  const { tenantId, settings } = await getTenantSettingsRow();
  await db.update(tenants).set({ settings: { ...settings, [key]: value }, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return value;
}

// ─── Defaults ──────────────────────────────────────────────────────

export const DEFAULT_FINANCING_RATE_ANNUAL = 0.08;
export const DEFAULT_FINANCING_DAY_COUNT = 365;
export const DEFAULT_SUPPLIER_RESPONSE_URL_ENABLED = true;
export const DEFAULT_AUTO_MARK_NO_REPLY_AFTER_HOURS = 168;
export const DEFAULT_RESPONSE_DEADLINE_HOURS = 48;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_EMAIL = false;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_PUSH = false;
export const DEFAULT_NOTIFY_QUOTE_SUBMIT_WHATSAPP = false;
export const DEFAULT_COST_SALES_DECIMAL_PRECISION = 5;
export const DEFAULT_DATE_FORMAT = 'ISO' as const;
export type DateFormatSetting = 'AMERICAN' | 'EUROPEAN' | 'ISO';

// ─── Order Number Settings ─────────────────────────────────────────

export interface OrderNumberSettingsDto {
  prefix: string;
  template: string;
}

export async function getOrderNumberSettings(): Promise<OrderNumberSettingsDto> {
  const { settings } = await getTenantSettingsRow();
  return { prefix: settings.orderNumberPrefix ?? '', template: settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}' };
}

export async function updateOrderNumberSettings(data: { prefix?: string; template?: string }): Promise<OrderNumberSettingsDto> {
  if (data.prefix !== undefined) await updateTenantField('orderNumberPrefix', data.prefix);
  if (data.template !== undefined) await updateTenantField('orderNumberTemplate', data.template);
  return getOrderNumberSettings();
}

// ─── Vessel Company Roles ──────────────────────────────────────────

export async function getVesselCompanyRoleSettings(): Promise<{ roles: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[] }> {
  const { settings } = await getTenantSettingsRow();
  return { roles: settings.vesselCompanyRoles ?? [] };
}

export async function updateVesselCompanyRoleSettings(roles: { key: string; label: string; group: string; description?: string; seasearcherCode?: string }[]) {
  return { roles: await updateTenantField('vesselCompanyRoles', roles) };
}

// ─── Vessel Types ──────────────────────────────────────────────────

export async function getVesselTypeSettings(): Promise<{ vesselTypes: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { vesselTypes: settings.vesselTypes ?? [] };
}

export async function updateVesselTypeSettings(vesselTypes: string[]): Promise<{ vesselTypes: string[] }> {
  return { vesselTypes: await updateTenantField('vesselTypes', vesselTypes) };
}

// ─── Attachment Types ──────────────────────────────────────────────

export async function getAttachmentTypeSettings(): Promise<{ attachmentTypes: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { attachmentTypes: settings.attachmentTypes ?? [] };
}

export async function updateAttachmentTypeSettings(attachmentTypes: string[]): Promise<{ attachmentTypes: string[] }> {
  return { attachmentTypes: await updateTenantField('attachmentTypes', attachmentTypes) };
}

// ─── Delivery Documentation ────────────────────────────────────────

export interface DeliveryDocumentationSettings {
  requireDeliveryDocumentation: boolean;
  deliveryDocumentationTypes: string[];
}

export async function getDeliveryDocumentationSettings(): Promise<DeliveryDocumentationSettings> {
  const { settings } = await getTenantSettingsRow();
  return { requireDeliveryDocumentation: settings.requireDeliveryDocumentation ?? false, deliveryDocumentationTypes: settings.deliveryDocumentationTypes ?? [] };
}

export async function updateDeliveryDocumentationSettings(data: { requireDeliveryDocumentation?: boolean; deliveryDocumentationTypes?: string[] }): Promise<DeliveryDocumentationSettings> {
  if (data.requireDeliveryDocumentation !== undefined) await updateTenantField('requireDeliveryDocumentation', data.requireDeliveryDocumentation);
  if (data.deliveryDocumentationTypes !== undefined) await updateTenantField('deliveryDocumentationTypes', data.deliveryDocumentationTypes);
  return getDeliveryDocumentationSettings();
}

// ─── Port Documentation ────────────────────────────────────────────

export async function getPortDocumentationSettings(): Promise<{ enabled: boolean }> {
  const { settings } = await getTenantSettingsRow();
  return { enabled: settings.portDocumentationEnabled ?? false };
}

export async function updatePortDocumentationSettings(data: { enabled?: boolean }): Promise<{ enabled: boolean }> {
  return { enabled: await updateTenantField('portDocumentationEnabled', data.enabled ?? false) };
}

// ─── Inquiry Cancel Reasons ────────────────────────────────────────

export async function getInquiryCancelReasonSettings(): Promise<{ reasons: string[] }> {
  const { settings } = await getTenantSettingsRow();
  return { reasons: settings.inquiryCancelReasons ?? [] };
}

export async function updateInquiryCancelReasonSettings(reasons: string[]): Promise<{ reasons: string[] }> {
  return { reasons: await updateTenantField('inquiryCancelReasons', reasons) };
}

// ─── Inquiry Settings ──────────────────────────────────────────────

export interface InquirySettings {
  supplierResponseUrlEnabled: boolean;
  autoMarkNoReplyAfterHours: number;
  responseDeadlineHours: number;
  notifyQuoteSubmitEmail: boolean;
  notifyQuoteSubmitPush: boolean;
  notifyQuoteSubmitWhatsApp: boolean;
}

export async function getInquirySettings(): Promise<InquirySettings> {
  const { settings } = await getTenantSettingsRow();
  return {
    supplierResponseUrlEnabled: settings.supplierResponseUrlEnabled ?? DEFAULT_SUPPLIER_RESPONSE_URL_ENABLED,
    autoMarkNoReplyAfterHours: settings.autoMarkNoReplyAfterHours ?? DEFAULT_AUTO_MARK_NO_REPLY_AFTER_HOURS,
    responseDeadlineHours: settings.responseDeadlineHours ?? DEFAULT_RESPONSE_DEADLINE_HOURS,
    notifyQuoteSubmitEmail: settings.notifyQuoteSubmitEmail ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_EMAIL,
    notifyQuoteSubmitPush: settings.notifyQuoteSubmitPush ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_PUSH,
    notifyQuoteSubmitWhatsApp: settings.notifyQuoteSubmitWhatsApp ?? DEFAULT_NOTIFY_QUOTE_SUBMIT_WHATSAPP,
  };
}

export async function updateInquirySettings(data: Partial<InquirySettings>): Promise<InquirySettings> {
  const current = await getInquirySettings();
  const merged = { ...current, ...data };
  await updateTenantField('supplierResponseUrlEnabled', merged.supplierResponseUrlEnabled);
  await updateTenantField('autoMarkNoReplyAfterHours', merged.autoMarkNoReplyAfterHours);
  await updateTenantField('responseDeadlineHours', merged.responseDeadlineHours);
  await updateTenantField('notifyQuoteSubmitEmail', merged.notifyQuoteSubmitEmail);
  await updateTenantField('notifyQuoteSubmitPush', merged.notifyQuoteSubmitPush);
  await updateTenantField('notifyQuoteSubmitWhatsApp', merged.notifyQuoteSubmitWhatsApp);
  return merged;
}

// ─── Financing Settings ────────────────────────────────────────────

export async function getFinancingSettings(): Promise<{ annualRate: number; dayCountConvention: number }> {
  const { settings } = await getTenantSettingsRow();
  return { annualRate: settings.financingAnnualRate ?? DEFAULT_FINANCING_RATE_ANNUAL, dayCountConvention: settings.financingDayCount ?? DEFAULT_FINANCING_DAY_COUNT };
}

export async function updateFinancingSettings(annualRate: number): Promise<{ annualRate: number; dayCountConvention: number }> {
  await updateTenantField('financingAnnualRate', annualRate);
  return getFinancingSettings();
}

// ─── WhatsApp Settings ─────────────────────────────────────────────

export async function getWhatsAppSettings(): Promise<{ enabled: boolean; defaultGroupJid: string | null; incomingRfqEnabled: boolean; firstInquiryGroupNotificationEnabled: boolean }> {
  const { settings } = await getTenantSettingsRow();
  return { enabled: settings.whatsappEnabled ?? false, defaultGroupJid: settings.whatsappDefaultGroupJid ?? null, incomingRfqEnabled: settings.whatsappIncomingRfqEnabled ?? false, firstInquiryGroupNotificationEnabled: settings.whatsappFirstInquiryGroupNotificationEnabled ?? false };
}

export async function updateWhatsAppSettings(data: { enabled?: boolean; defaultGroupJid?: string | null; incomingRfqEnabled?: boolean; firstInquiryGroupNotificationEnabled?: boolean }) {
  if (data.enabled !== undefined) await updateTenantField('whatsappEnabled', data.enabled);
  if (data.defaultGroupJid !== undefined) await updateTenantField('whatsappDefaultGroupJid', data.defaultGroupJid);
  if (data.incomingRfqEnabled !== undefined) await updateTenantField('whatsappIncomingRfqEnabled', data.incomingRfqEnabled);
  if (data.firstInquiryGroupNotificationEnabled !== undefined) await updateTenantField('whatsappFirstInquiryGroupNotificationEnabled', data.firstInquiryGroupNotificationEnabled);
  return getWhatsAppSettings();
}

// ─── WhatsApp Notification Rules ──────────────────────────────────

export async function getWhatsAppNotificationRules() {
  return db.select().from(whatsappNotificationRules).orderBy(whatsappNotificationRules.eventType);
}

export async function createWhatsAppNotificationRule(data: { eventType: string; groupJid: string; templateName: string; isActive?: boolean }) {
  const [created] = await db.insert(whatsappNotificationRules).values(data).returning();
  return created;
}

export async function updateWhatsAppNotificationRule(id: string, data: { eventType?: string; groupJid?: string; templateName?: string; isActive?: boolean }) {
  const [updated] = await db.update(whatsappNotificationRules).set({ ...data, updatedAt: new Date() }).where(eq(whatsappNotificationRules.id, id)).returning();
  if (!updated) throw new Error('WhatsApp notification rule not found');
  return updated;
}

export async function deleteWhatsAppNotificationRule(id: string) {
  await db.delete(whatsappNotificationRules).where(eq(whatsappNotificationRules.id, id));
}

// ─── Broker Settings ──────────────────────────────────────────────

export async function getBrokerSettings(): Promise<{ brokerCcCustomer: boolean }> {
  const { settings } = await getTenantSettingsRow();
  return { brokerCcCustomer: settings.brokerCcCustomer ?? false };
}

export async function updateBrokerSettings(data: { brokerCcCustomer?: boolean }): Promise<{ brokerCcCustomer: boolean }> {
  return { brokerCcCustomer: await updateTenantField('brokerCcCustomer', data.brokerCcCustomer ?? false) };
}

// ─── Follow-Up Settings ───────────────────────────────────────────

export async function getFollowUpSettings(): Promise<{ defaultFollowUpDays: number }> {
  const { settings } = await getTenantSettingsRow();
  return { defaultFollowUpDays: settings.defaultFollowUpDays ?? 30 };
}

export async function updateFollowUpSettings(data: { defaultFollowUpDays?: number }): Promise<{ defaultFollowUpDays: number }> {
  return { defaultFollowUpDays: await updateTenantField('defaultFollowUpDays', data.defaultFollowUpDays ?? 30) };
}

// ─── Role Dashboard Settings ───────────────────────────────────────

export async function getRoleDashboardSettings(): Promise<{ dashboards: Record<string, string> }> {
  const { settings } = await getTenantSettingsRow();
  return { dashboards: settings.roleDashboards ?? {} };
}

export async function updateRoleDashboardSettings(dashboards: Record<string, string>): Promise<{ dashboards: Record<string, string> }> {
  return { dashboards: await updateTenantField('roleDashboards', dashboards) };
}

// ─── Timezone Settings ────────────────────────────────────────────

export async function getTimezoneSettings(): Promise<{ defaultTimezone: string | null }> {
  const { settings } = await getTenantSettingsRow();
  return { defaultTimezone: settings.defaultTimezone ?? null };
}

export async function updateTimezoneSettings(data: { defaultTimezone?: string | null }): Promise<{ defaultTimezone: string | null }> {
  return { defaultTimezone: await updateTenantField('defaultTimezone', data.defaultTimezone ?? null) };
}

export async function getCostSalesDecimalPrecision(): Promise<{ precision: number }> {
  const { settings } = await getTenantSettingsRow();
  return { precision: settings.costSalesDecimalPrecision ?? DEFAULT_COST_SALES_DECIMAL_PRECISION };
}

export async function updateCostSalesDecimalPrecision(data: { precision?: number }): Promise<{ precision: number }> {
  return { precision: await updateTenantField('costSalesDecimalPrecision', data.precision ?? DEFAULT_COST_SALES_DECIMAL_PRECISION) };
}

export async function getDateFormatSettings(): Promise<{ dateFormat: DateFormatSetting }> {
  const { settings } = await getTenantSettingsRow();
  return { dateFormat: (settings.dateFormat as DateFormatSetting) ?? DEFAULT_DATE_FORMAT };
}

export async function updateDateFormatSettings(data: { dateFormat?: DateFormatSetting }): Promise<{ dateFormat: DateFormatSetting }> {
  return { dateFormat: await updateTenantField('dateFormat', data.dateFormat ?? DEFAULT_DATE_FORMAT) };
}
