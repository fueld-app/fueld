// ═══════════════════════════════════════════════════════════════════════
//  RFQ Service — CRUD for incoming RFQs
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db';
import { incomingRfqs, users } from '../../db/schema';
import { sendToUserSockets } from '../activity/session-tracker';
import type { ParsedRFQ } from '../whatsapp/rfq-parser';

/**
 * Save a parsed RFQ to the database and notify the user via WebSocket.
 */
export async function saveIncomingRfq(
  userId: string,
  tenantId: string,
  parsed: ParsedRFQ,
  source: 'whatsapp' | 'manual' = 'whatsapp',
): Promise<string> {
  const [rfq] = await db
    .insert(incomingRfqs)
    .values({
      tenantId,
      userId,
      source,
      senderPhone: parsed.senderPhone,
      senderName: parsed.senderName,
      rawText: parsed.rawText,
      vesselName: parsed.vesselName,
      imo: parsed.imo,
      port: parsed.port,
      products: parsed.products,
      eta: parsed.eta ? new Date(parsed.eta) : null,
      confidence: parsed.confidence,
      status: 'PENDING',
    })
    .returning({ id: incomingRfqs.id });

  // Push in real-time to the user
  sendToUserSockets(userId, {
    type: 'rfq:new',
    data: {
      id: rfq.id,
      source,
      senderPhone: parsed.senderPhone,
      senderName: parsed.senderName,
      vesselName: parsed.vesselName,
      imo: parsed.imo,
      port: parsed.port,
      products: parsed.products,
      eta: parsed.eta,
      confidence: parsed.confidence,
      rawText: parsed.rawText,
    },
  });

  return rfq.id;
}

/**
 * List pending RFQs for a user.
 */
export async function listPendingRfqs(userId: string) {
  return db
    .select()
    .from(incomingRfqs)
    .where(
      and(
        eq(incomingRfqs.userId, userId),
        eq(incomingRfqs.status, 'PENDING'),
      ),
    )
    .orderBy(desc(incomingRfqs.createdAt));
}

/**
 * Get all RFQs for a user (any status)
 */
export async function listAllRfqs(userId: string) {
  return db
    .select()
    .from(incomingRfqs)
    .where(eq(incomingRfqs.userId, userId))
    .orderBy(desc(incomingRfqs.createdAt))
    .limit(100);
}

/**
 * Dismiss (delete) an RFQ.
 */
export async function dismissRfq(rfqId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(incomingRfqs)
    .where(
      and(
        eq(incomingRfqs.id, rfqId),
        eq(incomingRfqs.userId, userId),
      ),
    )
    .returning({ id: incomingRfqs.id });
  return result.length > 0;
}

/**
 * Mark an RFQ as accepted and link it to the created order.
 */
export async function acceptRfq(rfqId: string, userId: string, orderId: string): Promise<boolean> {
  const result = await db
    .update(incomingRfqs)
    .set({ status: 'ACCEPTED', orderId, updatedAt: new Date() })
    .where(
      and(
        eq(incomingRfqs.id, rfqId),
        eq(incomingRfqs.userId, userId),
      ),
    )
    .returning({ id: incomingRfqs.id });
  return result.length > 0;
}

/**
 * Get user's tenantId (needed to save RFQ).
 */
export async function getUserTenantId(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user?.tenantId ?? null;
}
