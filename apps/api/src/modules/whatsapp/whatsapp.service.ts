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
import { whatsappSessions, whatsappKeys, users, tenants, whatsappNotificationRules } from '../../db/schema';
import { sendToUserSockets } from '../activity/session-tracker';
import { parseRFQ } from './rfq-parser';
import { saveIncomingRfq, getUserTenantId } from '../rfq/rfq.service';
import { getWhatsAppSettings } from '../admin/settings.service';

// ─── In-memory connection pool ───────────────────────────────────────

interface UserConnection {
  socket: WASocket;
  status: 'connecting' | 'qr' | 'connected' | 'closed';
  qr?: string;          // Current QR string (for frontend to render)
  qrGeneratedAt?: number; // Timestamp (ms) when QR was last generated — used to detect stale QRs
  phoneNumber?: string;  // Once paired
}

const connections = new Map<string, UserConnection>();
const reconnectAttempts = new Map<string, number>();
const MAX_RECONNECT_ATTEMPTS = 5;
const QR_STALE_MS = 15_000; // QR codes expire after ~20s; treat as stale after 15s

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
  const waSettings = await getWhatsAppSettings();
  if (!waSettings.enabled) {
    return { status: 'disabled' };
  }

  // If already connected, return status
  const existing = connections.get(userId);
  if (existing) {
    if (existing.status === 'connected') {
      return { status: 'connected' };
    }
    if (existing.status === 'qr' && existing.qr) {
      // Check if the QR is stale (older than QR_STALE_MS).
      // WhatsApp QR codes expire after ~20s; a stale QR won't scan.
      // Tear down the old session and create a fresh one to get a new QR.
      const qrAge = Date.now() - (existing.qrGeneratedAt ?? 0);
      if (qrAge < QR_STALE_MS) {
        return { status: 'qr', qr: existing.qr };
      }
      // QR is stale — destroy old socket and fall through to create a new session
      try { existing.socket?.end(undefined); } catch {}
      connections.delete(userId);
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
      conn.qrGeneratedAt = Date.now();
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
        .then(() => {})
        .catch((err) => console.warn('[WhatsApp] Failed to persist connection info:', err));

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

/** Find a connected WhatsApp session belonging to an ADMIN user. */
async function findAdminConnection(): Promise<UserConnection | null> {
  const adminRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'ADMIN'));
  for (const row of adminRows) {
    const c = connections.get(row.id);
    if (c?.status === 'connected' && c.socket) return c;
  }
  return null;
}

/**
 * Send a WhatsApp message to a group by its JID.
 * Always uses the Admin's connected WhatsApp session.
 */
