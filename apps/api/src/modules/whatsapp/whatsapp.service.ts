// ═══════════════════════════════════════════════════════════════════════
//  WhatsApp Service — Baileys multi-device linked-device integration
//  Manages per-user WhatsApp connections, DB-backed auth state,
//  QR code pairing, and message sending.
// ═══════════════════════════════════════════════════════════════════════

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
  type AuthenticationCreds,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { whatsappSessions, whatsappKeys } from '../../db/schema';
import { sendToUserSockets } from '../activity/session-tracker';

// ─── In-memory connection pool ───────────────────────────────────────

interface UserConnection {
  socket: WASocket;
  status: 'connecting' | 'qr' | 'connected' | 'closed';
  qr?: string;          // Current QR string (for frontend to render)
  phoneNumber?: string;  // Once paired
}

const connections = new Map<string, UserConnection>();

// ─── DB-backed Auth State for Baileys ────────────────────────────────

async function useDbAuthState(userId: string) {
  // Load or create creds
  const [existing] = await db
    .select({ creds: whatsappSessions.creds })
    .from(whatsappSessions)
    .where(eq(whatsappSessions.userId, userId))
    .limit(1);

  let creds: AuthenticationCreds;
  if (existing?.creds) {
    creds = existing.creds as AuthenticationCreds;
  } else {
    // Use Baileys' helper to generate initial creds
    const { initAuthCreds } = await import('@whiskeysockets/baileys');
    creds = initAuthCreds();
    await db.insert(whatsappSessions).values({
      userId,
      creds: creds as any,
    }).onConflictDoUpdate({
      target: whatsappSessions.userId,
      set: { creds: creds as any, updatedAt: new Date() },
    });
  }

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({
        get: async (type: string, ids: string[]) => {
          const rows = await db
            .select({ keyId: whatsappKeys.keyId, keyData: whatsappKeys.keyData })
            .from(whatsappKeys)
            .where(and(eq(whatsappKeys.userId, userId), eq(whatsappKeys.keyType, type)));

          const result: Record<string, any> = {};
          for (const row of rows) {
            if (ids.includes(row.keyId)) {
              result[row.keyId] = row.keyData;
            }
          }
          return result;
        },
        set: async (data: Record<string, Record<string, any>>) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [keyId, value] of Object.entries(entries)) {
              if (value) {
                // Upsert
                const [existing] = await db
                  .select({ id: whatsappKeys.id })
                  .from(whatsappKeys)
                  .where(and(
                    eq(whatsappKeys.userId, userId),
                    eq(whatsappKeys.keyType, type),
                    eq(whatsappKeys.keyId, keyId),
                  ))
                  .limit(1);

                if (existing) {
                  await db
                    .update(whatsappKeys)
                    .set({ keyData: value as any })
                    .where(eq(whatsappKeys.id, existing.id));
                } else {
                  await db.insert(whatsappKeys).values({
                    userId,
                    keyType: type,
                    keyId,
                    keyData: value as any,
                  });
                }
              } else {
                // Delete
                await db
                  .delete(whatsappKeys)
                  .where(and(
                    eq(whatsappKeys.userId, userId),
                    eq(whatsappKeys.keyType, type),
                    eq(whatsappKeys.keyId, keyId),
                  ));
              }
            }
          }
        },
      } as any),
    },
    saveCreds: async () => {
      await db
        .update(whatsappSessions)
        .set({ creds: creds as any, updatedAt: new Date() })
        .where(eq(whatsappSessions.userId, userId));
    },
  };
}

// ─── Connection Management ───────────────────────────────────────────

