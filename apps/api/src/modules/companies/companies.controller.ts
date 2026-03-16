// ═══════════════════════════════════════════════════════════════════════
//  Companies Controller
//
//  GET  /companies/local?search=...&type=...&country=...&page=...&limit=...
//  GET  /companies/local/:id
//  GET  /companies/local/:id/orders
//  GET  /companies/search?term=...
//  GET  /companies/enrichment/:seasearcherId
//  POST /companies/local
//  POST /companies/import  { seasearcherId }
//  POST /companies/local/:id/sync
//  DELETE /companies/local/:id
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import { authGuard } from '../auth/auth.guard';
import {
  listCompanies,
  getCompanyById,
  getCompanyBySeasearcherId,
  createCompany,
  updateCompany,
  updateCompanyResponsibleUser,
  updateCompanyTypes,
  importCompanyFromSeasearcher,
  importCompanyByName,
  syncCompanyFromSeasearcher,
  acceptSeasearcherValue,
  keepMineValue,
  deleteCompany,
  searchCompaniesTypeahead,
  getCompanyEnrichment,
  getCompanyFleet,
  getCompanyHierarchy,
  getCompanySeizures,
  getCompanySanctions,
  getOrdersForCompany,
  getVesselsForCompany,
  getCompanyContacts,
  createCompanyContact,
  updateCompanyContact,
  deleteCompanyContact,
  getCompanyEmails,
  addCompanyEmail,
  updateCompanyEmail,
  deleteCompanyEmail,
  getCompanyOffices,
  addCompanyOffice,
  updateCompanyOffice,
  deleteCompanyOffice,
  getChildCompanies,
  getParentCompany,
  setParentCompany,
  removeParentCompany,
  getCompanyGroupAggregate,
  getGroupOrdersForCompany,
  getGroupVesselsForCompany,
  getTopCreditGroups,
  updateCompanySegments,
} from './company.service';
import { getSupplyPortsForCompany } from '../lloyds/lli.service';
import { getUserCompanyAccess } from '../admin/settings.service';
import type { ApiResponse, CompanyEmailType } from '@fueld/types';