export async function sendWhatsAppGroupMessage(
  _userId: string | null | undefined,
  groupJid: string,
  text: string,
): Promise<{ success: boolean; message: string }> {
  // Always send group messages from the Admin's WhatsApp session
  const conn = await findAdminConnection();

  if (!conn?.socket) {
    return { success: false, message: 'Admin WhatsApp session is not connected. An admin must link their WhatsApp to send group messages.' };
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

// ─── Templated Group Message ────────────────────────────────────────

type TemplateContext = Record<string, string | number | undefined | Array<Record<string, string | number | undefined>>>;

/**
 * Interpolate template variables in a message template.
 * Variables: {{key}} → value from context object.
 * Sections:
 *   {{#key}}...{{/key}} — if key is an array, iterates (inner vars resolve against each element).
 *   {{#key}}...{{/key}} — if key is scalar, conditional: rendered only if truthy.
 */
function interpolateTemplate(template: string, context: TemplateContext): string {
  // First, handle sections: {{#key}}...{{/key}}
  let result = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
    const val = context[key];

    // Iteration: value is an array of objects
    if (Array.isArray(val)) {
      return val.map((item) => {
        // Resolve inner variables against the item, falling back to parent context
        return body.replace(/\{\{(\w+)\}\}/g, (__: string, innerKey: string) => {
          const innerVal = (item as Record<string, string | number | undefined>)[innerKey];
          if (innerVal !== undefined && innerVal !== null) return String(innerVal);
          // Fall back to parent context
          const parentVal = context[innerKey];
          if (parentVal !== undefined && parentVal !== null && !Array.isArray(parentVal)) return String(parentVal);
          return `{{${innerKey}}}`;
        });
      }).join('');
    }

    // Conditional: scalar value
    return val !== undefined && val !== null && val !== '' ? body : '';
  });

  // Then, replace simple variables: {{key}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = context[key];
    if (Array.isArray(val)) return `{{${key}}}`; // arrays only work inside sections
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`;
  });

  return result;
}

/**
 * Build product-specific template variables from order items.
 * Adds up to 10 products: {{product1}}, {{product1Qty}}, {{product1Unit}},
 * {{product2}}, {{product2Qty}}, {{product2Unit}}, etc. (1-indexed).
 * Also adds {{productCount}} with the total number of items.
 */
export function buildProductTemplateVariables(
  items: { productType: string; quantity: string | number; quantityMin?: string | number | null; unit: string; description?: string | null }[],
): Record<string, string | number | undefined | Array<Record<string, string | number | undefined>>> {
  const vars: Record<string, string | number | undefined | Array<Record<string, string | number | undefined>>> = {};
  vars['productCount'] = String(items.length);

  // Build an items array for {{#items}} iteration
  vars['items'] = items.slice(0, 20).map((item) => {
    const qty = parseFloat(String(item.quantity ?? ''));
    const qtyMin = item.quantityMin != null ? parseFloat(String(item.quantityMin)) : null;
    const qtyStr = qtyMin != null && qtyMin !== qty
      ? `${qtyMin} - ${qty}`
      : String(qty);

    return {
      productType: item.productType,
      quantity: qtyStr,
      unit: item.unit,
      description: item.description ?? '',
    };
  });

  // Also keep numbered variables for backward compatibility
  (vars['items'] as Array<Record<string, string | number | undefined>>).forEach((item, i) => {
    const n = i + 1;
    vars[`product${n}`] = item.productType as string;
    vars[`product${n}Qty`] = item.quantity as string;
    vars[`product${n}Unit`] = item.unit as string;
    if (item.description) vars[`product${n}Desc`] = item.description as string;
  });

  return vars;
}

/**
 * Send a templated WhatsApp group message based on a notification rule.
 * Looks up the rule for the tenant + event type, interpolates the template,
 * and sends to the configured group (or tenant default).
 */
export async function sendTemplatedGroupMessage(
  tenantId: string,
  eventType: string,
  context: TemplateContext,
  userId?: string,
): Promise<{ success: boolean; message: string }> {
  // 1. Find the rule
  const [rule] = await db
    .select()
    .from(whatsappNotificationRules)
    .where(
      and(
        eq(whatsappNotificationRules.tenantId, tenantId),
        eq(whatsappNotificationRules.eventType, eventType),
      ),
    )
    .limit(1);

  if (!rule) {
    return { success: false, message: `No notification rule found for event type: ${eventType}` };
  }

  if (!rule.enabled) {
    return { success: false, message: `Notification rule for ${eventType} is disabled` };
  }

  // 2. Determine target group JID
  let groupJid = rule.targetGroupJid;
  if (!groupJid) {
    // Fall back to tenant default
    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    groupJid = (tenant?.settings as any)?.whatsappDefaultGroupJid ?? null;
  }

  if (!groupJid) {
    return { success: false, message: `No target group JID configured for ${eventType}` };
  }

  // 3. Interpolate template
  //    Look up the triggering user's phone so {{phone}}/{{Phone}} is available
  let phone = (context['phone'] as string) || (context['Phone'] as string) || '';
  if (!phone && userId) {
    const [user] = await db
      .select({ phone: users.phone })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    phone = user?.phone ?? '';
  }
  const ctx = { ...context, phone, Phone: phone };
  const text = interpolateTemplate(rule.messageTemplate, ctx);

  // 4. Send
  return sendWhatsAppGroupMessage(null, groupJid, text);
}

export async function sendWhatsAppMessage(
  userId: string,
  recipientPhone: string,
  text: string,
  pdfBuffer?: Buffer,
  pdfFileName?: string,
): Promise<{ success: boolean; message: string }> {
  // Only send from the user's own session — no fallback to other users
  let conn = connections.get(userId);
  if (!conn || conn.status !== 'connected') {
    // Try to reconnect from stored credentials
    const result = await startWhatsAppSession(userId);
    if (result.status !== 'connected') {
      await new Promise((r) => setTimeout(r, 3000));
      conn = connections.get(userId);
      if (!conn || conn.status !== 'connected') {
        return { success: false, message: 'Your WhatsApp is not linked. Please go to Settings → WhatsApp to link your device.' };
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

  // Interpolate template variables (e.g. {{Phone}} → recipient phone number)
  // Support both {{Phone}} (as shown in admin UI) and {{phone}} (lowercase convention)
  const resolvedText = interpolateTemplate(text, { Phone: recipientPhone, phone: recipientPhone });

  try {
    // Send text message
    await conn.socket.sendMessage(jid, { text: resolvedText });

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
    const waSettings = await getWhatsAppSettings();
    if (!waSettings.enabled) return;

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
