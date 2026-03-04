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

  // ─── Graph channel tests ──────────────────────────────────────────

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
    expect(payload.message.attachments[0]['@odata.type']).toBe('#microsoft.graph.fileAttachment');
    expect(payload.message.attachments[0].contentType).toBe('application/pdf');
    expect(payload.message.attachments[0].contentBytes).toBe(Buffer.from('fake-pdf').toString('base64'));
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

  test('sendDocumentEmail omits ccRecipients when CC list is empty', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    await sendDocumentEmail({ ...baseOptions, accessToken: 'token-no-cc', ccEmails: [] });

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.message.ccRecipients).toBeUndefined();
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

  test('sendDocumentEmail treats placeholder-o365-token as no token (SMTP fallback)', async () => {
    // With the placeholder token, should attempt SMTP (not Graph)
    // SMTP will fail because no config is set, but we verify it doesn't call Graph
    let graphCalled = false;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      graphCalled = true;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    // Suppress console.error from logEmail failures
    console.error = (() => {}) as typeof console.error;

    await expect(
      sendDocumentEmail({ ...baseOptions, accessToken: 'placeholder-o365-token' }),
    ).rejects.toThrow(/SMTP/);

    expect(graphCalled).toBe(false);
  });

  test('sendDocumentEmail falls back to SMTP when no accessToken is provided', async () => {
    // Without accessToken, should attempt SMTP (not Graph)
    let graphCalled = false;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
      graphCalled = true;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    // Suppress console.error from logEmail failures
    console.error = (() => {}) as typeof console.error;

    await expect(
      sendDocumentEmail({ ...baseOptions }),
    ).rejects.toThrow(/SMTP/);

    expect(graphCalled).toBe(false);
  });

  // ─── Subject builder tests ────────────────────────────────────────

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

  test('buildDocumentEmailSubject generates correct PROFORMA subject', () => {
    expect(buildDocumentEmailSubject({
      documentType: 'PROFORMA',
      orderNumber: 'ORD-042',
      vesselName: 'MV OCEAN',
      portName: 'Rotterdam',
    })).toBe('Proforma Invoice — ORD-042 — MV OCEAN, Rotterdam');
  });

  test('buildDocumentEmailSubject uses generic format for INVOICE without invoiceNumber', () => {
    expect(buildDocumentEmailSubject({
      documentType: 'INVOICE',
      orderNumber: 'ORD-005',
      vesselName: 'MV WAVE',
      portName: 'Houston',
    })).toBe('Invoice — ORD-005 — MV WAVE, Houston');
  });

  // ─── HTML template tests ──────────────────────────────────────────

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

  test('buildDocumentEmailHtml uses customer greeting for OFFER', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'OFFER',
      senderName: 'Alice',
      vesselName: 'MV STAR',
      portName: 'Fujairah',
      orderNumber: 'ORD-010',
    });

    expect(html).toContain('Dear Customer');
    expect(html).toContain('offer for bunker delivery');
    expect(html).toContain('MV STAR');
    expect(html).toContain('Fujairah');
    expect(html).toContain('Alice');
    expect(html).toContain('FUELD');
  });

  test('buildDocumentEmailHtml uses supplier greeting for NOMINATION', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'NOMINATION',
      senderName: 'Bob',
      vesselName: 'MV CARGO',
      portName: 'Rotterdam',
      orderNumber: 'ORD-020',
    });

    expect(html).toContain('Dear Supplier');
    expect(html).toContain('nomination for bunker delivery');
    expect(html).toContain('MV CARGO');
    expect(html).toContain('Rotterdam');
  });

  test('buildDocumentEmailHtml uses correct labels for PROFORMA', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'PROFORMA',
      senderName: 'Carol',
      vesselName: 'MV BLUE',
      portName: 'Singapore',
      orderNumber: 'ORD-030',
    });

    expect(html).toContain('Dear Customer');
    expect(html).toContain('proforma invoice for bunker delivery');
  });

  test('buildDocumentEmailHtml omits payment terms row when not provided', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'INVOICE',
      senderName: 'Dave',
      vesselName: 'MV TEST',
      portName: 'Singapore',
      orderNumber: 'ORD-040',
    });

    expect(html).not.toContain('Payment terms:');
    expect(html).toContain('MV TEST');
    expect(html).toContain('Dave');
  });

  test('buildDocumentEmailHtml omits customer note and item notes when empty', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'INVOICE',
      senderName: 'Eve',
      vesselName: 'MV LIGHT',
      portName: 'Hamburg',
      orderNumber: 'ORD-050',
      customerNote: null,
      itemNotes: [],
    });

    expect(html).not.toContain('<ul');
    expect(html).not.toContain('<li>');
    // Should still contain the basic structure
    expect(html).toContain('MV LIGHT');
    expect(html).toContain('Hamburg');
    expect(html).toContain('Eve');
  });

  test('buildDocumentEmailHtml renders multiple item notes', () => {
    const html = buildDocumentEmailHtml({
      documentType: 'OFFER',
      senderName: 'Frank',
      vesselName: 'MV MULTI',
      portName: 'Piraeus',
      orderNumber: 'ORD-060',
      itemNotes: [
        { label: 'VLSFO', note: 'Max 0.5% sulfur' },
        { label: 'MGO', note: 'DMA grade' },
        { label: 'HSFO', note: 'Pipe delivery only' },
      ],
    });

    expect(html).toContain('<li>VLSFO: Max 0.5% sulfur</li>');
    expect(html).toContain('<li>MGO: DMA grade</li>');
    expect(html).toContain('<li>HSFO: Pipe delivery only</li>');
  });
});
