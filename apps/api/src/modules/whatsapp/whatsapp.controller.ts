import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import {
  startWhatsAppSession,
  getWhatsAppStatus,
  disconnectWhatsApp,
  sendWhatsAppMessage,
  listWhatsAppGroups,
} from './whatsapp.service';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  WhatsApp Controller — Link device, status, send messages
// ═══════════════════════════════════════════════════════════════════════

export const whatsappController = new Elysia({ prefix: '/whatsapp' })
  .use(authGuard)

  // ── GET /whatsapp/status ───────────────────────────────────────────
  .get(
    '/status',
    async ({ auth }) => {
      const status = await getWhatsAppStatus(auth.userId, auth.tenantId);
      return { success: true, data: status } satisfies ApiResponse<typeof status>;
    },
    {
      detail: {
        tags: ['WhatsApp'],
        summary: 'Get WhatsApp link status for current user',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /whatsapp/link ────────────────────────────────────────────
  .post(
    '/link',
    async ({ auth }) => {
      const result = await startWhatsAppSession(auth.userId, auth.tenantId);
      return { success: true, data: result } satisfies ApiResponse<typeof result>;
    },
    {
      detail: {
        tags: ['WhatsApp'],
        summary: 'Start WhatsApp linking (QR code pairing)',
        description: 'Initiates a Baileys session. Returns QR code data or connection status. QR updates are also pushed via WebSocket.',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── DELETE /whatsapp/link ──────────────────────────────────────────
  .delete(
    '/link',
    async ({ auth }) => {
      await disconnectWhatsApp(auth.userId);
      return { success: true, data: null, message: 'WhatsApp unlinked' } satisfies ApiResponse<null>;
    },
    {
      detail: {
        tags: ['WhatsApp'],
        summary: 'Unlink WhatsApp device',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── POST /whatsapp/send ────────────────────────────────────────────
  .post(
    '/send',
    async ({ auth, body }) => {
      const result = await sendWhatsAppMessage(
        auth.userId,
        body.phone,
        body.message,
        body.pdfBase64 ? Buffer.from(body.pdfBase64, 'base64') : undefined,
        body.pdfFileName ?? undefined,
      );
      return {
        success: result.success,
        data: null,
        message: result.message,
      } satisfies ApiResponse<null>;
    },
    {
      body: t.Object({
        phone: t.String({ description: 'Recipient phone number with country code, e.g. +4526131217' }),
        message: t.String({ description: 'Text message to send' }),
        pdfBase64: t.Optional(t.String({ description: 'Base64-encoded PDF attachment' })),
        pdfFileName: t.Optional(t.String({ description: 'Filename for the PDF attachment' })),
      }),
      detail: {
        tags: ['WhatsApp'],
        summary: 'Send a WhatsApp message (with optional PDF)',
        security: [{ bearerAuth: [] }],
      },
    },
  )

  // ── GET /whatsapp/groups ───────────────────────────────────────────
  .get(
    '/groups',
    async ({ auth }) => {
      const groups = await listWhatsAppGroups(auth.userId);
      return { success: true, data: groups } satisfies ApiResponse<typeof groups>;
    },
    {
      detail: {
        tags: ['WhatsApp'],
        summary: 'List WhatsApp groups for current user',
        security: [{ bearerAuth: [] }],
      },
    },
  );
