import type { TemplateVariables } from '../admin/email-settings.service';
import { isIanaTimezone } from '../../utils/timezone';

export function buildInquiryTemplateVariables(params: {
  vesselName: string;
  portName: string;
  orderNumber: string;
  eta?: string | null;
  etd?: string | null;
  deliveryWindow?: string | null;
  responseDeadlineFormatted?: string | null;
  senderName: string;
  companyName: string;
  supplierName?: string | null;
  contactName?: string | null;
  quoteFormUrl?: string | null;
}): TemplateVariables {
  const preferredName = params.contactName?.trim() || params.supplierName?.trim() || 'there';
  const quoteFormUrl = params.quoteFormUrl == null ? '${quoteFormUrl}' : params.quoteFormUrl.trim();

  return {
    vesselName: params.vesselName,
    portName: params.portName,
    orderNumber: params.orderNumber,
    documentLabel: 'Inquiry',
    eta: params.eta?.trim() || '',
    etd: params.etd?.trim() || '',
    deliveryWindow: params.deliveryWindow?.trim() || '',
    responseDeadlineFormatted: params.responseDeadlineFormatted?.trim() || '',
    senderName: params.senderName,
    companyName: params.companyName,
    paymentTerms: '',
    customerNote: '',
    supplierNote: '',
    invoiceNumber: '',
    supplierName: params.supplierName?.trim() || '${supplierName}',
    contactName: params.contactName?.trim() || '${contactName}',
    name: preferredName,
    quoteFormUrl,
  };
}

export function formatStoredDateOnlyLabel(value: string | Date | null | undefined, tz?: string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const safeTz = tz && isIanaTimezone(tz) ? tz : 'UTC';

  return new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function normalizeInquiryDateInput(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized ? normalized : null;
}

export function getDefaultInquiryResponseDeadline(hours: number | null | undefined = 48): string | null {
  if (typeof hours !== 'number' || hours < 1) return null;
  return new Date(Date.now() + (hours * 3_600_000)).toISOString();
}

export function formatDeadlineHumanDuration(deadlineIso: string | null | undefined): string | null {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso);
  if (Number.isNaN(deadline.getTime())) return null;

  const hours = Math.round((deadline.getTime() - Date.now()) / 3_600_000);
  if (hours < 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;

  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}