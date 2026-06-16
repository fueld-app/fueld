// ═══════════════════════════════════════════════════════════════════════
//  Company Attachments Service
// ═══════════════════════════════════════════════════════════════════════

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { companyAttachments } from '../../db/schema';

export async function getCompanyAttachments(counterpartyId: string) {
  return db.select().from(companyAttachments)
    .where(and(eq(companyAttachments.counterpartyId, counterpartyId), isNull(companyAttachments.deletedAt)))
    .orderBy(companyAttachments.createdAt);
}

export async function createCompanyAttachment(input: {
  counterpartyId: string; type: string; fileName: string; filePath: string; mimeType: string; fileSize: number; uploadedBy?: string | null;
}) {
  const [created] = await db.insert(companyAttachments).values({
    counterpartyId: input.counterpartyId, type: input.type as any, fileName: input.fileName,
    filePath: input.filePath, mimeType: input.mimeType, fileSize: input.fileSize,
    uploadedBy: input.uploadedBy ?? null,
  }).returning();
  return created ?? null;
}

export async function deleteCompanyAttachment(id: string) {
  const [deleted] = await db.update(companyAttachments).set({ deletedAt: new Date() }).where(eq(companyAttachments.id, id)).returning({ id: companyAttachments.id });
  return deleted ?? null;
}

