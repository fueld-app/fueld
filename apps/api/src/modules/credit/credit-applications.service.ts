// ═══════════════════════════════════════════════════════════════════════
//  Credit Applications Service — Trader → Credit Manager approval workflow
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, desc, asc, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  creditApplications,
  creditApplicationReviews,
  creditLines,
  creditLineCounterparties,
  creditLineCompanies,
  counterparties,
  orders,
  users,
  tenants,
} from '../../db/schema';
import type {
  CreditApplicationDto,
  CreditApplicationReviewDto,
  CreditLineType,
} from '@fueld/types';
import { CreditApplicationStatus, CreditApplicationReviewDecision } from '@fueld/types';
import type { TenantSettings } from '../../db/schema';

// ═══════════════════════════════════════════════════════════════════════
//  SETTINGS HELPERS
// ═══════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  requiredApprovals: 1,
  autoApplyOnApproval: true,
  immediateRejection: true,
  notifyCreditManagers: true,
};

async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

export async function getCreditApplicationSettings() {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  const settings = (tenant.settings as TenantSettings) ?? {};
  return { ...DEFAULT_SETTINGS, ...settings.creditApplicationSettings };
}

export async function updateCreditApplicationSettings(
  updates: Partial<typeof DEFAULT_SETTINGS>,
) {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  const settings = (tenant.settings as TenantSettings) ?? {};
  const current = { ...DEFAULT_SETTINGS, ...settings.creditApplicationSettings };
  const merged = { ...current, ...updates };

  await db
    .update(tenants)
    .set({
      settings: { ...settings, creditApplicationSettings: merged },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenant.id));

  return merged;
}

// ═══════════════════════════════════════════════════════════════════════
//  ENRICH APPLICATION (join counterparty name, user name, reviews)
// ═══════════════════════════════════════════════════════════════════════

async function enrichApplication(row: typeof creditApplications.$inferSelect): Promise<CreditApplicationDto> {
  const [cpRow, userRow, orderRow, reviewRows] = await Promise.all([
    db
      .select({ name: counterparties.name })
      .from(counterparties)
      .where(eq(counterparties.id, row.counterpartyId))
      .limit(1),
    db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.requestedByUserId))
      .limit(1),
    row.orderId
      ? db
          .select({ orderNumber: orders.orderNumber })
          .from(orders)
          .where(eq(orders.id, row.orderId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: creditApplicationReviews.id,
        applicationId: creditApplicationReviews.applicationId,
        reviewerUserId: creditApplicationReviews.reviewerUserId,
        decision: creditApplicationReviews.decision,
        comment: creditApplicationReviews.comment,
        decidedAt: creditApplicationReviews.decidedAt,
        reviewerName: users.name,
      })
      .from(creditApplicationReviews)
      .innerJoin(users, eq(creditApplicationReviews.reviewerUserId, users.id))
      .where(eq(creditApplicationReviews.applicationId, row.id))
      .orderBy(desc(creditApplicationReviews.decidedAt)),
  ]);

  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type as CreditLineType,
    counterpartyId: row.counterpartyId,
    counterpartyName: cpRow[0]?.name ?? 'Unknown',
    orderId: row.orderId,
    orderReference: orderRow[0]?.orderNumber ?? null,
    creditLineId: row.creditLineId,
    requestedAmount: row.requestedAmount,
    requestedCurrency: row.requestedCurrency,
    requestedDays: row.requestedDays,
    reason: row.reason,
    status: row.status as CreditApplicationStatus,
    requestedByUserId: row.requestedByUserId,
    requestedByName: userRow[0]?.name ?? 'Unknown',
    reviews: reviewRows.map((r) => ({
      id: r.id,
      applicationId: r.applicationId,
      reviewerUserId: r.reviewerUserId,
      reviewerName: r.reviewerName,
      decision: r.decision as CreditApplicationReviewDecision,
      comment: r.comment,
      decidedAt: r.decidedAt.toISOString(),
    })),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST CREDIT APPLICATIONS (paginated, filterable)
// ═══════════════════════════════════════════════════════════════════════

