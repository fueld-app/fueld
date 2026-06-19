// ═══════════════════════════════════════════════════════════════════════
//  Company Attachments Service
// ═══════════════════════════════════════════════════════════════════════

import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { companyAttachments } from '../../db/schema';

export async function getCompanyAttachments(counterpartyId: string) {
  return db.select().from(companyAttachments)
    .where(eq(companyAttachments.counterpartyId, counterpartyId))
    .orderBy(companyAttachments.createdAt);
}

export async function createCompanyAttachment(input: {
  counterpartyId: string; type: string; fileName: string; filePath: string; mimeType: string; fileSize: number; uploadedBy?: string | null;
}) {
  const [created] = await db.insert(companyAttachments as any).values({
    counterpartyId: input.counterpartyId, type: input.type as any, fileName: input.fileName,
    filePath: input.filePath, mimeType: input.mimeType, fileSize: input.fileSize,
    uploadedBy: input.uploadedBy ?? null,
  }).returning();
  return created ?? null;
}

export async function deleteCompanyAttachment(id: string) {
  const [deleted] = await db.delete(companyAttachments).where(eq(companyAttachments.id, id)).returning({ id: companyAttachments.id });
  return deleted ?? null;
}