export async function startWhatsAppSession(userId: string): Promise<{ qr?: string; status: string }> {
  // If already connected, return status
  const existing = connections.get(userId);
  if (existing) {
    if (existing.status === 'connected') {
      return { status: 'connected' };
    }
    if (existing.status === 'qr' && existing.qr) {
      return { status: 'qr', qr: existing.qr };
    }
    if (existing.status === 'connecting') {
      return { status: 'connecting' };
    }
  }

  const { state, saveCreds } = await useDbAuthState(userId);
  const { version } = await fetchLatestBaileysVersion();

  const conn: UserConnection = { socket: null as any, status: 'connecting' };
  connections.set(userId, conn);

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Fueld', 'Desktop', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  conn.socket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      conn.status = 'qr';
      // Convert raw QR string to data URL so frontend can render as <img>
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 256, margin: 2 });
        conn.qr = qrDataUrl;
        sendToUserSockets(userId, { type: 'whatsapp:qr', data: qrDataUrl });
      } catch {
        conn.qr = qr; // Fallback to raw string
        sendToUserSockets(userId, { type: 'whatsapp:qr', data: qr });
      }
    }

    if (connection === 'open') {
      conn.status = 'connected';
      conn.qr = undefined;

      // Extract phone number from socket user
      const jid = sock.user?.id;
      const phone = jid ? jid.split(':')[0].split('@')[0] : null;
      conn.phoneNumber = phone ?? undefined;

      // Persist connection info
      db.update(whatsappSessions)
        .set({
          syncedAt: new Date(),
          phoneNumber: phone,
          updatedAt: new Date(),
        })
        .where(eq(whatsappSessions.userId, userId))
        .then(() => {});

      sendToUserSockets(userId, { type: 'whatsapp:connected', data: { phoneNumber: phone } });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      conn.status = 'closed';
      connections.delete(userId);

      if (loggedOut) {
        // User logged out from phone — clean up DB
        cleanupSession(userId);
        sendToUserSockets(userId, { type: 'whatsapp:disconnected', data: { reason: 'logged_out' } });
      } else {
        // Temporary disconnect — try to reconnect after a short delay
        setTimeout(() => {
          startWhatsAppSession(userId).catch(() => {});
        }, 5000);
      }
    }
  });

  // Wait briefly for QR or connection
  await new Promise((r) => setTimeout(r, 2000));

  const current = connections.get(userId);
  return {
    status: current?.status ?? 'connecting',
    qr: current?.qr,
  };
}

export async function getWhatsAppStatus(userId: string): Promise<{
  linked: boolean;
  status: string;
  phoneNumber?: string | null;
  qr?: string;
}> {
  // Check in-memory connection first
  const conn = connections.get(userId);
  if (conn) {
    return {
      linked: conn.status === 'connected',
      status: conn.status,
      phoneNumber: conn.phoneNumber,
      qr: conn.qr,
    };
  }

  // Check DB for existing session
  const [session] = await db
    .select({
      phoneNumber: whatsappSessions.phoneNumber,
      syncedAt: whatsappSessions.syncedAt,
      creds: whatsappSessions.creds,
    })
    .from(whatsappSessions)
    .where(eq(whatsappSessions.userId, userId))
    .limit(1);

  if (session?.creds) {
    return {
      linked: true,
      status: 'stored',           // Has credentials but socket not open
      phoneNumber: session.phoneNumber,
    };
  }

  return { linked: false, status: 'none' };
}

export async function disconnectWhatsApp(userId: string): Promise<void> {
  const conn = connections.get(userId);
  if (conn?.socket) {
    try {
      await conn.socket.logout();
    } catch {
      // already disconnected
    }
    conn.socket.end(undefined);
  }
  connections.delete(userId);
  await cleanupSession(userId);
}

async function cleanupSession(userId: string): Promise<void> {
  await db.delete(whatsappKeys).where(eq(whatsappKeys.userId, userId));
  await db.delete(whatsappSessions).where(eq(whatsappSessions.userId, userId));
}

// ─── Send Message ────────────────────────────────────────────────────

export async function sendWhatsAppMessage(
  userId: string,
  recipientPhone: string,
  text: string,
  pdfBuffer?: Buffer,
  pdfFileName?: string,
): Promise<{ success: boolean; message: string }> {
  // Ensure connection is active
  let conn = connections.get(userId);
  if (!conn || conn.status !== 'connected') {
    // Try to reconnect from stored credentials
    const result = await startWhatsAppSession(userId);
    if (result.status !== 'connected') {
      // Wait a bit more for reconnection
      await new Promise((r) => setTimeout(r, 3000));
      conn = connections.get(userId);
      if (!conn || conn.status !== 'connected') {
        return { success: false, message: 'WhatsApp not connected. Please link your device first.' };
      }
    } else {
      conn = connections.get(userId);
    }
  }

  if (!conn?.socket) {
    return { success: false, message: 'WhatsApp session not available.' };
  }

  // Normalize phone number to WhatsApp JID
  const cleaned = recipientPhone.replace(/[^0-9]/g, '');
  const jid = `${cleaned}@s.whatsapp.net`;

  try {
    // Send text message
    await conn.socket.sendMessage(jid, { text });

    // Send PDF if provided
    if (pdfBuffer && pdfFileName) {
      await conn.socket.sendMessage(jid, {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: pdfFileName,
      });
    }

    return { success: true, message: `Message sent to +${cleaned}` };
  } catch (err: any) {
    return { success: false, message: err?.message ?? 'Failed to send WhatsApp message' };
  }
}

// ─── Reconnect stored sessions on server start ───────────────────────

export async function reconnectStoredSessions(): Promise<void> {
  try {
    const sessions = await db
      .select({ userId: whatsappSessions.userId })
      .from(whatsappSessions);

    for (const session of sessions) {
      // Reconnect in background, don't block startup
      startWhatsAppSession(session.userId).catch(() => {});
    }
  } catch {
    // DB might not have the table yet during initial migration
  }
}