export async function listCreditApplications(query?: {
  status?: CreditApplicationStatus;
  type?: CreditLineType;
  counterpartyId?: string;
  page?: number;
  limit?: number;
}) {
  const page = query?.page ?? 1;
  const limit = Math.min(query?.limit ?? 25, 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (query?.status) {
    conditions.push(eq(creditApplications.status, query.status));
  }
  if (query?.type) {
    conditions.push(eq(creditApplications.type, query.type));
  }
  if (query?.counterpartyId) {
    conditions.push(eq(creditApplications.counterpartyId, query.counterpartyId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countResult] = await Promise.all([
    db
      .select()
      .from(creditApplications)
      .where(where)
      .orderBy(desc(creditApplications.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(creditApplications)
      .where(where),
  ]);

  const items = await Promise.all(rows.map(enrichApplication));

  return { items, total: countResult[0]?.count ?? 0, page, pageSize: limit };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE APPLICATION
// ═══════════════════════════════════════════════════════════════════════

export async function getCreditApplicationById(id: string): Promise<CreditApplicationDto | null> {
  const [row] = await db
    .select()
    .from(creditApplications)
    .where(eq(creditApplications.id, id))
    .limit(1);

  if (!row) return null;
  return enrichApplication(row);
}

// ═══════════════════════════════════════════════════════════════════════
//  COUNT PENDING APPLICATIONS (for badge)
// ═══════════════════════════════════════════════════════════════════════

export async function countPendingApplications(): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(creditApplications)
    .where(eq(creditApplications.status, 'PENDING'));
  return result?.count ?? 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE APPLICATION (trader submits)
// ═══════════════════════════════════════════════════════════════════════

export async function createCreditApplication(
  data: {
    type: CreditLineType;
    counterpartyId: string;
    orderId?: string;
    creditLineId?: string;
    requestedAmount: string;
    requestedCurrency: string;
    requestedDays?: number;
    reason?: string;
  },
  requestedByUserId: string,
) {
  const tenantId = await getTenantId();

  const [created] = await db
    .insert(creditApplications)
    .values({
      tenantId,
      type: data.type,
      counterpartyId: data.counterpartyId,
      orderId: data.orderId ?? null,
      creditLineId: data.creditLineId ?? null,
      requestedAmount: data.requestedAmount,
      requestedCurrency: data.requestedCurrency,
      requestedDays: data.requestedDays ?? null,
      reason: data.reason ?? null,
      status: 'PENDING',
      requestedByUserId,
    })
    .returning();

  return enrichApplication(created);
}

// ═══════════════════════════════════════════════════════════════════════
//  CANCEL APPLICATION (requester or admin cancels)
// ═══════════════════════════════════════════════════════════════════════

export async function cancelCreditApplication(id: string, userId: string): Promise<CreditApplicationDto | null> {
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(eq(creditApplications.id, id))
    .limit(1);

  if (!app || app.status !== 'PENDING') return null;

  // Only the requester or admins/credit managers can cancel
  const [updated] = await db
    .update(creditApplications)
    .set({ status: 'CANCELLED', resolvedAt: new Date(), updatedAt: new Date() })
    .where(eq(creditApplications.id, id))
    .returning();

  if (!updated) return null;
  return enrichApplication(updated);
}

// ═══════════════════════════════════════════════════════════════════════
//  SUBMIT REVIEW (credit manager approves/rejects)
// ═══════════════════════════════════════════════════════════════════════

export async function submitReview(
  applicationId: string,
  reviewerUserId: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string,
): Promise<CreditApplicationDto | null> {
  // Fetch current application
  const [app] = await db
    .select()
    .from(creditApplications)
    .where(eq(creditApplications.id, applicationId))
    .limit(1);

  if (!app || app.status !== 'PENDING') return null;

  // Check if this reviewer already reviewed
  const existingReview = await db
    .select({ id: creditApplicationReviews.id })
    .from(creditApplicationReviews)
    .where(
      and(
        eq(creditApplicationReviews.applicationId, applicationId),
        eq(creditApplicationReviews.reviewerUserId, reviewerUserId),
      ),
    )
    .limit(1);

  if (existingReview.length > 0) {
    throw new Error('You have already reviewed this application');
  }

  // Insert review
  await db.insert(creditApplicationReviews).values({
    applicationId,
    reviewerUserId,
    decision,
    comment: comment ?? null,
  });

  // Load settings
  const settings = await getCreditApplicationSettings();

  // Fetch all reviews for this application (including the one we just inserted)
  const allReviews = await db
    .select()
    .from(creditApplicationReviews)
    .where(eq(creditApplicationReviews.applicationId, applicationId));

  const approvals = allReviews.filter((r) => r.decision === 'APPROVED').length;
  const rejections = allReviews.filter((r) => r.decision === 'REJECTED').length;

  let newStatus: CreditApplicationStatus | null = null;

  // Check if we have enough approvals
  if (approvals >= settings.requiredApprovals) {
    newStatus = CreditApplicationStatus.Approved;
  }
  // Check immediate rejection
  else if (settings.immediateRejection && rejections > 0) {
    newStatus = CreditApplicationStatus.Rejected;
  }
  // Check majority rejection (when not using immediate rejection)
  else if (!settings.immediateRejection && rejections >= settings.requiredApprovals) {
    newStatus = CreditApplicationStatus.Rejected;
  }

  // Update application status if resolved
  if (newStatus) {
    await db
      .update(creditApplications)
      .set({ status: newStatus, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(creditApplications.id, applicationId));

    // Auto-apply credit line if approved and setting is enabled
    if (newStatus === CreditApplicationStatus.Approved && settings.autoApplyOnApproval) {
      await autoApplyCreditLine(app);
    }
  } else {
    // Just update the timestamp
    await db
      .update(creditApplications)
      .set({ updatedAt: new Date() })
      .where(eq(creditApplications.id, applicationId));
  }

  return getCreditApplicationById(applicationId);
}

// ═══════════════════════════════════════════════════════════════════════
//  AUTO-APPLY CREDIT LINE (create or increase on approval)
// ═══════════════════════════════════════════════════════════════════════

async function autoApplyCreditLine(app: typeof creditApplications.$inferSelect) {
  if (app.creditLineId) {
    // Increase existing credit line
    await db
      .update(creditLines)
      .set({
        creditAmount: app.requestedAmount,
        currency: app.requestedCurrency,
        ...(app.requestedDays ? { periodDays: app.requestedDays } : {}),
        updatedAt: new Date(),
      })
      .where(eq(creditLines.id, app.creditLineId));
  } else {
    // Create new credit line
    const [created] = await db
      .insert(creditLines)
      .values({
        tenantId: app.tenantId,
        type: app.type,
        creditAmount: app.requestedAmount,
        currency: app.requestedCurrency,
        periodDays: app.requestedDays ?? 30,
      })
      .returning();

    // Link the counterparty
    await db.insert(creditLineCounterparties).values({
      creditLineId: created.id,
      counterpartyId: app.counterpartyId,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  GET CREDIT MANAGERS (for notification targeting)
// ═══════════════════════════════════════════════════════════════════════

export async function getCreditManagerUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isActive, true),
        inArray(users.role, ['CREDITMANAGER', 'ADMIN']),
      ),
    );
  return rows.map((r) => r.id);
}