export const companiesController = new Elysia({ prefix: '/companies' })
  .use(authGuard)

  // ─── Own Companies (accessible to current user) ────────────────────
  .get(
    '/own',
    async ({ auth }) => {
      try {
        const data = await getUserCompanyAccess(auth.sub);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        return { success: false, data: [], message: 'Failed to fetch own companies' };
      }
    },
    {
      detail: {
        tags: ['Companies'],
        summary: 'Get own companies accessible to the current user',
      },
    },
  )

  // ─── List Companies (local, paginated) ─────────────────────────────
  .get(
    '/local',
    async ({ query }) => {
      const results = await listCompanies({
        search: query.search,
        type: query.type,
        country: query.country,
        responsibleUserId: query.responsibleUserId,
        segment: query.segment,
        sortBy: query.sortBy,
        sortDir: query.sortDir as 'asc' | 'desc' | undefined,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        type: t.Optional(t.String()),
        country: t.Optional(t.String()),
        responsibleUserId: t.Optional(t.String()),
        segment: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'List companies from local database',
      },
    },
  )

  // ─── Get Single Company ────────────────────────────────────────────
  .get(
    '/local/:id',
    async ({ params }) => {
      const company = await getCompanyById(params.id);
      if (!company) {
        return { success: false, data: null, message: 'Company not found' };
      }
      return { success: true, data: company } satisfies ApiResponse<typeof company>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get a single company by local ID',
      },
    },
  )

  // ─── Orders for a Company ─────────────────────────────────────────
  .get(
    '/local/:id/orders',
    async ({ params }) => {
      try {
        const orders = await getOrdersForCompany(params.id);
        return { success: true, data: orders } satisfies ApiResponse<typeof orders>;
      } catch (err) {
        console.error('[Companies] Failed to load orders for company:', err);
        return { success: false, data: [], message: 'Failed to load orders' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get all orders where this company is the client',
      },
    },
  )

  // ─── Vessels for a Company ───────────────────────────────────────
  .get(
    '/local/:id/vessels',
    async ({ params }) => {
      try {
        const vessels = await getVesselsForCompany(params.id);
        return { success: true, data: vessels } satisfies ApiResponse<typeof vessels>;
      } catch (err) {
        console.error('[Companies] Failed to load vessels for company:', err);
        return { success: false, data: [], message: 'Failed to load vessels' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get vessels linked to a company',
      },
    },
  )

  // ─── Search Companies (typeahead: local + Seasearcher) ────────────
  .get(
    '/search',
    async ({ query }) => {
      if (!query.term || query.term.length < 2) {
        return { success: true, data: [] };
      }
      try {
        const data = await searchCompaniesTypeahead(query.term);
        return { success: true, data };
      } catch (err) {
        console.error('[Companies] Search failed:', err);
        return { success: true, data: [] };
      }
    },
    {
      query: t.Object({
        term: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Search companies (local DB + Seasearcher)',
      },
    },
  )

  // ─── Get Seasearcher Enrichment ───────────────────────────────────
  .get(
    '/enrichment/:seasearcherId',
    async ({ params }) => {
      try {
        const data = await getCompanyEnrichment(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Enrichment failed:', err);
        return { success: false, data: null, message: 'Failed to load enrichment' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get Seasearcher enrichment data for a company',
      },
    },
  )

  // ─── Get Company Fleet ────────────────────────────────────────────
  .get(
    '/enrichment/:seasearcherId/fleet',
    async ({ params }) => {
      try {
        const data = await getCompanyFleet(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Fleet fetch failed:', err);
        return { success: false, data: null, message: 'Failed to load fleet' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get company fleet from Seasearcher',
      },
    },
  )

  // ─── Get Company Hierarchy ────────────────────────────────────────
  .get(
    '/enrichment/:seasearcherId/hierarchy',
    async ({ params }) => {
      try {
        const data = await getCompanyHierarchy(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Hierarchy fetch failed:', err);
        return { success: false, data: null, message: 'Failed to load hierarchy' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get company ownership hierarchy from Seasearcher',
      },
    },
  )

  // ─── Get Company Seizures ─────────────────────────────────────────
  .get(
    '/enrichment/:seasearcherId/seizures',
    async ({ params }) => {
      try {
        const data = await getCompanySeizures(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Seizures fetch failed:', err);
        return { success: false, data: null, message: 'Failed to load seizures' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get company seizures from Seasearcher',
      },
    },
  )

  // ─── Get Company Sanctions ────────────────────────────────────────
  .get(
    '/enrichment/:seasearcherId/sanctions',
    async ({ params }) => {
      try {
        const data = await getCompanySanctions(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Sanctions fetch failed:', err);
        return { success: false, data: null, message: 'Failed to load sanctions' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get company sanctions from Seasearcher',
      },
    },
  )

  // ─── Find Company by Seasearcher ID ───────────────────────────────
  .get(
    '/by-seasearcher/:seasearcherId',
    async ({ params }) => {
      const company = await getCompanyBySeasearcherId(params.seasearcherId);
      if (!company) {
        return { success: false, data: null };
      }
      return { success: true, data: company } satisfies ApiResponse<typeof company>;
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Find a local company by its Seasearcher ID',
      },
    },
  )

  // ─── Create Company (manual entry) ────────────────────────────────
  .post(
    '/local',
    async ({ body }) => {
      const company = await createCompany(body);
      return { success: true, data: company } satisfies ApiResponse<typeof company>;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        types: t.Array(
          t.Union([
            t.Literal('SUPPLIER'),
            t.Literal('CLIENT'),
            t.Literal('BARGE'),
          ]),
          { minItems: 1 },
        ),
        country: t.Optional(t.String()),
        countryIso: t.Optional(t.String()),
        creditLimit: t.Optional(t.String()),
        companyImo: t.Optional(t.String()),
        seasearcherId: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Create a company manually',
      },
    },
  )

  // ─── Update Company Types ─────────────────────────────────────────
  .patch(
    '/local/:id/types',
    async ({ params, body }) => {
      const updated = await updateCompanyTypes(params.id, body.types);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        types: t.Array(
          t.Union([
            t.Literal('SUPPLIER'),
            t.Literal('CLIENT'),
            t.Literal('BARGE'),
          ]),
          { minItems: 1 },
        ),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Update company types',
      },
    },
  )

  // ─── Update Company Segments ──────────────────────────────────────
  .patch(
    '/local/:id/segments',
    async ({ params, body }) => {
      const updated = await updateCompanySegments(params.id, body.segments);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        segments: t.Record(t.String(), t.Union([t.String(), t.Array(t.String())])),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Update company segmentation values',
      },
    },
  )

  // ─── Import Company from Seasearcher ──────────────────────────────
  .post(
    '/import',
    async ({ body }) => {
      try {
        const company = await importCompanyFromSeasearcher(body.seasearcherId);
        return { success: true, data: company } satisfies ApiResponse<typeof company>;
      } catch (err) {
        console.error('[Companies] Import failed:', err);
        return { success: false, data: null, message: 'Import failed' };
      }
    },
    {
      body: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Import a company from Seasearcher',
      },
    },
  )

  // ─── Import Company by Name (search Seasearcher, import first match) ──
  .post(
    '/import-by-name',
    async ({ body }) => {
      try {
        const company = await importCompanyByName(body.companyName);
        return { success: true, data: company } satisfies ApiResponse<typeof company>;
      } catch (err) {
        console.error('[Companies] Import by name failed:', err);
        return { success: false, data: null, message: 'Import by name failed' };
      }
    },
    {
      body: t.Object({ companyName: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Import a company by searching Seasearcher by name',
      },
    },
  )

  // ─── Sync Company from Seasearcher ────────────────────────────────
  .post(
    '/local/:id/sync',
    async ({ params }) => {
      const updated = await syncCompanyFromSeasearcher(params.id);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found or no Seasearcher ID' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Sync company data from Seasearcher',
      },
    },
  )

  // ─── Update Company (manual fields) ────────────────────────────────
  .patch(
    '/local/:id',
    async ({ params, body }) => {
      const updated = await updateCompany(params.id, body);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        country: t.Optional(t.Nullable(t.String())),
        countryIso: t.Optional(t.Nullable(t.String())),
        creditLimit: t.Optional(t.Nullable(t.String())),
        yearFormed: t.Optional(t.Nullable(t.Number())),
        fleetSize: t.Optional(t.Nullable(t.Number())),
        headOfficeAddress: t.Optional(t.Nullable(t.String())),
        headOfficePhone: t.Optional(t.Nullable(t.String())),
        headOfficeEmail: t.Optional(t.Nullable(t.String())),
        website: t.Optional(t.Nullable(t.String())),
        companyImo: t.Optional(t.Nullable(t.String())),
        companyRoles: t.Optional(t.Nullable(t.Array(t.String()))),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Update company fields',
      },
    },
  )

  // ─── Accept SeaSearcher Value (resolve a conflict) ────────────────
  .post(
    '/local/:id/accept-seasearcher',
    async ({ params, body }) => {
      try {
        const updated = await acceptSeasearcherValue(params.id, body.field);
        if (!updated) {
          return { success: false, data: null, message: 'Company not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        return { success: false, data: null, message: err?.message ?? 'Failed to accept value' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ field: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Accept SeaSearcher value for a conflicting field, removing the manual override',
      },
    },
  )

  // ─── Keep Mine (dismiss a SeaSearcher conflict) ───────────────────
  .post(
    '/local/:id/keep-mine',
    async ({ params, body }) => {
      try {
        const updated = await keepMineValue(params.id, body.field, body.seasearcherValue);
        if (!updated) {
          return { success: false, data: null, message: 'Company not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        return { success: false, data: null, message: err?.message ?? 'Failed to keep mine' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        field: t.String(),
        seasearcherValue: t.Union([t.String(), t.Number(), t.Null()]),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Dismiss a SeaSearcher conflict by persisting the SS value we chose to ignore',
      },
    },
  )

  // ─── Update Company Responsible User ─────────────────────────────
  .patch(
    '/local/:id/responsible-user',
    async ({ params, body }) => {
      const updated = await updateCompanyResponsibleUser(params.id, body.userId ?? null);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ userId: t.Optional(t.Nullable(t.String())) }),
      detail: {
        tags: ['Companies'],
        summary: 'Update responsible user for a company',
      },
    },
  )

  // ─── Delete Company ───────────────────────────────────────────────
  .delete(
    '/local/:id',
    async ({ params, auth, set }) => {
      const allowed = ['ADMIN', 'CREDITMANAGER', 'TEAMLEAD'];
      if (!allowed.includes(auth.role)) {
        set.status = 403;
        return { success: false, data: null, message: 'Only admins, credit managers and team leads can delete companies' };
      }
      try {
        const deleted = await deleteCompany(params.id);
        if (!deleted) {
          return { success: false, data: null, message: 'Company not found' };
        }
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err: any) {
        if (err?.code === 'HAS_ORDERS') {
          return {
            success: false,
            data: null,
            message: err.message,
          };
        }
        if (err?.code === '23503') {
          return {
            success: false,
            data: null,
            message: 'Cannot delete: company has linked records. Remove them first.',
          };
        }
        throw err;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Delete a company from local database',
      },
    },
  )

  // ─── Company Contacts ─────────────────────────────────────────────
  .get(
    '/local/:id/contacts',
    async ({ params }) => {
      try {
        const contacts = await getCompanyContacts(params.id);
        return { success: true, data: contacts } satisfies ApiResponse<typeof contacts>;
      } catch (err: any) {
        return { success: false, data: [], message: err?.message ?? 'Failed to fetch contacts' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get contacts for a company' },
    },
  )
  .post(
    '/local/:id/contacts',
    async ({ params, body }) => {
      try {
        const contact = await createCompanyContact(params.id, body);
        return { success: true, data: contact } satisfies ApiResponse<typeof contact>;
      } catch (err: any) {
        return { success: false, data: null, message: err?.message ?? 'Failed to create contact' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.String(),
        role: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        fax: t.Optional(t.String()),
        email: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
      detail: { tags: ['Companies'], summary: 'Add a contact to a company' },
    },
  )
  .patch(
    '/contacts/:contactId',
    async ({ params, body }) => {
      try {
        const updated = await updateCompanyContact(params.contactId, body);
        if (!updated) return { success: false, data: null, message: 'Contact not found' };
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        return { success: false, data: null, message: err?.message ?? 'Failed to update contact' };
      }
    },
    {
      params: t.Object({ contactId: t.String() }),
      body: t.Object({
        name: t.Optional(t.String()),
        role: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        fax: t.Optional(t.String()),
        email: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
      detail: { tags: ['Companies'], summary: 'Update a company contact' },
    },
  )
  .delete(
    '/contacts/:contactId',
    async ({ params }) => {
      try {
        await deleteCompanyContact(params.contactId);
        return { success: true, data: null, message: 'Contact deleted' };
      } catch (err: any) {
        return { success: false, data: null, message: err?.message ?? 'Failed to delete contact' };
      }
    },
    {
      params: t.Object({ contactId: t.String() }),
      detail: { tags: ['Companies'], summary: 'Delete a company contact' },
    },
  )

  // ─── Supply Ports (where this company is a supplier) ──────────────
  .get(
    '/local/:id/supply-ports',
    async ({ params }) => {
      try {
        const data = await getSupplyPortsForCompany(params.id);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Supply ports failed:', err);
        return { success: false, data: [], message: 'Failed to load supply ports' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get ports/places where this company is a supplier',
      },
    },
  )

  // ═══════════════════════════════════════════════════════════════════════
  //  COMPANY EMAILS (flexible email types)
  // ═══════════════════════════════════════════════════════════════════════

  // ─── List Emails for a Company ─────────────────────────────────────
  .get(
    '/local/:id/emails',
    async ({ params }) => {
      try {
        const emails = await getCompanyEmails(params.id);
        return { success: true, data: emails } satisfies ApiResponse<typeof emails>;
      } catch (err: any) {
        console.error('[Companies] Failed to load emails:', err);
        return { success: false, data: [], message: 'Failed to load emails' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Get emails for a company',
      },
    },
  )

  // ─── Add Email to Company ──────────────────────────────────────────
  .post(
    '/local/:id/emails',
    async ({ params, body, auth }) => {
      try {
        // Look up user name for audit trail
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.sub)).limit(1);
        const email = await addCompanyEmail(
          params.id,
          {
            emailType: body.emailType as CompanyEmailType,
            email: body.email,
            label: body.label,
            isPrimary: body.isPrimary,
          },
          auth.sub,
          u?.name ?? auth.email,
        );
        return { success: true, data: email } satisfies ApiResponse<typeof email>;
      } catch (err: any) {
        console.error('[Companies] Failed to add email:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to add email' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        emailType: t.String(), // 'sales' | 'invoice' | 'inquiry' | 'general' | custom
        email: t.String(),
        label: t.Optional(t.String()),
        isPrimary: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Add an email to a company',
      },
    },
  )

  // ─── Update Company Email ──────────────────────────────────────────
  .patch(
    '/emails/:emailId',
    async ({ params, body }) => {
      try {
        const updated = await updateCompanyEmail(params.emailId, {
          emailType: body.emailType as CompanyEmailType | undefined,
          email: body.email,
          label: body.label,
          isPrimary: body.isPrimary,
        });
        if (!updated) {
          return { success: false, data: null, message: 'Email not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        console.error('[Companies] Failed to update email:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to update' };
      }
    },
    {
      params: t.Object({ emailId: t.String() }),
      body: t.Object({
        emailType: t.Optional(t.String()),
        email: t.Optional(t.String()),
        label: t.Optional(t.String()),
        isPrimary: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Update a company email',
      },
    },
  )

  // ─── Delete Company Email ──────────────────────────────────────────
  .delete(
    '/emails/:emailId',
    async ({ params }) => {
      try {
        const deleted = await deleteCompanyEmail(params.emailId);
        if (!deleted) {
          return { success: false, data: null, message: 'Email not found' };
        }
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err: any) {
        console.error('[Companies] Failed to delete email:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to delete' };
      }
    },
    {
      params: t.Object({ emailId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Delete a company email',
      },
    },
  )

  // ═══════════════════════════════════════════════════════════════════════
  //  COMPANY OFFICES
  // ═══════════════════════════════════════════════════════════════════════

  .get(
    '/local/:id/offices',
    async ({ params }) => {
      try {
        const offices = await getCompanyOffices(params.id);
        return { success: true, data: offices } satisfies ApiResponse<typeof offices>;
      } catch (err: any) {
        console.error('[Companies] Failed to load offices:', err);
        return { success: false, data: [], message: 'Failed to load offices' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'List offices for a company' },
    },
  )

  .post(
    '/local/:id/offices',
    async ({ params, body }) => {
      try {
        const office = await addCompanyOffice(params.id, body);
        return { success: true, data: office } satisfies ApiResponse<typeof office>;
      } catch (err: any) {
        console.error('[Companies] Failed to add office:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to add office' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        city: t.String(),
        country: t.Optional(t.String()),
        countryCode: t.Optional(t.String()),
        address: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
      detail: { tags: ['Companies'], summary: 'Add an office to a company' },
    },
  )

  .patch(
    '/offices/:officeId',
    async ({ params, body }) => {
      try {
        const updated = await updateCompanyOffice(params.officeId, body);
        if (!updated) return { success: false, data: null, message: 'Office not found' };
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        console.error('[Companies] Failed to update office:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to update' };
      }
    },
    {
      params: t.Object({ officeId: t.String() }),
      body: t.Object({
        city: t.Optional(t.String()),
        country: t.Optional(t.String()),
        countryCode: t.Optional(t.String()),
        address: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        email: t.Optional(t.String()),
      }),
      detail: { tags: ['Companies'], summary: 'Update a company office' },
    },
  )

  .delete(
    '/offices/:officeId',
    async ({ params }) => {
      try {
        const deleted = await deleteCompanyOffice(params.officeId);
        if (!deleted) return { success: false, data: null, message: 'Office not found' };
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err: any) {
        console.error('[Companies] Failed to delete office:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to delete' };
      }
    },
    {
      params: t.Object({ officeId: t.String() }),
      detail: { tags: ['Companies'], summary: 'Delete a company office' },
    },
  )

  // ═══════════════════════════════════════════════════════════════════
  //  PARENT / CHILD HIERARCHY
  // ═══════════════════════════════════════════════════════════════════

  // ─── Get Children ──────────────────────────────────────────────────
  .get(
    '/local/:id/children',
    async ({ params }) => {
      try {
        const children = await getChildCompanies(params.id);
        return { success: true, data: children } satisfies ApiResponse<typeof children>;
      } catch (err: any) {
        return { success: false, data: [], message: err.message ?? 'Failed to load children' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get child companies for a parent' },
    },
  )

  // ─── Get Parent ────────────────────────────────────────────────────
  .get(
    '/local/:id/parent',
    async ({ params }) => {
      try {
        const parent = await getParentCompany(params.id);
        return { success: true, data: parent } satisfies ApiResponse<typeof parent>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Failed to load parent' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get parent company for a child' },
    },
  )

  // ─── Aggregated group figures (credit, fleet, orders) ─────────────
  .get(
    '/local/:id/group-aggregate',
    async ({ params }) => {
      try {
        const data = await getCompanyGroupAggregate(params.id);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Failed to aggregate' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get aggregated credit/fleet/order totals for a parent + children' },
    },
  )

  // ─── Group orders (parent + children) ──────────────────────────────
  .get(
    '/local/:id/group-orders',
    async ({ params }) => {
      try {
        const orders = await getGroupOrdersForCompany(params.id);
        return { success: true, data: orders } satisfies ApiResponse<typeof orders>;
      } catch (err: any) {
        return { success: false, data: [], message: err.message ?? 'Failed to load group orders' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get orders for a parent + all its children' },
    },
  )

  // ─── Group vessels (parent + children) ─────────────────────────────
  .get(
    '/local/:id/group-vessels',
    async ({ params }) => {
      try {
        const vessels = await getGroupVesselsForCompany(params.id);
        return { success: true, data: vessels } satisfies ApiResponse<typeof vessels>;
      } catch (err: any) {
        return { success: false, data: [], message: err.message ?? 'Failed to load group vessels' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get vessels for a parent + all its children' },
    },
  )

  // ─── Link child to parent ─────────────────────────────────────────
  .post(
    '/local/:id/set-parent',
    async ({ params, body }) => {
      try {
        const updated = await setParentCompany(params.id, body.parentId);
        if (!updated) return { success: false, data: null, message: 'Company not found' };
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Failed to set parent' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ parentId: t.String() }),
      detail: { tags: ['Companies'], summary: 'Set the parent company for a child (link)' },
    },
  )

  // ─── Unlink child from parent ─────────────────────────────────────
  .post(
    '/local/:id/remove-parent',
    async ({ params }) => {
      try {
        const updated = await removeParentCompany(params.id);
        if (!updated) return { success: false, data: null, message: 'Company not found' };
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Failed to remove parent' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Remove the parent link from a child company (unlink)' },
    },
  )

  // ─── Top credit groups (dashboard widget) ─────────────────────────
  .get(
    '/top-credit-groups',
    async ({ query }) => {
      try {
        const limit = query?.limit ? Number(query.limit) : 10;
        const groups = await getTopCreditGroups(limit);
        return { success: true, data: groups } satisfies ApiResponse<typeof groups>;
      } catch (err: any) {
        return { success: false, data: [], message: err.message ?? 'Failed to load credit groups' };
      }
    },
    {
      query: t.Optional(t.Object({ limit: t.Optional(t.String()) })),
      detail: { tags: ['Companies'], summary: 'Top parent company groups by credit exposure' },
    },
  );
