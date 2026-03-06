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
  type WAMessage,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';

// Minimal logger that only emits warn+ to silence Baileys' verbose info logs
const baileysLogger = {
  level: 'warn',
  fatal: (...args: any[]) => console.error('[baileys:fatal]', ...args),
  error: () => {},  // Suppress — we handle errors in connection.update
  warn: () => {},   // Suppress routine warnings (pre-keys, old counters)
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => baileysLogger,
} as any;
import { eq, and } from 'drizzle-orm';
import { db } from '../../db';
import { whatsappSessions, whatsappKeys } from '../../db/schema';
import { sendToUserSockets } from '../activity/session-tracker';
import { parseRFQ } from './rfq-parser';
import { saveIncomingRfq, getUserTenantId } from '../rfq/rfq.service';
import { getWhatsAppSettings } from '../admin/settings.service';

// ─── In-memory connection pool ───────────────────────────────────────

interface UserConnection {
  socket: WASocket;
  status: 'connecting' | 'qr' | 'connected' | 'closed';
  qr?: string;          // Current QR string (for frontend to render)
  phoneNumber?: string;  // Once paired
}

const connections = new Map<string, UserConnection>();
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_ATTEMPTS = 5;

// ─── Buffer Revival (JSONB round-trip loses Buffer types) ────────────

/**
 * When Buffer/Uint8Array values are stored in JSONB (PostgreSQL), they get
 * serialized as `{ type: "Buffer", data: [72, 101, …] }`.  On retrieval the
 * plain object is returned instead of an actual Buffer, which causes Baileys'
 * crypto helpers (aesEncryptGCM etc.) to throw:
 *   "The data argument must be of type string or an instance of Buffer …"
 *
 * This utility recursively converts those serialized representations back into
 * real Buffer instances.
 */
