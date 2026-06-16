// ═══════════════════════════════════════════════════════════════════════
//  Order Attachments Service — document attachments for orders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { orderAttachments } from '../../db/schema';

export async function listOrderAttachments(orderId: string) {
  const rows = await db
    .select()
    .from(orderAttachments)
    .where(
      and(eq(orderAttachments.orderId, orderId), isNull(orderAttachments.deletedAt)),
    );

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    type: row.type,
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createOrderAttachment(input: {
  orderId: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy?: string | null;
}) {
  const [created] = await db
    .insert(orderAttachments)
    .values({
      orderId: input.orderId,
      type: input.type as any,
      fileName: input.fileName,
      filePath: input.filePath,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();

  return created ?? null;
}

export async function deleteOrderAttachment(
  attachmentId: string,
  orderId: string,
): Promise<void> {
  const result = await db
    .update(orderAttachments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(orderAttachments.id, attachmentId),
        eq(orderAttachments.orderId, orderId),
      ),
    )
    .returning({ id: orderAttachments.id });

  if (!result.length) throw new Error('Attachment not found');
}
