import { describe, expect, it } from 'bun:test';
import {
  buildInquiryTemplateVariables,
  formatDeadlineHumanDuration,
  formatStoredDateOnlyLabel,
  getDefaultInquiryResponseDeadline,
  normalizeInquiryDateInput,
} from '../src/modules/documents/inquiry.utils';

describe('inquiry utils', () => {
  it('formats stored date-only values using the UTC calendar day', () => {
    expect(formatStoredDateOnlyLabel('2026-04-15T12:00:00.000Z')).toBe('15 Apr 2026');
    expect(formatStoredDateOnlyLabel(null)).toBeNull();
    expect(formatStoredDateOnlyLabel('not-a-date')).toBeNull();
  });

  it('normalizes blank inquiry date inputs to null', () => {
    expect(normalizeInquiryDateInput('')).toBeNull();
    expect(normalizeInquiryDateInput('   ')).toBeNull();
    expect(normalizeInquiryDateInput('2026-04-15T12:00:00.000Z')).toBe('2026-04-15T12:00:00.000Z');
  });

  it('builds inquiry template variables with placeholders and response deadline labels', () => {
    expect(buildInquiryTemplateVariables({
      vesselName: 'MV TEST',
      portName: 'Singapore',
      orderNumber: 'ORD-100',
      deliveryWindow: '15 Apr 2026 to 16 Apr 2026',
      responseDeadlineFormatted: '2 days',
      senderName: 'Trader',
      companyName: 'Fueld',
    })).toMatchObject({
      vesselName: 'MV TEST',
      portName: 'Singapore',
      orderNumber: 'ORD-100',
      deliveryWindow: '15 Apr 2026 to 16 Apr 2026',
      responseDeadlineFormatted: '2 days',
      supplierName: '${supplierName}',
      contactName: '${contactName}',
      quoteFormUrl: '${quoteFormUrl}',
      name: 'there',
    });
  });

  it('returns null when the default inquiry deadline is disabled', () => {
    expect(getDefaultInquiryResponseDeadline(null)).toBeNull();
    expect(formatDeadlineHumanDuration(null)).toBeNull();
  });

  it('formats a generated deadline into a human duration label', () => {
    const deadlineIso = getDefaultInquiryResponseDeadline(48);
    expect(deadlineIso).toBeTruthy();
    expect(formatDeadlineHumanDuration(deadlineIso)).toBe('2 days');
  });
});