function reviveBuffers(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(reviveBuffers);
  const rec = obj as Record<string, unknown>;
  if (rec.type === 'Buffer' && Array.isArray(rec.data)) {
    return Buffer.from(rec.data as number[]);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = reviveBuffers(v);
  }
  return out;
}

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
    creds = reviveBuffers(existing.creds) as AuthenticationCreds;
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
              result[row.keyId] = reviveBuffers(row.keyData);
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
    logger: baileysLogger,
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
        sendToUserSockets(userId, { type: 'whatsapp:qr', data: qrDataUrl }, 'whatsapp');
      } catch {
        conn.qr = qr; // Fallback to raw string
        sendToUserSockets(userId, { type: 'whatsapp:qr', data: qr }, 'whatsapp');
      }
    }

    if (connection === 'open') {
      conn.status = 'connected';
      conn.qr = undefined;
      reconnectAttempts.delete(userId);

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

      sendToUserSockets(userId, { type: 'whatsapp:connected', data: { phoneNumber: phone } }, 'whatsapp');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      conn.status = 'closed';
      connections.delete(userId);

      if (loggedOut) {
        // User logged out from phone — clean up DB
        reconnectAttempts.delete(userId);
        cleanupSession(userId);
        sendToUserSockets(userId, { type: 'whatsapp:disconnected', data: { reason: 'logged_out' } }, 'whatsapp');
      } else {
        // Temporary disconnect — reconnect with exponential backoff
        const attempts = reconnectAttempts.get(userId) ?? 0;
        if (attempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(5000 * Math.pow(2, attempts), 60000);
          reconnectAttempts.set(userId, attempts + 1);
          console.log(`[whatsapp] Reconnecting ${userId} in ${delay / 1000}s (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(() => {
            startWhatsAppSession(userId).catch(() => {});
          }, delay);
        } else {
          console.warn(`[whatsapp] Giving up reconnecting ${userId} after ${MAX_RECONNECT_ATTEMPTS} attempts`);
          reconnectAttempts.delete(userId);
          sendToUserSockets(userId, { type: 'whatsapp:disconnected', data: { reason: 'max_retries' } }, 'whatsapp');
        }
      }
    }
  });

  // ─── Incoming message listener (RFQ parsing) ────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return; // Ignore history sync etc.

    const waSettings = await getWhatsAppSettings();
    if (!waSettings.enabled || !waSettings.incomingRfqEnabled) return;

    for (const msg of messages) {
      try {
        // Only process DMs (not group messages)
        const jid = msg.key.remoteJid;
        if (!jid || !jid.endsWith('@s.whatsapp.net')) continue;

        // Skip own outgoing messages
        if (msg.key.fromMe) continue;

        // Extract text content
        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          null;
        if (!text) continue;

        // Extract sender info
        const senderPhone = jid.split('@')[0];
        const senderName = msg.pushName ?? null;

        // Attempt to parse as RFQ
        const parsed = parseRFQ(text, senderPhone, senderName);
        if (!parsed) continue; // Not an RFQ

        // Get user's tenant for saving
        const tenantId = await getUserTenantId(userId);
        if (!tenantId) continue;

        await saveIncomingRfq(userId, tenantId, parsed, 'whatsapp');
        console.log(`[WhatsApp] Parsed RFQ from +${senderPhone} for user ${userId} (confidence: ${parsed.confidence.toFixed(2)})`);
      } catch (err: any) {
        console.warn('[WhatsApp] Error processing incoming message:', err.message);
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
  whatsappEnabled: boolean;
}> {
  const waSettings = await getWhatsAppSettings();
  const enabled = waSettings.enabled;

  // Check in-memory connection first
  const conn = connections.get(userId);

  const [session] = await db
    .select({
      phoneNumber: whatsappSessions.phoneNumber,
      syncedAt: whatsappSessions.syncedAt,
      creds: whatsappSessions.creds,
    })
    .from(whatsappSessions)
    .where(eq(whatsappSessions.userId, userId))
    .limit(1);

  if (conn) {
    return {
      linked: conn.status === 'connected',
      status: conn.status,
      phoneNumber: conn.phoneNumber,
      qr: conn.qr,
      whatsappEnabled: enabled,
    };
  }

  if (session?.creds) {
    return {
      linked: true,
      status: 'stored',
      phoneNumber: session.phoneNumber,
      whatsappEnabled: enabled,
    };
  }

  return { linked: false, status: 'none', whatsappEnabled: enabled };
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

// ─── Groups ──────────────────────────────────────────────────────────

export interface WhatsAppGroup {
  jid: string;
  name: string;
  participants: number;
}

export async function listWhatsAppGroups(userId: string): Promise<WhatsAppGroup[]> {
  const conn = connections.get(userId);
  if (!conn?.socket || conn.status !== 'connected') {
    return [];
  }

  try {
    const groups = await conn.socket.groupFetchAllParticipating();
    return Object.values(groups).map((g: any) => ({
      jid: g.id,
      name: g.subject ?? g.id,
      participants: g.participants?.length ?? 0,
    }));
  } catch (err: any) {
    console.warn('[WhatsApp] Failed to fetch groups:', err.message);
    return [];
  }
}

// ─── Send Message ────────────────────────────────────────────────────

/**
 * Send a WhatsApp message to a group by its JID.
 * Uses the specified user's connected session.
 * If the user doesn't have a session, tries any connected session.
 */
export async function sendWhatsAppGroupMessage(
  userId: string,
  groupJid: string,
  text: string,
): Promise<{ success: boolean; message: string }> {
  // Find a connected session — prefer the specified user, then fall back to any
  let conn = connections.get(userId);
  if (!conn || conn.status !== 'connected') {
    // Try to reconnect the specified user first
    try {
      const result = await startWhatsAppSession(userId);
      if (result.status === 'connected') {
        conn = connections.get(userId);
      }
    } catch {}

    // Fall back to any connected session
    if (!conn || conn.status !== 'connected') {
      for (const [, c] of connections) {
        if (c.status === 'connected' && c.socket) {
          conn = c;
          break;
        }
      }
    }
  }

  if (!conn?.socket) {
    return { success: false, message: 'No WhatsApp session connected. Cannot send group message.' };
  }

  // Ensure the JID ends with @g.us (bail if it's invalid)
  if (!groupJid.endsWith('@g.us')) {
    return { success: false, message: `Invalid group JID: ${groupJid}` };
  }

  try {
    await conn.socket.sendMessage(groupJid, { text });
    return { success: true, message: `Group message sent to ${groupJid}` };
  } catch (err: any) {
    console.error(`[WhatsApp] Failed to send group message to ${groupJid}:`, err.message);
    return { success: false, message: err?.message ?? 'Failed to send group message' };
  }
}

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
