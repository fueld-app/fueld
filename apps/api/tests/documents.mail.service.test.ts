import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sendGraphMail, sendInvoiceEmail } from '../src/modules/documents/mail.service';

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

  test('sendGraphMail posts expected payload without attachment', async () => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    await sendGraphMail({
      accessToken: 'token-123',
      to: 'customer@example.com',
      subject: 'Test Subject',
      htmlBody: '<p>Hello</p>',
    });

    expect(capturedUrl).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)?.Authorization).toBe('Bearer token-123');

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.message.subject).toBe('Test Subject');
    expect(payload.message.body.contentType).toBe('HTML');
    expect(payload.message.body.content).toBe('<p>Hello</p>');
    expect(payload.message.toRecipients[0].emailAddress.address).toBe('customer@example.com');
    expect(payload.message.attachments).toBeUndefined();
    expect(payload.saveToSentItems).toBe(true);
  });

  test('sendGraphMail includes attachment when provided', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    await sendGraphMail({
      accessToken: 'token-attach',
      to: 'recipient@example.com',
      subject: 'With Attachment',
      htmlBody: '<p>Body</p>',
      attachment: {
        fileName: 'invoice.pdf',
        contentType: 'application/pdf',
        contentBytes: 'YmFzZTY0',
      },
    });

    const payload = JSON.parse(String(capturedInit?.body));
    expect(payload.message.attachments).toHaveLength(1);
    expect(payload.message.attachments[0]).toEqual({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBytes: 'YmFzZTY0',
    });
  });

  test('sendGraphMail throws on non-ok Graph response', async () => {
    let logged = '';
    console.error = ((...args: unknown[]) => {
      logged = args.map((value) => String(value)).join(' ');
    }) as typeof console.error;

    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('graph error', { status: 500 })) as typeof fetch;

    await expect(sendGraphMail({
      accessToken: 'bad-token',
      to: 'recipient@example.com',
      subject: 'Failure',
      htmlBody: '<p>x</p>',
    })).rejects.toThrow('Failed to send email via Graph API: 500');

    expect(logged).toContain('Graph API returned 500');
    expect(logged).toContain('graph error');
  });

  test('sendInvoiceEmail composes subject, html and PDF attachment', async () => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? null;
      return new Response('', { status: 202 });
    }) as typeof fetch;

    const pdfBuffer = Buffer.from('fake-pdf-content');

    await sendInvoiceEmail({
      accessToken: 'invoice-token',
      recipientEmail: 'billing@example.com',
      invoiceNumber: 'INV-2026-0001',
      pdfBuffer,
      pdfFileName: 'Fueld_Invoice_INV-2026-0001.pdf',
      vesselName: 'MV TEST',
      portName: 'Singapore',
      paymentTerms: 'Credit 30 days',
      customerNote: 'Please process promptly',
      itemNotes: [{ label: 'VLSFO', note: 'Barge side note' }],
    });

    const payload = JSON.parse(String(capturedInit?.body));

    expect(payload.message.subject).toBe('Invoice INV-2026-0001 — Bunker Delivery (MV TEST)');
    expect(payload.message.toRecipients[0].emailAddress.address).toBe('billing@example.com');

    const html = String(payload.message.body.content);
    expect(html).toContain('invoice <strong>INV-2026-0001</strong>');
    expect(html).toContain('MV TEST');
    expect(html).toContain('Singapore');
    expect(html).toContain('Payment terms:');
    expect(html).toContain('Please process promptly');
    expect(html).toContain('<li>VLSFO: Barge side note</li>');

    expect(payload.message.attachments).toHaveLength(1);
    expect(payload.message.attachments[0].name).toBe('Fueld_Invoice_INV-2026-0001.pdf');
    expect(payload.message.attachments[0].contentType).toBe('application/pdf');
    expect(payload.message.attachments[0].contentBytes).toBe(pdfBuffer.toString('base64'));
  });
});
