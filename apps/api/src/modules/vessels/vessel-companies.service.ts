// ═══════════════════════════════════════════════════════════════════════
//  Vessel Companies Service — company associations for vessels
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { vesselCompanies, counterparties, companyContacts } from '../../db/schema';
import type { VesselCompanyRole } from '@fueld/types';

const vesselCompanySelectFields = {
  id: vesselCompanies.id,
  vesselId: vesselCompanies.vesselId,
  companyId: vesselCompanies.companyId,
  companyName: counterparties.name,
  companyCountryIso: counterparties.countryIso,
  role: vesselCompanies.role,
  source: vesselCompanies.source,
  contactId: vesselCompanies.contactId,
  contactName: companyContacts.name,
  note: vesselCompanies.note,
  addedById: vesselCompanies.addedById,
  addedByName: vesselCompanies.addedByName,
  createdAt: vesselCompanies.createdAt,
  updatedAt: vesselCompanies.updatedAt,
} as const;

// ═══════════════════════════════════════════════════════════════════════
//  GET COMPANIES FOR A VESSEL
// ═══════════════════════════════════════════════════════════════════════

export async function getVesselCompanies(vesselId: string) {
  return db
    .select(vesselCompanySelectFields)
    .from(vesselCompanies)
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.vesselId, vesselId))
    .orderBy(vesselCompanies.role, counterparties.name);
}

// ═══════════════════════════════════════════════════════════════════════
//  ADD COMPANY TO VESSEL
// ═══════════════════════════════════════════════════════════════════════

export async function addVesselCompany(
  vesselId: string,
  data: {
    companyId: string;
    role: VesselCompanyRole;
    contactId?: string | null;
    note?: string;
    source?: string;
    replaceExistingRole?: boolean;
  },
  userId: string,
  userName: string,
) {
  const [existing] = await db
    .select({ id: vesselCompanies.id })
    .from(vesselCompanies)
    .where(
      and(eq(vesselCompanies.vesselId, vesselId), eq(vesselCompanies.role, data.role)),
    )
    .limit(1);

  if (existing) {
    if (!data.replaceExistingRole) {
      throw new Error('Role already exists for this vessel');
    }

    const [updated] = await db
      .update(vesselCompanies)
      .set({
        companyId: data.companyId,
        contactId: data.contactId ?? null,
        note: data.note ?? null,
        addedById: userId,
        addedByName: userName,
        updatedAt: new Date(),
      })
      .where(eq(vesselCompanies.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error('Failed to replace vessel role');
    }

    const [fullUpdated] = await db
      .select(vesselCompanySelectFields)
      .from(vesselCompanies)
      .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
      .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
      .where(eq(vesselCompanies.id, existing.id));

    return fullUpdated;
  }

  const [created] = await db
    .insert(vesselCompanies)
    .values({
      vesselId,
      companyId: data.companyId,
      role: data.role,
      source: data.source ?? 'manual',
      contactId: data.contactId ?? null,
      note: data.note ?? null,
      addedById: userId,
      addedByName: userName,
    })
    .returning();

  const [full] = await db
    .select(vesselCompanySelectFields)
    .from(vesselCompanies)
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.id, created.id));
  return full;
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE VESSEL COMPANY
// ═══════════════════════════════════════════════════════════════════════

export async function updateVesselCompany(
  id: string,
  data: { role?: VesselCompanyRole; contactId?: string | null; note?: string },
) {
  if (data.role) {
    const [current] = await db
      .select({
        vesselId: vesselCompanies.vesselId,
        companyId: vesselCompanies.companyId,
      })
      .from(vesselCompanies)
      .where(eq(vesselCompanies.id, id))
      .limit(1);

    if (current) {
      const [dup] = await db
        .select({ id: vesselCompanies.id })
        .from(vesselCompanies)
        .where(
          and(
            eq(vesselCompanies.vesselId, current.vesselId),
            eq(vesselCompanies.role, data.role),
            sql`${vesselCompanies.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (dup) {
        throw new Error('Role already exists for this vessel');
      }
    }
  }

  const [updated] = await db
    .update(vesselCompanies)
    .set({
      ...(data.role !== undefined && { role: data.role }),
      ...(data.contactId !== undefined && { contactId: data.contactId }),
      ...(data.note !== undefined && { note: data.note }),
      updatedAt: new Date(),
    })
    .where(eq(vesselCompanies.id, id))
    .returning();

  if (!updated) return null;

  const [full] = await db
    .select(vesselCompanySelectFields)
    .from(vesselCompanies)
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .leftJoin(companyContacts, eq(vesselCompanies.contactId, companyContacts.id))
    .where(eq(vesselCompanies.id, updated.id));
  return full ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE VESSEL COMPANY
// ═══════════════════════════════════════════════════════════════════════

export async function deleteVesselCompany(id: string) {
  const [info] = await db
    .select({
      id: vesselCompanies.id,
      companyName: counterparties.name,
      role: vesselCompanies.role,
    })
    .from(vesselCompanies)
    .innerJoin(counterparties, eq(vesselCompanies.companyId, counterparties.id))
    .where(eq(vesselCompanies.id, id));

  if (!info) return null;

  await db.delete(vesselCompanies).where(eq(vesselCompanies.id, id));
  return { id: info.id, companyName: info.companyName, role: info.role };
}
