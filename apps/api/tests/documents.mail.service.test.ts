import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sendDocumentEmail, buildDocumentEmailHtml, buildDocumentEmailSubject } from '../src/modules/documents/mail.service';
import type { SendDocumentEmailOptions } from '../src/modules/documents/mail.service';

describe('documents mail service', () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  let capturedUrl: string | null = null;
  let capturedInit: RequestInit | null = null;

  beforeEach(() => {
    capturedUrl = null;
    capturedInit = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  const baseOptions: SendDocumentEmailOptions = {
    documentType: 'INVOICE',
    orderId: '00000000-0000-0000-0000-000000000001',
    tenantId: '00000000-0000-0000-0000-000000000002',
    sentByUserId: '00000000-0000-0000-0000-000000000003',
    senderEmail: 'sender@example.com',
    senderName: 'Test Sender',
    recipientEmail: 'customer@example.com',
    ccEmails: [],
    subject: 'Test Subject',
    htmlBody: '<p>Hello</p>',
    pdfBuffer: Buffer.from('fake-pdf'),
    pdfFileName: 'Test.pdf',
  };

  test('sendDocumentEmail sends via Graph when accessToken is provided', async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    const result = await sendDocumentEmail({ ...baseOptions, accessToken: 'token-123' });

    expect(result.channel).toBe('GRAPH');
    expect(capturedUrl).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-123');

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.message.subject).toBe('Test Subject');
    expect(payload.message.body.contentType).toBe('HTML');
    expect(payload.message.body.content).toBe('<p>Hello</p>');
    expect(payload.message.toRecipients[0].emailAddress.address).toBe('customer@example.com');
    expect(payload.message.attachments).toHaveLength(1);
    expect(payload.message.attachments[0].name).toBe('Test.pdf');
    expect(payload.saveToSentItems).toBe(true);
  });

  test('sendDocumentEmail includes CC recipients in Graph payload', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    await sendDocumentEmail({
      ...baseOptions,
      accessToken: 'token-cc',
      ccEmails: ['sales@example.com', 'ops@example.com'],
    });

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.message.ccRecipients).toHaveLength(2);
    expect(payload.message.ccRecipients[0].emailAddress.address).toBe('sales@example.com');
    expect(payload.message.ccRecipients[1].emailAddress.address).toBe('ops@example.com');
  });

  test('sendDocumentEmail throws on non-ok Graph response', async () => {
    const logs: string[] = [];
    console.error = ((...args: unknown[]) => {
      logs.push(args.map((value) => String(value)).join(' '));
    }) as typeof console.error;

    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('graph error', { status: 500 })) as typeof fetch;

    await expect(
      sendDocumentEmail({ ...baseOptions, accessToken: 'bad-token' }),
    ).rejects.toThrow('Failed to send email via Graph API: 500');

    expect(logs.some((l) => l.includes('Graph API returned 500'))).toBe(true);
  });

  test('buildDocumentEmailSubject generates correct subject lines', () => {
    expect(buildDocumentEmailSubject({
      documentType: 'INVOICE',
      orderNumber: 'ORD-001',
      vesselName: 'MV TEST',
      portName: 'Singapore',
      invoiceNumber: 'INV-2026-0001',
    })).toBe('Invoice INV-2026-0001 — Bunker Delivery (MV TEST)');

    expect(buildDocumentEmailSubject({
      documentType: 'OFFER',
      orderNumber: 'ORD-001',
      vesselName: 'MV TEST',
      portName: 'Singapore',
    })).toBe('Offer / Confirmation — ORD-001 — MV TEST, Singapore');

    expect(buildDocumentEmailSubject({
      documentType: 'NOMINATION',
      orderNumber: 'ORD-001',
      vesselName: 'MV TEST',
      portName: 'Singapore',
    })).toBe('Nomination — ORD-001 — MV TEST, Singapore');
  });

  test('buildDocumentEmailHtml includes vessel, port, payment terms and notes', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'INVOICE',
      senderName: 'John Doe',
      vesselName: 'MV TEST',
      portName: 'Singapore',
      orderNumber: 'ORD-001',
      paymentTerms: 'Credit 30 days',
      customerNote: 'Please process promptly',
      itemNotes: [{ label: 'VLSFO', note: 'Barge side note' }],
    });

    expect(html).toContain('MV TEST');
    expect(html).toContain('Singapore');
    expect(html).toContain('Payment terms:');
    expect(html).toContain('Credit 30 days');
    expect(html).toContain('Please process promptly');
    expect(html).toContain('<li>VLSFO: Barge side note</li>');
    expect(html).toContain('John Doe');
  });
});
