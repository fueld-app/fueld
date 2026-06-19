// ═══════════════════════════════════════════════════════════════════════
//  Company Contacts Service — contacts, emails, offices
// ═══════════════════════════════════════════════════════════════════════

import { eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import { companyContacts, companyEmails, companyOffices } from '../../db/schema';
import type { CompanyEmailType } from '@fueld/types';
import { buildSeasearcherContactFingerprint } from './company.types';

// ─── Contacts ─────────────────────────────────────────────────────

export async function getCompanyContacts(counterpartyId: string) {
  return db.select().from(companyContacts).where(eq(companyContacts.counterpartyId, counterpartyId)).orderBy(companyContacts.name);
}

export async function createCompanyContact(counterpartyId: string, data: {
  name: string; role?: string; phone?: string; fax?: string; email?: string; notes?: string;
}) {
  const [created] = await db.insert(companyContacts).values({
    counterpartyId, name: data.name, role: data.role ?? null, phone: data.phone ?? null,
    fax: data.fax ?? null, email: data.email ?? null, notes: data.notes ?? null,
  }).returning();
  return created;
}

export async function updateCompanyContact(id: string, data: {
  name?: string; role?: string; phone?: string; fax?: string; email?: string; notes?: string;
}) {
  const [updated] = await db.update(companyContacts).set({ ...data, updatedAt: new Date() }).where(eq(companyContacts.id, id)).returning();
  return updated ?? null;
}

export async function deleteCompanyContact(contactId: string) {
  const [deleted] = await db.delete(companyContacts).where(eq(companyContacts.id, contactId)).returning({ id: companyContacts.id });
  return deleted ?? null;
}

export async function syncContactsFromSeasearcher(
  counterpartyId: string,
  seasearcherId: string,
) {
  const { seasearcherCompanyDetail } = await import('../lloyds/lli.client');
  const detail = await seasearcherCompanyDetail<any>(seasearcherId);
  if (!detail?.headOffice?.personnel?.length && !detail?.offices?.length) return [];

  const existing = await getCompanyContacts(counterpartyId);
  const existingFingerprints = new Set(existing.map(buildSeasearcherContactFingerprint));
  const created: any[] = [];

  const allPersonnel = [
    ...(detail.headOffice?.personnel ?? []),
    ...detail.offices.flatMap((o: any) => o.personnel ?? []),
  ];

  for (const person of allPersonnel) {
    const fp = buildSeasearcherContactFingerprint({ name: person.name, role: person.jobTitle, email: null });
    if (existingFingerprints.has(fp)) continue;
    const c = await createCompanyContact(counterpartyId, { name: person.name, role: person.jobTitle ?? null });
    created.push(c);
    existingFingerprints.add(fp);
  }

  return created;
}

// ─── Emails ───────────────────────────────────────────────────────

export async function getCompanyEmails(counterpartyId: string) {
  return db.select().from(companyEmails).where(eq(companyEmails.counterpartyId, counterpartyId)).orderBy(companyEmails.email);
}

export async function addCompanyEmail(counterpartyId: string, data: {
  emailType: CompanyEmailType; email: string; label?: string | null; isPrimary?: boolean;
}) {
  if (data.isPrimary) {
    await db.update(companyEmails).set({ isPrimary: false }).where(eq(companyEmails.counterpartyId, counterpartyId));
  }
  const [created] = await db.insert(companyEmails).values({
    counterpartyId, emailType: data.emailType, email: data.email, label: data.label ?? null, isPrimary: data.isPrimary ?? false,
  }).returning();
  return created;
}

export async function updateCompanyEmail(id: string, data: {
  emailType?: CompanyEmailType; email?: string; label?: string | null; isPrimary?: boolean;
}) {
  const [current] = await db.select({ counterpartyId: companyEmails.counterpartyId }).from(companyEmails).where(eq(companyEmails.id, id)).limit(1);
  if (data.isPrimary && current) {
    await db.update(companyEmails).set({ isPrimary: false }).where(eq(companyEmails.counterpartyId, current.counterpartyId));
  }
  const [updated] = await db.update(companyEmails).set({ ...data, updatedAt: new Date() }).where(eq(companyEmails.id, id)).returning();
  return updated ?? null;
}

export async function deleteCompanyEmail(id: string) {
  const [deleted] = await db.delete(companyEmails).where(eq(companyEmails.id, id)).returning({ id: companyEmails.id });
  return deleted ?? null;
}

// ─── Offices ──────────────────────────────────────────────────────

export async function getCompanyOffices(counterpartyId: string) {
  return db.select().from(companyOffices).where(eq(companyOffices.counterpartyId, counterpartyId)).orderBy(companyOffices.city);
}

export async function addCompanyOffice(counterpartyId: string, data: {
  city: string; country?: string | null; address?: string | null; phone?: string | null; email?: string | null;
}) {
  const [created] = await db.insert(companyOffices).values({
    counterpartyId, city: data.city, country: data.country ?? null,
    address: data.address ?? null, phone: data.phone ?? null, email: data.email ?? null,
  }).returning();
  return created;
}

export async function updateCompanyOffice(id: string, data: {
  city?: string; country?: string; address?: string; phone?: string; email?: string;
}) {
  const [updated] = await db.update(companyOffices).set({ ...data, updatedAt: new Date() }).where(eq(companyOffices.id, id)).returning();
  return updated ?? null;
}

export async function deleteCompanyOffice(id: string) {
  const [deleted] = await db.delete(companyOffices).where(eq(companyOffices.id, id)).returning({ id: companyOffices.id });
  return deleted ?? null;
}

export async function syncOfficesFromSeasearcher(counterpartyId: string, seasearcherId: string) {
  const { seasearcherCompanyDetail } = await import('../lloyds/lli.client');
  const detail = await seasearcherCompanyDetail<any>(seasearcherId);
  if (!detail?.offices?.length) return [];

  const existing = await getCompanyOffices(counterpartyId);
  const existingTowns = new Set(existing.map((o) => [o.city, o.country].filter(Boolean).join('|').toLowerCase()));
  const created: any[] = [];

  const allOffices = detail.headOffice ? [detail.headOffice, ...detail.offices] : detail.offices;
  for (const office of allOffices) {
    const town = office.town ?? '';
    const country = office.country ?? '';
    const key = [town, country].filter(Boolean).join('|').toLowerCase();
    if (!town || existingTowns.has(key)) continue;
    const phone = office.telephoneNumbers?.[0] ? `+${office.telephoneNumbers[0].countryDialingCode} ${office.telephoneNumbers[0].number}`.trim() : null;
    const email = office.emailAddress ?? null;
    const c = await addCompanyOffice(counterpartyId, { city: town, country, phone, email });
    created.push(c);
    existingTowns.add(key);
  }

  return created;
}
