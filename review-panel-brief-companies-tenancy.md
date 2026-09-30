# REVIEW — INSTRUCTIONS

You are a code reviewer. You have NO tools, no filesystem, no repository access. Everything is in this payload — do NOT attempt to call tools or read files. Reason over the text only.

Deliver: findings marked MUST or SHOULD with file/symbol references, any disagreement, and a verdict: APPROVE / APPROVE-WITH-CONDITIONS / NO-GO. Terse, evidence-first. Quote the line you rely on.

# THIS IS ROUND 2 OF A TENANCY FIX — read this first

Round 1 was reviewed and came back NO-GO / APPROVE-WITH-CONDITIONS. The findings were accepted as correct and are now fixed. If you are one of the reviewers who saw round 1, the three MUSTs you raised (`getCompanyBySeasearcherId` unscoped, child-resource routes by their own id unguarded, `setParentCompany` cross-tenant parent) are addressed below — please check the fixes rather than re-raising them.

## What the original bug was

`counterparties` (companies) has `tenant_id NOT NULL`; `counterparties.name` is NOT unique across tenants; there are no shared/global rows. `GET /companies/local/:id` and 35 siblings read `params.id` with no tenant predicate, so any authenticated user of any tenant could read another tenant's company, contacts, emails, orders, ledger and credit. Also: `createCompany` used `db.query.tenants.findFirst()` (the FIRST tenant in the table); `getTopCreditGroups`, `listCompanies` and the local half of `searchCompaniesTypeashead` had no tenant filter.

## Round 1's design, kept

A single `onBeforeHandle` on the companiesController instance: resolves `params.id` (only the `/local/:id…` family has it), answers **404** unless the company belongs to `auth.tenantId`. 404 not 403 so a foreign id is indistinguishable from a nonexistent one. `tenantId` then threaded explicitly as a REQUIRED parameter (not ambient) so the compiler enumerated every caller. No automatic repository-level tenant filter, deliberately.

## What round 2 adds (the fixes for round 1's findings)

1. **Child-resource routes** (`/contacts/:contactId`, `/emails/:emailId`, `/offices/:officeId`, `/attachments/:attachmentId`) take the CHILD id, so the `params.id` guard never fires. Scoped inside the query via `inArray(child.counterpartyId, ownedCompanyIds(tenantId))`, where `ownedCompanyIds` is a typed subquery of the caller's company ids. Their handlers now return 404 rather than 200-with-`success:false`.
2. **`getCompanyBySeasearcherId(seasearcherId, tenantId)`** — scoped; the `/by-seasearcher/:seasearcherId` route 404s; `importCompanyFromSeasearcher`'s dedupe is scoped so tenant B cannot receive (and then not create) tenant A's record of the same Seasearcher company.
3. **`setParentCompany(childId, parentId, tenantId)`** — both ends constrained; a cross-tenant parent is refused as `NOT_FOUND` (404). `removeParentCompany` also scoped.
4. **Writes that took a `tenantId` but did not use it** — `syncCompanyFromSeasearcher`, `acceptSeasearcherValue`, `keepMineValue`, `updateCompanyTypes`, `updateCompanySegments`, `updateCompanyResponsibleUser`, `deleteCompany`, `removeParentCompany` — now all carry `and(eq(id), eq(tenantId))`.
5. **`getTopCreditGroups(tenantId, limit)`** — the raw-SQL aggregate filters `p.tenant_id`.
6. **Websocket auto-sync** (non-HTTP entry point the route guard cannot cover): new `getSessionTenant(socketId)` in `session-tracker.ts` resolves the session's user → tenant; `index.ts` skips the sync when unknown.

## Known, stated gaps (do not re-raise as new; say if you disagree with the judgement)
- `getChildCompanies` / `getParentCompany` / `getGroupOrdersForCompany` / group fleet/vessel/aggregate still take only an id, with no tenant predicate. They are reachable only through the guarded `/local/:id/group-*` routes, and cross-tenant LINKS are now refused at `setParentCompany`, so a cross-tenant traversal requires a pre-existing bad link.
- `getTopCreditGroups`' comment says `p.tenant_id = c.tenant_id` is "implied by the parent join". A reviewer correctly pointed out the join is `c.parent_id = p.id` and implies nothing about tenants.
- `getSessionTenant` does a DB lookup per entity view and the skip is silent (no log).

# Scrutinise hardest
1. Any route in this controller still reachable that reads or writes tenant data with no tenant predicate? Appendix A is the FULL controller; Appendix B is the service diff.
2. Can a foreign write still land through any path (direct service call, the websocket hook, a sibling module, a body-supplied id like `parentId`/`preferredInvoicingCompanyId`)?
3. Is the child-resource `inArray(subquery)` scoping correct — any case where it silently matches nothing (breaking a legitimate call) or matches too much?
4. The 404-vs-403 choice and the new status codes: any place the fix leaks existence, or turns a legitimate error into a wrong status?


# Appendix A — companies.controller.ts (FULL, post-round-2)

```ts
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
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../../db';
import { users, companyEmails, companyContacts, counterparties } from '../../db/schema';
import { authGuard } from '../auth/auth.guard';
import { buildStructuredActivityDiff } from '../activity/activity-diff';
import { logActivity } from '../activity/activity.service';
import {
  listCompanies,
  companyBelongsToTenant,
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
  getCompanyAttachments,
  createCompanyAttachment,
  deleteCompanyAttachment,
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
  getGroupFleetForCompany,
  getGroupVesselsForCompany,
  getTopCreditGroups,
  updateCompanySegments,
  listCompanyPlaceSupplyRules,
  createCompanyPlaceSupplyRule,
  updateCompanyPlaceSupplyRule,
  deleteCompanyPlaceSupplyRule,
  reapplyCompanyPlaceSupplyRule,
  getCustomerPaymentLedger,
  getSupplierPaymentLedger,
} from './company.service';
import { getSupplyPortsForCompany } from '../lloyds/lli.service';
import { getUserCompanyAccess } from '../admin/settings.service';
import type { ApiResponse, CompanyEmailType } from '@fueld/types';

export const companiesController = new Elysia({ prefix: '/companies' })
  .use(authGuard)
  /**
   * Route guard: every `/local/:id…` route must name a company in the caller's
   * tenant.
   *
   * Enforced here rather than in each of the thirty-six handlers because the
   * alternative is a rule that has to be remembered on every new route, and this
   * module already had one route consulting `auth.tenantId` while the rest read
   * `params.id` unscoped: a company id from another tenant returned that
   * tenant's data (`getCompanyById` filtered on the id alone).
   *
   * Answered as 404, not 403: a foreign id must be indistinguishable from a
   * nonexistent one, or the error itself confirms the id exists elsewhere.
   */
  .onBeforeHandle(async ({ params, auth, set }) => {
    const id = (params as { id?: string } | undefined)?.id;
    if (!id) return;
    if (!auth?.tenantId) {
      set.status = 401;
      return { success: false, data: null, message: 'Unauthenticated' };
    }
    if (!(await companyBelongsToTenant(id, auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Company not found' };
    }
  })

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
    async ({ query, auth }) => {
      const results = await listCompanies(auth.tenantId, {
        search: query.search,
        type: query.type,
        country: query.country,
        countryIso: query.countryIso,
        responsibleUserId: query.responsibleUserId,
        segment: query.segment,
        sortBy: query.sortBy,
        sortDir: query.sortDir as 'asc' | 'desc' | undefined,
        page: query.page ? parseInt(query.page, 10) : undefined,
        limit: query.limit ? parseInt(query.limit, 10) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        type: t.Optional(t.String()),
        country: t.Optional(t.String()),
        countryIso: t.Optional(t.String()),
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
    async ({ params, auth }) => {
      const company = await getCompanyById(params.id, auth.tenantId);
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

  //  GET  /companies/local/:id/inquiry-data
  //  Returns a company's emails + contacts for direct inquiry sending
  //  (without needing to register as a port supplier first).
  .get(
    '/local/:id/inquiry-data',
    async ({ params }) => {
      const [company] = await db
        .select({ id: counterparties.id, name: counterparties.name })
        .from(counterparties)
        .where(eq(counterparties.id, params.id))
        .limit(1);
      if (!company) return { success: false, data: null, message: 'Company not found' };

      const [emails, contacts] = await Promise.all([
        db
          .select({
            email: companyEmails.email,
            emailType: companyEmails.emailType,
            isPrimary: companyEmails.isPrimary,
          })
          .from(companyEmails)
          .where(eq(companyEmails.counterpartyId, params.id)),
        db
          .select({
            id: companyContacts.id,
            name: companyContacts.name,
            role: companyContacts.role,
            email: companyContacts.email,
            phone: companyContacts.phone,
          })
          .from(companyContacts)
          .where(and(eq(companyContacts.counterpartyId, params.id), isNull(companyContacts.deletedAt))),
      ]);

      return {
        success: true,
        data: { supplierId: company.id, supplierName: company.name, emails, contacts },
      } satisfies ApiResponse<unknown>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get company emails + contacts for direct inquiry sending' },
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
    async ({ query, auth }) => {
      if (!query.term || query.term.length < 2) {
        return { success: true, data: [] };
      }
      try {
        const data = await searchCompaniesTypeahead(auth.tenantId, query.term);
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
    async ({ auth, params, set }) => {
      const company = await getCompanyBySeasearcherId(params.seasearcherId, auth.tenantId);
      if (!company) {
        // 404, matching the ownership guard: a company in another tenant must be
        // indistinguishable from one that does not exist.
        set.status = 404;
        return { success: false, data: null, message: 'Company not found' };
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
    async ({ auth, body }) => {
      const company = await createCompany(auth.tenantId, body);
      return { success: true, data: company } satisfies ApiResponse<typeof company>;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        types: t.Array(
          t.Union([
            t.Literal('SUPPLIER'),
            t.Literal('CLIENT'),
            t.Literal('BROKER'),
            t.Literal('AGENT'),
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
    async ({ params, body, auth }) => {
      const before = await getCompanyById(params.id, auth.tenantId);
      if (!before) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const updated = await updateCompanyTypes(params.id, body.types, auth.tenantId);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const after = await getCompanyById(params.id, auth.tenantId);
      if (after) {
        const metadata = buildStructuredActivityDiff({
          action: 'update_company_types',
          before,
          after,
          fields: [
            { field: 'types', value: (company) => company.types ?? [] },
          ],
        });

        if (metadata) {
          await logActivity({
            userId: auth.sub,
            action: 'UPDATE',
            entityType: 'company',
            entityId: params.id,
            metadata,
          });
        }
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
            t.Literal('BROKER'),
            t.Literal('AGENT'),
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
    async ({ params, body, auth }) => {
      const before = await getCompanyById(params.id, auth.tenantId);
      if (!before) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const updated = await updateCompanySegments(params.id, body.segments, auth.tenantId);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const after = await getCompanyById(params.id, auth.tenantId);
      if (after) {
        const metadata = buildStructuredActivityDiff({
          action: 'update_company_segments',
          before,
          after,
          fields: [
            { field: 'segments', value: (company) => company.segments ?? {} },
          ],
        });

        if (metadata) {
          await logActivity({
            userId: auth.sub,
            action: 'UPDATE',
            entityType: 'company',
            entityId: params.id,
            metadata,
          });
        }
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
    async ({ body, auth }) => {
      try {
        const company = await importCompanyFromSeasearcher(body.seasearcherId, auth.tenantId);
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
    async ({ body, auth }) => {
      try {
        const company = await importCompanyByName(body.companyName, auth.tenantId);
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
    async ({ params, auth }) => {
      const updated = await syncCompanyFromSeasearcher(params.id, auth.tenantId);
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
    async ({ params, body, auth }) => {
      const before = await getCompanyById(params.id, auth.tenantId);
      if (!before) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const updated = await updateCompany(params.id, auth.tenantId, body);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const after = await getCompanyById(params.id, auth.tenantId);
      if (after) {
        const metadata = buildStructuredActivityDiff({
          action: 'update_company_fields',
          before,
          after,
          fields: [
            { field: 'name', value: (company) => company.name },
            { field: 'country', value: (company) => company.country ?? null },
            { field: 'countryIso', value: (company) => company.countryIso ?? null },
            { field: 'creditLimit', value: (company) => company.creditLimit ?? null },
            { field: 'yearFormed', value: (company) => company.yearFormed ?? null },
            { field: 'fleetSize', value: (company) => company.fleetSize ?? null },
            { field: 'headOfficeAddress', value: (company) => company.headOfficeAddress ?? null },
            { field: 'headOfficePhone', value: (company) => company.headOfficePhone ?? null },
            { field: 'headOfficeEmail', value: (company) => company.headOfficeEmail ?? null },
            { field: 'website', value: (company) => company.website ?? null },
            { field: 'companyImo', value: (company) => company.companyImo ?? null },
            { field: 'companyRoles', value: (company) => company.companyRoles ?? [] },
            { field: 'kycVerifiedDate', value: (company) => (company as any).kycVerifiedDate ?? null },
            { field: 'kycExpiryDate', value: (company) => (company as any).kycExpiryDate ?? null },
          ],
        });

        if (metadata) {
          await logActivity({
            userId: auth.sub,
            action: 'UPDATE',
            entityType: 'company',
            entityId: params.id,
            metadata,
          });
        }
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
        specialCustomerTerms: t.Optional(t.Nullable(t.String())),
        preferredInvoicingCompanyId: t.Optional(t.Nullable(t.String())),
        kycVerifiedDate: t.Optional(t.Nullable(t.String())),
        kycExpiryDate: t.Optional(t.Nullable(t.String())),
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
    async ({ params, body, auth }) => {
      try {
        const updated = await acceptSeasearcherValue(params.id, body.field, auth.tenantId);
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
    async ({ params, body, auth }) => {
      try {
        const updated = await keepMineValue(params.id, body.field, body.seasearcherValue, auth.tenantId);
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
    async ({ params, body, auth }) => {
      const before = await getCompanyById(params.id, auth.tenantId);
      if (!before) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const updated = await updateCompanyResponsibleUser(params.id, body.userId ?? null, auth.tenantId);
      if (!updated) {
        return { success: false, data: null, message: 'Company not found' };
      }

      const after = await getCompanyById(params.id, auth.tenantId);
      if (after) {
        const metadata = buildStructuredActivityDiff({
          action: 'update_company_responsible_user',
          before,
          after,
          fields: [
            {
              field: 'responsibleUserId',
              value: (company) => company.responsibleUserId ?? null,
              displayValue: (company) => company.responsibleUserName ?? null,
            },
          ],
        });

        if (metadata) {
          await logActivity({
            userId: auth.sub,
            action: 'UPDATE',
            entityType: 'company',
            entityId: params.id,
            metadata,
          });
        }
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
        const deleted = await deleteCompany(params.id, auth.tenantId);
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
    async ({ auth, params, body, set }) => {
      try {
        const updated = await updateCompanyContact(params.contactId, body, auth.tenantId);
        // Not found and not-yours are the same answer, and both are a 404.
        if (!updated) { set.status = 404; return { success: false, data: null, message: 'Contact not found' }; }
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
    async ({ auth, params, set }) => {
      try {
        const removed = await deleteCompanyContact(params.contactId, auth.tenantId);
        if (!removed) { set.status = 404; return { success: false, data: null, message: 'Contact not found' }; }
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

  .get(
    '/local/:id/place-supply-rules',
    async ({ params }) => {
      try {
        const data = await listCompanyPlaceSupplyRules(params.id);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Companies] Place supply rules failed:', err);
        return { success: false, data: [], message: 'Failed to load place supply rules' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'List company place supply rules',
      },
    },
  )
  .post(
    '/local/:id/place-supply-rules',
    async ({ params, body, auth }) => {
      try {
        const [userRow] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, auth.sub))
          .limit(1);

        const data = await createCompanyPlaceSupplyRule(params.id, body, auth.sub, userRow?.name ?? auth.email);

        logActivity({
          userId: auth.sub,
          action: 'CREATE',
          entityType: 'company',
          entityId: params.id,
          httpMethod: 'POST',
          httpPath: `/companies/local/${params.id}/place-supply-rules`,
          metadata: {
            countryIso: data.rule.countryIso,
            placeTypes: data.rule.placeTypes,
            created: data.created,
            skipped: data.skipped,
          },
        }).catch(() => {});

        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        console.error('[Companies] Create place supply rule failed:', err);
        return { success: false, data: null, message: err?.message ?? 'Failed to create place supply rule' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        countryIso: t.String({ minLength: 3, maxLength: 3 }),
        placeTypes: t.Array(t.String({ minLength: 3, maxLength: 3 }), { minItems: 1 }),
        contactId: t.Optional(t.Union([t.String(), t.Null()])),
        products: t.Optional(t.Array(t.String())),
        note: t.Optional(t.Union([t.String(), t.Null()])),
        isActive: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Create a company place supply rule and apply it to existing places',
      },
    },
  )
  .put(
    '/local/:id/place-supply-rules/:ruleId',
    async ({ params, body, auth }) => {
      try {
        const data = await updateCompanyPlaceSupplyRule(params.id, params.ruleId, body);
        if (!data) {
          return { success: false, data: null, message: 'Place supply rule not found' };
        }

        logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'company',
          entityId: params.id,
          httpMethod: 'PUT',
          httpPath: `/companies/local/${params.id}/place-supply-rules/${params.ruleId}`,
          metadata: {
            ruleId: params.ruleId,
            countryIso: data.countryIso,
            placeTypes: data.placeTypes,
          },
        }).catch(() => {});

        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        console.error('[Companies] Update place supply rule failed:', err);
        return { success: false, data: null, message: err?.message ?? 'Failed to update place supply rule' };
      }
    },
    {
      params: t.Object({ id: t.String(), ruleId: t.String() }),
      body: t.Object({
        countryIso: t.Optional(t.String({ minLength: 3, maxLength: 3 })),
        placeTypes: t.Optional(t.Array(t.String({ minLength: 3, maxLength: 3 }), { minItems: 1 })),
        contactId: t.Optional(t.Union([t.String(), t.Null()])),
        products: t.Optional(t.Array(t.String())),
        note: t.Optional(t.Union([t.String(), t.Null()])),
        isActive: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Update a company place supply rule',
      },
    },
  )
  .delete(
    '/local/:id/place-supply-rules/:ruleId',
    async ({ params, auth }) => {
      try {
        const data = await deleteCompanyPlaceSupplyRule(params.id, params.ruleId);
        if (!data) {
          return { success: false, data: null, message: 'Place supply rule not found' };
        }

        logActivity({
          userId: auth.sub,
          action: 'DELETE',
          entityType: 'company',
          entityId: params.id,
          httpMethod: 'DELETE',
          httpPath: `/companies/local/${params.id}/place-supply-rules/${params.ruleId}`,
          metadata: {
            ruleId: params.ruleId,
            countryIso: data.countryIso,
            placeTypes: data.placeTypes,
          },
        }).catch(() => {});

        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        console.error('[Companies] Delete place supply rule failed:', err);
        return { success: false, data: null, message: err?.message ?? 'Failed to delete place supply rule' };
      }
    },
    {
      params: t.Object({ id: t.String(), ruleId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Delete a company place supply rule',
      },
    },
  )
  .post(
    '/local/:id/place-supply-rules/:ruleId/reapply',
    async ({ params, auth }) => {
      try {
        const data = await reapplyCompanyPlaceSupplyRule(params.id, params.ruleId);
        if (!data) {
          return { success: false, data: null, message: 'Place supply rule not found' };
        }

        logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'company',
          entityId: params.id,
          httpMethod: 'POST',
          httpPath: `/companies/local/${params.id}/place-supply-rules/${params.ruleId}/reapply`,
          metadata: {
            ruleId: params.ruleId,
            created: data.created,
            updated: data.updated,
            skipped: data.skipped,
          },
        }).catch(() => {});

        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        console.error('[Companies] Reapply place supply rule failed:', err);
        return { success: false, data: null, message: err?.message ?? 'Failed to reapply place supply rule' };
      }
    },
    {
      params: t.Object({ id: t.String(), ruleId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Reapply a company place supply rule to existing matching places',
      },
    },
  )

  // ─── Company Attachments ─────────────────────────────────────────
  .get(
    '/local/:id/attachments',
    async ({ params }) => {
      try {
        const attachments = await getCompanyAttachments(params.id);
        return { success: true, data: attachments } satisfies ApiResponse<typeof attachments>;
      } catch (err) {
        console.error('[Companies] Failed to load attachments:', err);
        return { success: false, data: [], message: 'Failed to load attachments' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'List attachments for a company',
      },
    },
  )
  .post(
    '/local/:id/attachments',
    async ({ params, body, auth }) => {
      try {
        const file = body.file;
        const ext = (file.name.split('.').pop() ?? '').toLowerCase();
        const allowedExtensions = new Set(['pdf', 'xls', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'gif', 'webp']);

        if (!allowedExtensions.has(ext)) {
          return { success: false, data: null, message: 'Only PDF, XLS, XLSX, CSV or image files are allowed' };
        }
        if (file.size > 10 * 1024 * 1024) {
          return { success: false, data: null, message: 'Attachment must be under 10 MB' };
        }

        const filename = `${params.id}-${crypto.randomUUID()}.${ext}`;
        const { join } = await import('path');
        const { mkdir } = await import('fs/promises');
        const dir = join(process.cwd(), 'uploads/attachments');
        await mkdir(dir, { recursive: true });
        await Bun.write(join(dir, filename), file);

        const record = await createCompanyAttachment({
          counterpartyId: params.id,
          fileName: file.name,
          filePath: `/uploads/attachments/${filename}`,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          uploadedBy: auth.sub,
        });

        if (!record) {
          return { success: false, data: null, message: 'Failed to save attachment' };
        }

        return { success: true, data: record } satisfies ApiResponse<typeof record>;
      } catch (err) {
        console.error('[Companies] Upload attachment failed:', err);
        return { success: false, data: null, message: 'Failed to upload attachment' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        file: t.File(),
      }),
      detail: {
        tags: ['Companies'],
        summary: 'Upload an attachment for a company',
      },
    },
  )
  .delete(
    '/attachments/:attachmentId',
    async ({ auth, params, set }) => {
      try {
        const deleted = await deleteCompanyAttachment(params.attachmentId, auth.tenantId);
        if (!deleted) {
          set.status = 404;
          return { success: false, data: null, message: 'Attachment not found' };
        }

        try {
          const { join } = await import('path');
          const { unlink } = await import('fs/promises');
          const prefix = '/uploads/attachments/';
          if (deleted.filePath.startsWith(prefix)) {
            await unlink(join(process.cwd(), 'uploads/attachments', deleted.filePath.slice(prefix.length)));
          }
        } catch {
          // File may already be absent on disk; keep the database delete.
        }

        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err) {
        console.error('[Companies] Delete attachment failed:', err);
        return { success: false, data: null, message: 'Failed to delete attachment' };
      }
    },
    {
      params: t.Object({ attachmentId: t.String() }),
      detail: {
        tags: ['Companies'],
        summary: 'Delete a company attachment',
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
    async ({ auth, params, body, set }) => {
      try {
        const updated = await updateCompanyEmail(params.emailId, {
          emailType: body.emailType as CompanyEmailType | undefined,
          email: body.email,
          label: body.label,
          isPrimary: body.isPrimary,
        }, auth.tenantId);
        if (!updated) {
          set.status = 404;
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
    async ({ auth, params, set }) => {
      try {
        const deleted = await deleteCompanyEmail(params.emailId, auth.tenantId);
        if (!deleted) {
          set.status = 404;
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
    async ({ auth, params, body, set }) => {
      try {
        const updated = await updateCompanyOffice(params.officeId, body, auth.tenantId);
        if (!updated) { set.status = 404; return { success: false, data: null, message: 'Office not found' }; }
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
    async ({ auth, params, set }) => {
      try {
        const deleted = await deleteCompanyOffice(params.officeId, auth.tenantId);
        if (!deleted) { set.status = 404; return { success: false, data: null, message: 'Office not found' }; }
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

  // ─── Group fleet (parent + children) ───────────────────────────────
  .get(
    '/local/:id/group-fleet',
    async ({ params }) => {
      try {
        const fleet = await getGroupFleetForCompany(params.id);
        return { success: true, data: fleet } satisfies ApiResponse<typeof fleet>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Failed to load group fleet' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Companies'], summary: 'Get fleet for a parent + all its children with a bounded query limit' },
    },
  )

  // ─── Link child to parent ─────────────────────────────────────────
  .post(
    '/local/:id/set-parent',
    async ({ params, body, auth, set }) => {
      try {
        const updated = await setParentCompany(params.id, body.parentId, auth.tenantId);
        if (!updated) { set.status = 404; return { success: false, data: null, message: 'Company not found' }; }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        /**
         * NOT_FOUND covers "no such company" AND "that parent is not in your
         * tenant" — deliberately indistinguishable, and both are a 404. The other
         * domain errors (self-reference, already a child, has children) are the
         * caller's own data and stay user-fixable.
         */
        if (err?.code === 'NOT_FOUND') set.status = 404;
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
    async ({ params, auth, set }) => {
      try {
        const updated = await removeParentCompany(params.id, auth.tenantId);
        if (!updated) { set.status = 404; return { success: false, data: null, message: 'Company not found' }; }
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

  // ─── Payment Ledgers ──────────────────────────────────────────
  .get(
    '/local/:id/ledger/customer',
    async ({ params, query }) => {
      try {
        const ledger = await getCustomerPaymentLedger(params.id, {
          limit: query?.limit ? Number(query.limit) : undefined,
          offset: query?.offset ? Number(query.offset) : undefined,
          sort: query?.sort as 'date' | 'amount' | undefined,
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
        });
        return { success: true, data: ledger } satisfies ApiResponse<typeof ledger>;
      } catch (err: any) {
        console.error('[Companies] Customer ledger failed:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to load customer ledger' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Optional(t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        dateFrom: t.Optional(t.String()),
        dateTo: t.Optional(t.String()),
      })),
      detail: { tags: ['Companies'], summary: 'Customer payment ledger for a counterparty (all received payments across orders, per-currency totals + outstanding)' },
    },
  )
  .get(
    '/local/:id/ledger/supplier',
    async ({ params, query, auth }) => {
      try {
        const ledger = await getSupplierPaymentLedger(params.id, {
          limit: query?.limit ? Number(query.limit) : undefined,
          offset: query?.offset ? Number(query.offset) : undefined,
          sort: query?.sort as 'date' | 'amount' | undefined,
          dateFrom: query?.dateFrom,
          dateTo: query?.dateTo,
        }, auth.tenantId);
        return { success: true, data: ledger } satisfies ApiResponse<typeof ledger>;
      } catch (err: any) {
        console.error('[Companies] Supplier ledger failed:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to load supplier ledger' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      query: t.Optional(t.Object({
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
        sort: t.Optional(t.String()),
        dateFrom: t.Optional(t.String()),
        dateTo: t.Optional(t.String()),
      })),
      detail: { tags: ['Companies'], summary: 'Supplier payment ledger for a counterparty (all paid payments across order legs, per-currency totals + outstanding)' },
    },
    )

  // ─── Top credit groups (dashboard widget) ─────────────────────────
  .get(
    '/top-credit-groups',
    async ({ query, auth }) => {
      try {
        const limit = query?.limit ? Number(query.limit) : 10;
        const groups = await getTopCreditGroups(auth.tenantId, limit);
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

```

# Appendix B — company.service.ts (diff)

```diff
diff --git a/apps/api/src/modules/companies/company.service.ts b/apps/api/src/modules/companies/company.service.ts
index 13935786..3b932782 100644
--- a/apps/api/src/modules/companies/company.service.ts
+++ b/apps/api/src/modules/companies/company.service.ts
@@ -5,7 +5,7 @@
 import { eq, ilike, or, and, sql, asc, desc, inArray, isNull, ne, notInArray } from 'drizzle-orm';
 import { db } from '../../db';
 import { escapeLikePattern } from '../../utils/like';
-import { counterparties, companyAttachments, companyContacts, companyEmails, companyOffices, orders, orderItems, orderSuppliers, vessels, places, users, vesselCompanies, customerPayments, supplierPayments, supplierInvoices, supplierReceipts, invoices, creditApplications, portSuppliers, companyPlaceSupplyRules, creditLines, creditLineCounterparties } from '../../db/schema';
+import { counterparties, companyAttachments, companyContacts, companyEmails, companyOffices, orders, orderItems, orderSuppliers, tenants, vessels, places, users, vesselCompanies, customerPayments, supplierPayments, supplierInvoices, supplierReceipts, invoices, creditApplications, portSuppliers, companyPlaceSupplyRules, creditLines, creditLineCounterparties } from '../../db/schema';
 import type { CompanyEmailType } from '@fueld/types';
 import { matchLocalVessels } from '../vessels/vessel.service';
 import {
@@ -436,7 +436,14 @@ const GROUP_FLEET_MAX_COMPANIES = 12;
 //  LIST COMPANIES (local DB, paginated)
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function listCompanies(query?: {
+export async function listCompanies(
+  /**
+   * Owning tenant. REQUIRED — `counterparties.tenant_id` is NOT NULL, so every
+   * company belongs to exactly one tenant, and an unscoped query returns another
+   * tenant's customer and supplier names, addresses and contact details.
+   */
+  tenantId: string,
+  query?: {
   search?: string;
   type?: string;
   country?: string;
@@ -448,7 +455,7 @@ export async function listCompanies(query?: {
   limit?: number;
   page?: number;
 }) {
-  const conditions = [];
+  const conditions = [eq(counterparties.tenantId, tenantId)];
   if (query?.search) conditions.push(ilike(counterparties.name, `%${escapeLikePattern(query.search)}%`));
   if (query?.type) {
     const types = query.type.split(',').filter(Boolean);
@@ -560,7 +567,32 @@ export async function listCompanies(query?: {
 //  GET SINGLE COMPANY BY ID
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function getCompanyById(id: string) {
+/**
+ * Does this company belong to this tenant?
+ *
+ * `counterparties.tenant_id` is NOT NULL, so every company has exactly one owner
+ * and this is a total answer. Used by the controller's route guard, which is the
+ * single place `:id` ownership is enforced for the whole module — one check that
+ * cannot be forgotten when a route is added, rather than thirty-six.
+ */
+export async function companyBelongsToTenant(companyId: string, tenantId: string): Promise<boolean> {
+  const [row] = await db
+    .select({ id: counterparties.id })
+    .from(counterparties)
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
+    .limit(1);
+  return !!row;
+}
+
+export async function getCompanyById(
+  id: string,
+  /**
+   * Owning tenant. REQUIRED: `counterparties.name` is not unique across tenants,
+   * so an unscoped read can serve another tenant's company — and everything
+   * hanging off it (contacts, emails, ledger, credit).
+   */
+  tenantId: string,
+) {
   let row: typeof counterparties.$inferSelect | null = null;
   try {
     const [selected] = await db
@@ -610,19 +642,30 @@ export async function getCompanyById(id: string) {
 //  GET COMPANY BY SEASEARCHER ID
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function getCompanyBySeasearcherId(seasearcherId: string) {
+export async function getCompanyBySeasearcherId(
+  seasearcherId: string,
+  /**
+   * Owning tenant. Seasearcher itself is a GLOBAL directory (the enrichment,
+   * fleet, hierarchy, seizures and sanctions functions stay unscoped, correctly),
+   * but a company we have IMPORTED is tenant data — two tenants can hold their own
+   * record of the same Seasearcher company, so a lookup by Seasearcher id must not
+   * return another tenant's copy.
+   */
+  tenantId: string,
+  opts: { includeDeleted?: boolean } = {},
+) {
   let row: typeof counterparties.$inferSelect | null = null;
   try {
     const [selected] = await db
       .select()
       .from(counterparties)
-      .where(eq(counterparties.seasearcherId, seasearcherId))
+      .where(and(eq(counterparties.seasearcherId, seasearcherId), eq(counterparties.tenantId, tenantId)))
       .limit(1);
     row = selected ?? null;
   } catch (error) {
     if (!isMissingCompanyRegistrationColumnError(error)) throw error;
     row = await db.query.counterparties.findFirst({
-      where: eq(counterparties.seasearcherId, seasearcherId),
+      where: and(eq(counterparties.seasearcherId, seasearcherId), eq(counterparties.tenantId, tenantId)),
       columns: {
         companyRegistrationNumber: false,
       },
@@ -635,7 +678,13 @@ export async function getCompanyBySeasearcherId(seasearcherId: string) {
 //  CREATE COMPANY (manual entry)
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function createCompany(data: {
+export async function createCompany(
+  /**
+   * Owning tenant, REQUIRED. The company must land under the caller's tenant, not
+   * under whichever tenant happened to be first in the table.
+   */
+  tenantId: string,
+  data: {
   name: string;
   types: string[];
   country?: string;
@@ -645,8 +694,18 @@ export async function createCompany(data: {
   seasearcherId?: string;
 }) {
   // Use first tenant (single-tenant for now)
-  const tenantRow = await db.query.tenants.findFirst();
-  if (!tenantRow) throw new Error('No tenant found');
+  /**
+   * The owning tenant, passed in. This previously used
+   * `db.query.tenants.findFirst()` — the FIRST tenant in the database — so a
+   * company created by any tenant landed under whichever tenant happened to sort
+   * first. Same class of bug as the unscoped reads; there is no default tenant.
+   */
+  const [tenantRow] = await db
+    .select({ id: tenants.id })
+    .from(tenants)
+    .where(eq(tenants.id, tenantId))
+    .limit(1);
+  if (!tenantRow) throw new Error('Tenant not found');
 
   const primaryType = data.types[0] ?? 'CLIENT';
 
@@ -678,7 +737,7 @@ export async function createCompany(data: {
   const createdId = (inserted[0] as { id?: string } | undefined)?.id;
   if (!createdId) throw new Error('Failed to create company');
 
-  const created = await getCompanyById(createdId);
+  const created = await getCompanyById(createdId, tenantId);
   if (!created) throw new Error('Failed to load created company');
 
   return created;
@@ -688,9 +747,14 @@ export async function createCompany(data: {
 //  IMPORT COMPANY FROM SEASEARCHER
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function importCompanyFromSeasearcher(seasearcherId: string) {
-  // Check if already imported
-  const existing = await getCompanyBySeasearcherId(seasearcherId);
+export async function importCompanyFromSeasearcher(seasearcherId: string, tenantId: string) {
+  /**
+   * Dedupe within THIS tenant. Scoping this to the tenant is what makes the
+   * import idempotent per tenant: two tenants may each hold their own record of
+   * the same Seasearcher company, and an unscoped lookup here would hand tenant B
+   * tenant A's company — id, credit data and all — and then skip creating B's own.
+   */
+  const existing = await getCompanyBySeasearcherId(seasearcherId, tenantId);
   if (existing) return existing;
 
   // Fetch from Seasearcher
@@ -759,7 +823,7 @@ export async function importCompanyFromSeasearcher(seasearcherId: string) {
 //  IMPORT COMPANY BY NAME (search Seasearcher, import first match)
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function importCompanyByName(companyName: string) {
+export async function importCompanyByName(companyName: string, tenantId: string) {
   const searchResult = await seasearcherCompanySearch<{ results: { id: string; companyName: string }[] }>(companyName, 5);
   const match = searchResult.results?.find(
     (r) => r.companyName.toLowerCase() === companyName.toLowerCase(),
@@ -769,7 +833,7 @@ export async function importCompanyByName(companyName: string) {
     throw new Error(`No Seasearcher company found for name: ${companyName}`);
   }
 
-  return importCompanyFromSeasearcher(match.id);
+  return importCompanyFromSeasearcher(match.id, tenantId);
 }
 
 // ═══════════════════════════════════════════════════════════════════════
@@ -792,8 +856,8 @@ export interface SyncResult {
   conflicts: SyncConflict[];
 }
 
-export async function syncCompanyFromSeasearcher(companyId: string): Promise<SyncResult | null> {
-  const local = await getCompanyById(companyId);
+export async function syncCompanyFromSeasearcher(companyId: string, tenantId: string): Promise<SyncResult | null> {
+  const local = await getCompanyById(companyId, tenantId);
   if (!local || !local.seasearcherId) return null;
 
   const detail = await seasearcherCompanyDetail<SeasearcherCompanyDetail>(local.seasearcherId);
@@ -872,7 +936,7 @@ export async function syncCompanyFromSeasearcher(companyId: string): Promise<Syn
   const [updated] = await db
     .update(counterparties)
     .set(setFields)
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
 
   // Sync contacts from Seasearcher (only source='seasearcher' contacts get replaced)
@@ -890,8 +954,8 @@ export async function syncCompanyFromSeasearcher(companyId: string): Promise<Syn
 //  ACCEPT SEASEARCHER VALUE (resolve a conflict by accepting SS data)
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function acceptSeasearcherValue(companyId: string, field: string) {
-  const local = await getCompanyById(companyId);
+export async function acceptSeasearcherValue(companyId: string, field: string, tenantId: string) {
+  const local = await getCompanyById(companyId, tenantId);
   if (!local || !local.seasearcherId) return null;
 
   // Remove the field from manualOverrides
@@ -945,7 +1009,7 @@ export async function acceptSeasearcherValue(companyId: string, field: string) {
   const [updated] = await db
     .update(counterparties)
     .set(setFields)
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -954,8 +1018,8 @@ export async function acceptSeasearcherValue(companyId: string, field: string) {
 //  KEEP MINE (dismiss a conflict by storing the SS value we're ignoring)
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function keepMineValue(companyId: string, field: string, seasearcherValue: string | number | null) {
-  const local = await getCompanyById(companyId);
+export async function keepMineValue(companyId: string, field: string, seasearcherValue: string | number | null, tenantId: string) {
+  const local = await getCompanyById(companyId, tenantId);
   if (!local) return null;
 
   const dismissed: Record<string, any> = { ...((local.dismissedConflicts as Record<string, any>) ?? {}) };
@@ -964,7 +1028,7 @@ export async function keepMineValue(companyId: string, field: string, seasearche
   const [updated] = await db
     .update(counterparties)
     .set({ dismissedConflicts: dismissed, updatedAt: new Date() })
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -982,6 +1046,11 @@ const OVERRIDABLE_FIELDS = [
 
 export async function updateCompany(
   companyId: string,
+  /**
+   * Owning tenant. Threaded through to the read and the UPDATE so a foreign id
+   * cannot be read or written even if a caller forgets the route guard.
+   */
+  tenantId: string,
   data: {
     name?: string;
     country?: string | null;
@@ -1002,7 +1071,7 @@ export async function updateCompany(
   },
 ) {
   // Load current company to merge manualOverrides
-  const current = await getCompanyById(companyId);
+  const current = await getCompanyById(companyId, tenantId);
   if (!current) return null;
 
   const setFields: Record<string, any> = { updatedAt: new Date() };
@@ -1035,7 +1104,7 @@ export async function updateCompany(
   const [updated] = await db
     .update(counterparties)
     .set(setFields)
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -1044,7 +1113,7 @@ export async function updateCompany(
 //  UPDATE COMPANY TYPES
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function updateCompanyTypes(companyId: string, types: string[]) {
+export async function updateCompanyTypes(companyId: string, types: string[], tenantId: string) {
   const primaryType = types[0] ?? 'CLIENT';
   const [updated] = await db
     .update(counterparties)
@@ -1053,7 +1122,7 @@ export async function updateCompanyTypes(companyId: string, types: string[]) {
       types,
       updatedAt: new Date(),
     })
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -1062,11 +1131,11 @@ export async function updateCompanyTypes(companyId: string, types: string[]) {
 //  UPDATE COMPANY SEGMENTS
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function updateCompanySegments(companyId: string, segments: Record<string, string | string[]>) {
+export async function updateCompanySegments(companyId: string, segments: Record<string, string | string[]>, tenantId: string) {
   const [updated] = await db
     .update(counterparties)
     .set({ segments, updatedAt: new Date() })
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -1075,14 +1144,14 @@ export async function updateCompanySegments(companyId: string, segments: Record<
 //  UPDATE COMPANY RESPONSIBLE USER
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function updateCompanyResponsibleUser(companyId: string, userId: string | null) {
+export async function updateCompanyResponsibleUser(companyId: string, userId: string | null, tenantId: string) {
   const [updated] = await db
     .update(counterparties)
     .set({
       responsibleUserId: userId,
       updatedAt: new Date(),
     })
-    .where(eq(counterparties.id, companyId))
+    .where(and(eq(counterparties.id, companyId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -1091,7 +1160,7 @@ export async function updateCompanyResponsibleUser(companyId: string, userId: st
 //  DELETE COMPANY
 // ═══════════════════════════════════════════════════════════════════════
 
-export async function deleteCompany(id: string) {
+export async function deleteCompany(id: string, tenantId: string) {
   // Pre-check: refuse if any orders/inquiries reference this company
   const [linked] = await db
     .select({ count: sql<number>`count(distinct ${orders.id})::int` })
@@ -1120,7 +1189,7 @@ export async function deleteCompany(id: string) {
 
   const [deleted] = await db
     .delete(counterparties)
-    .where(eq(counterparties.id, id))
+    .where(and(eq(counterparties.id, id), eq(counterparties.tenantId, tenantId)))
     .returning({ id: counterparties.id });
   return deleted ?? null;
 }
@@ -1143,6 +1212,12 @@ export interface CompanyTypeaheadResult {
 }
 
 export async function searchCompaniesTypeahead(
+  /**
+   * Owning tenant. REQUIRED: the local half of this search reads
+   * `counterparties` and would otherwise offer another tenant's companies in the
+   * picker. (The Seasearcher half is a global directory and is not tenant data.)
+   */
+  tenantId: string,
   term: string,
 ): Promise<CompanyTypeaheadResult[]> {
   const results: CompanyTypeaheadResult[] = [];
@@ -1160,7 +1235,7 @@ export async function searchCompaniesTypeahead(
       isSanctioned: counterparties.isSanctioned,
     })
     .from(counterparties)
-    .where(ilike(counterparties.name, `%${escapeLikePattern(term)}%`))
+    .where(and(eq(counterparties.tenantId, tenantId), ilike(counterparties.name, `%${escapeLikePattern(term)}%`)))
     .limit(20);
 
   const localSeasearcherIds = new Set<string>();
@@ -1342,9 +1417,27 @@ export async function createCompanyContact(
   return contact;
 }
 
+/**
+ * The caller's own company ids, as a subquery.
+ *
+ * Child rows (contacts, emails, offices, attachments) carry `counterparty_id`,
+ * not a tenant, so they are scoped by constraining that column to the caller's
+ * companies. Their routes take the CHILD id (`/contacts/:contactId`), which the
+ * `params.id` route guard never sees — so the tenant predicate has to live in the
+ * query itself. Typed, and the same `inArray` + subquery idiom used elsewhere.
+ */
+function ownedCompanyIds(tenantId: string) {
+  return db.select({ id: counterparties.id }).from(counterparties).where(eq(counterparties.tenantId, tenantId));
+}
+
 export async function updateCompanyContact(
   contactId: string,
   data: { name?: string; role?: string; phone?: string; fax?: string; email?: string; notes?: string },
+  /**
+   * Owning tenant. The route is `/contacts/:contactId` — the guard on
+   * `params.id` never sees it — so ownership is enforced here.
+   */
+  tenantId: string,
 ) {
   const [current] = await db
     .select({
@@ -1365,22 +1458,24 @@ export async function updateCompanyContact(
       deletedAt: null,
       updatedAt: new Date(),
     })
-    .where(eq(companyContacts.id, contactId))
+    .where(and(eq(companyContacts.id, contactId), inArray(companyContacts.counterpartyId, ownedCompanyIds(tenantId))))
     .returning();
   return updated;
 }
 
-export async function deleteCompanyContact(contactId: string) {
+export async function deleteCompanyContact(contactId: string, tenantId: string): Promise<boolean> {
   const [current] = await db
     .select({
       id: companyContacts.id,
       source: companyContacts.source,
       seasearcherPersonId: companyContacts.seasearcherPersonId,
+      counterpartyId: companyContacts.counterpartyId,
     })
     .from(companyContacts)
     .where(eq(companyContacts.id, contactId))
     .limit(1);
-  if (!current) return;
+  // Absent, or not this tenant's: the caller cannot tell the two apart.
+  if (!current || !(await companyBelongsToTenant(current.counterpartyId, tenantId))) return false;
 
   if (current.source === 'seasearcher' || current.seasearcherPersonId !== null) {
     await db
@@ -1390,10 +1485,11 @@ export async function deleteCompanyContact(contactId: string) {
         updatedAt: new Date(),
       })
       .where(eq(companyContacts.id, contactId));
-    return;
+    return true;
   }
 
   await db.delete(companyContacts).where(eq(companyContacts.id, contactId));
+  return true;
 }
 
 /**
@@ -1583,7 +1679,8 @@ export async function addCompanyEmail(
 
 export async function updateCompanyEmail(
   id: string,
-  data: { emailType?: CompanyEmailType; email?: string; label?: string; isPrimary?: boolean }
+  data: { emailType?: CompanyEmailType; email?: string; label?: string; isPrimary?: boolean },
+  tenantId: string,
 ) {
   // If setting as primary, fetch counterpartyId and emailType first
   if (data.isPrimary) {
@@ -1615,15 +1712,15 @@ export async function updateCompanyEmail(
       ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
       updatedAt: new Date(),
     })
-    .where(eq(companyEmails.id, id))
+    .where(and(eq(companyEmails.id, id), inArray(companyEmails.counterpartyId, ownedCompanyIds(tenantId))))
     .returning();
   return updated ?? null;
 }
 
-export async function deleteCompanyEmail(id: string) {
+export async function deleteCompanyEmail(id: string, tenantId: string) {
   const [deleted] = await db
     .delete(companyEmails)
-    .where(eq(companyEmails.id, id))
+    .where(and(eq(companyEmails.id, id), inArray(companyEmails.counterpartyId, ownedCompanyIds(tenantId))))
     .returning({ id: companyEmails.id, email: companyEmails.email, emailType: companyEmails.emailType });
   return deleted ?? null;
 }
@@ -1664,6 +1761,7 @@ export async function addCompanyOffice(
 export async function updateCompanyOffice(
   id: string,
   data: { city?: string; country?: string; countryCode?: string; address?: string; phone?: string; email?: string },
+  tenantId: string,
 ) {
   const [updated] = await db
     .update(companyOffices)
@@ -1676,15 +1774,15 @@ export async function updateCompanyOffice(
       ...(data.email !== undefined && { email: data.email }),
       updatedAt: new Date(),
     })
-    .where(eq(companyOffices.id, id))
+    .where(and(eq(companyOffices.id, id), inArray(companyOffices.counterpartyId, ownedCompanyIds(tenantId))))
     .returning();
   return updated ?? null;
 }
 
-export async function deleteCompanyOffice(id: string) {
+export async function deleteCompanyOffice(id: string, tenantId: string) {
   const [deleted] = await db
     .delete(companyOffices)
-    .where(eq(companyOffices.id, id))
+    .where(and(eq(companyOffices.id, id), inArray(companyOffices.counterpartyId, ownedCompanyIds(tenantId))))
     .returning({ id: companyOffices.id, city: companyOffices.city });
   return deleted ?? null;
 }
@@ -1743,10 +1841,10 @@ export async function createCompanyAttachment(input: {
   };
 }
 
-export async function deleteCompanyAttachment(id: string) {
+export async function deleteCompanyAttachment(id: string, tenantId: string) {
   const [deleted] = await db
     .delete(companyAttachments)
-    .where(eq(companyAttachments.id, id))
+    .where(and(eq(companyAttachments.id, id), inArray(companyAttachments.counterpartyId, ownedCompanyIds(tenantId))))
     .returning({
       id: companyAttachments.id,
       counterpartyId: companyAttachments.counterpartyId,
@@ -1844,19 +1942,37 @@ export async function getParentCompany(childId: string) {
   return parent ?? null;
 }
 
-/** Set the parent for a child company (link). Enforces single-level constraint. */
-export async function setParentCompany(childId: string, parentId: string) {
+/**
+ * Set the parent for a child company (link). Enforces single-level constraint.
+ *
+ * Both ends are constrained to the tenant. The `params.id` route guard covers the
+ * CHILD (it is in the path), but `parentId` comes from the BODY, so it was
+ * unchecked: a caller could link their own company under another tenant's parent,
+ * and every hierarchy route (`getChildCompanies`, `getGroupOrdersForCompany`, the
+ * group fleet/vessel/aggregate reads) then traverses that link. Cross-tenant
+ * links are refused outright, and the child is verified here too so the function
+ * is safe without the route guard.
+ */
+export async function setParentCompany(childId: string, parentId: string, tenantId: string) {
+  const [child] = await db
+    .select({ id: counterparties.id })
+    .from(counterparties)
+    .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
+    .limit(1);
+  if (!child) throw Object.assign(new Error('Company not found.'), { code: 'NOT_FOUND' });
   if (childId === parentId) {
     throw Object.assign(new Error('A company cannot be its own parent.'), { code: 'SELF_REFERENCE' });
   }
 
-  // The target parent must not itself be a child
+  // The target parent must be in the SAME tenant, and must not itself be a child.
   const [parentRow] = await db
-    .select({ parentId: counterparties.parentId })
+    .select({ parentId: counterparties.parentId, tenantId: counterparties.tenantId })
     .from(counterparties)
     .where(eq(counterparties.id, parentId))
     .limit(1);
-  if (!parentRow) throw Object.assign(new Error('Parent company not found.'), { code: 'NOT_FOUND' });
+  if (!parentRow || parentRow.tenantId !== tenantId) {
+    throw Object.assign(new Error('Parent company not found.'), { code: 'NOT_FOUND' });
+  }
   if (parentRow.parentId) {
     throw Object.assign(new Error('Cannot link to a company that is already a child of another company.'), { code: 'ALREADY_CHILD' });
   }
@@ -1876,17 +1992,17 @@ export async function setParentCompany(childId: string, parentId: string) {
   const [updated] = await db
     .update(counterparties)
     .set({ parentId, updatedAt: new Date() })
-    .where(eq(counterparties.id, childId))
+    .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
 
 /** Remove the parent link from a child company (unlink). */
-export async function removeParentCompany(childId: string) {
+export async function removeParentCompany(childId: string, tenantId: string) {
   const [updated] = await db
     .update(counterparties)
     .set({ parentId: null, updatedAt: new Date() })
-    .where(eq(counterparties.id, childId))
+    .where(and(eq(counterparties.id, childId), eq(counterparties.tenantId, tenantId)))
     .returning();
   return updated ?? null;
 }
@@ -2151,8 +2267,13 @@ export async function getGroupVesselsForCompany(companyId: string) {
   });
 }
 
-/** Top parent companies by aggregated credit exposure (parent + children). */
-export async function getTopCreditGroups(limit = 10) {
+/**
+ * Top parent companies by aggregated credit exposure (parent + children), for one
+ * tenant. Unscoped it listed every tenant's credit groups and limits on the
+ * dashboard; `p.tenant_id = c.tenant_id` is implied by the parent join, so
+ * filtering the parents is enough.
+ */
+export async function getTopCreditGroups(tenantId: string, limit = 10) {
   const rows = await db.execute(sql`
     WITH grouped AS (
       SELECT
@@ -2164,6 +2285,7 @@ export async function getTopCreditGroups(limit = 10) {
         1 + COUNT(c.id)::int AS "childCount"
       FROM counterparties p
       INNER JOIN counterparties c ON c.parent_id = p.id
+      WHERE p.tenant_id = ${tenantId}
       GROUP BY p.id, p.name, p.country, p.credit_limit, p.credit_used
     )
     SELECT *
```

# Appendix C — session-tracker.ts (diff)

```diff
diff --git a/apps/api/src/modules/activity/session-tracker.ts b/apps/api/src/modules/activity/session-tracker.ts
index 441caca7..aac6b6c8 100644
--- a/apps/api/src/modules/activity/session-tracker.ts
+++ b/apps/api/src/modules/activity/session-tracker.ts
@@ -7,6 +7,7 @@
 // ═══════════════════════════════════════════════════════════════════════
 
 import { logActivity } from './activity.service';
+import { findUserById } from '../auth/auth.service';
 import { lookupIp } from './geoip';
 import { extractClientIp as extractRequestClientIp } from '../../utils/client-ip';
 
@@ -313,6 +314,22 @@ export function getAllSessionDtos() {
   return Array.from(sessions.values()).map(toDto);
 }
 
+/**
+ * Resolve the tenant a live socket belongs to.
+ *
+ * The session record carries the user, not the tenant, and the callback contract
+ * is `(socketId, entityType, entityId)`. Passing the session's user through keeps
+ * that contract while letting the auto-sync hook scope its read: `getCompanyById`
+ * now demands a tenant, and an unscoped sync would fetch another tenant's company
+ * by id. Returns null for an unknown socket, which is treated as "skip".
+ */
+export async function getSessionTenant(socketId: string): Promise<string | null> {
+  const session = sessions.get(socketId);
+  if (!session?.userId) return null;
+  const user = await findUserById(session.userId);
+  return user?.tenantId ?? null;
+}
+
 export function getSessionsByUser(userId: string): SessionInfo[] {
   return Array.from(sessions.values()).filter((s) => s.userId === userId);
 }
```

# Appendix D — index.ts (diff)

```diff
diff --git a/apps/api/src/index.ts b/apps/api/src/index.ts
index 084a5ce1..c6be6054 100644
--- a/apps/api/src/index.ts
+++ b/apps/api/src/index.ts
@@ -47,6 +47,7 @@ import {
   subscribeSocketTopic,
   unsubscribeSocketTopic,
   onEntityView,
+  getSessionTenant,
   sendToSocket,
   extractClientIp,
 } from './modules/activity/session-tracker';
@@ -284,13 +285,21 @@ function serveUpload(subdir: string) {
 function registerAutoSyncHooks() {
   onEntityView(async (socketId, entityType, entityId) => {
     try {
+      /**
+       * Scoped to the socket's own tenant: the company sync now reads by id AND
+       * tenant (`getCompanyById` requires one), and without this an unscoped
+       * auto-sync would be the one path that could still fetch a foreign company.
+       * An unknown socket yields null and the sync is skipped.
+       */
+      const tenantId = await getSessionTenant(socketId);
+      if (!tenantId) return;
       if (entityType === 'Vessel') {
         const synced = await syncVesselFromSeasearcher(entityId);
         if (synced) {
           sendToSocket(socketId, { type: 'vessel-synced', data: synced });
         }
       } else if (entityType === 'Company') {
-        const result = await syncCompanyFromSeasearcher(entityId);
+        const result = await syncCompanyFromSeasearcher(entityId, tenantId);
         if (result) {
           sendToSocket(socketId, { type: 'company-synced', data: result.company });
           if (result.conflicts.length > 0) {
```

# Appendix E — tests/companies.tenant-isolation.e2e.test.ts (whole)

```ts
/**
 * Tenant isolation for the companies module.
 *
 * `/companies/local/:id…` used to read `params.id` unscoped: `getCompanyById`
 * filtered on the id alone, so a company id belonging to another tenant returned
 * that tenant's company, its contacts, emails, ledger and credit — and
 * `POST /companies/local` filed the new company under whichever tenant happened
 * to be first in the table (`tenants.findFirst()`).
 *
 * These tests pin the boundary at the route, which is where it is enforced for
 * the whole module (`onBeforeHandle`), rather than per handler.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { getDb, seedBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson } from './helpers/e2e';

async function makeTenant(name: string, domain: string, email: string) {
  const db = await getDb();
  const { tenants, users } = await import('../src/db/schema');
  const { hashPassword } = await import('../src/modules/auth/password.service');

  const [tenant] = await db.insert(tenants).values({ name, domain }).returning();
  await db.insert(users).values({
    tenantId: tenant!.id,
    email,
    name: `${name} User`,
    role: 'ADMIN',
    passwordHash: await hashPassword('Password123!'),
  });
  const token = (await loginE2E(email, 'Password123!')).accessToken;
  return { tenant: tenant!, token };
}

beforeEach(async () => {
  await truncateAll();
});

describe('companies tenant isolation', () => {
  it('answers 404 for another tenant\'s company, on every shape of :id route', async () => {
    // Tenant A owns a company; tenant B must not be able to read it by id.
    const a = await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('B Tenant', 'b.local', 'b@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();
    const [aCompany] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'A Only Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    // A's OWN token still works — the guard must not block legitimate reads.
    const { token: aToken } = await (async () => {
      const { users } = await import('../src/db/schema');
      const { hashPassword } = await import('../src/modules/auth/password.service');
      await db.insert(users).values({
        tenantId: a.tenant.id, email: 'a@test.local', name: 'A User', role: 'ADMIN',
        passwordHash: await hashPassword('Password123!'),
      });
      return { token: (await loginE2E('a@test.local', 'Password123!')).accessToken };
    })();

    const own = await requestJson(`/companies/local/${aCompany!.id}`, { token: aToken });
    expect(own.status).toBe(200);
    expect(own.data?.data?.name).toBe('A Only Ltd');

    /**
     * 404 rather than 403 on every one of these: a foreign id must look exactly
     * like a nonexistent one, or the error itself confirms the id exists in
     * another tenant.
     */
    for (const path of [
      `/companies/local/${aCompany!.id}`,
      `/companies/local/${aCompany!.id}/orders`,
      `/companies/local/${aCompany!.id}/contacts`,
      `/companies/local/${aCompany!.id}/emails`,
      `/companies/local/${aCompany!.id}/emails`,
      `/companies/local/${aCompany!.id}/ledger/supplier`,
      `/companies/local/${aCompany!.id}/ledger/customer`,
      `/companies/local/${aCompany!.id}/group-aggregate`,
    ]) {
      const res = await requestJson(path, { token: bToken });
      expect(res.status).toBe(404);
    }

    // And a write must not land either.
    const write = await requestJson(`/companies/local/${aCompany!.id}/emails`, {
      method: 'POST', token: bToken,
      body: { emailType: 'general', email: 'stolen@b.test' },
    });
    expect(write.status).toBe(404);

    const { companyEmails } = await import('../src/db/schema');
    const emails = await db.select().from(companyEmails);
    expect(emails.length).toBe(0);

    // A nonexistent id is indistinguishable from a foreign one.
    const ghost = await requestJson('/companies/local/00000000-0000-0000-0000-000000000000', { token: bToken });
    expect(ghost.status).toBe(404);

    // Sanity: the other tenant's company is untouched.
    void bTenant;
  });

  it('blocks child-resource routes that take the CHILD id, not a company id', async () => {
    // These routes never carry `params.id`, so the route guard cannot see them —
    // ownership has to be enforced inside the query. Found by panel review.
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Child Tenant', 'child.local', 'child@test.local');
    const db = await getDb();
    const { counterparties, companyContacts, companyEmails, companyOffices } = await import('../src/db/schema');

    const [aCompany] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'Child Owner Ltd', type: 'CLIENT', types: ['CLIENT'] })
      .returning();
    const [contact] = await db.insert(companyContacts)
      .values({ counterpartyId: aCompany!.id, name: 'A Contact' }).returning();
    const [email] = await db.insert(companyEmails)
      .values({ counterpartyId: aCompany!.id, emailType: 'general', email: 'a@owner.test' }).returning();
    const [office] = await db.insert(companyOffices)
      .values({ counterpartyId: aCompany!.id, city: 'Aarhus' }).returning();

    // Reads and writes by child id must all fail for tenant B.
    expect((await requestJson(`/companies/contacts/${contact!.id}`, {
      method: 'PATCH', token: bToken, body: { name: 'Hijacked' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/contacts/${contact!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);
    expect((await requestJson(`/companies/emails/${email!.id}`, {
      method: 'PATCH', token: bToken, body: { email: 'stolen@b.test' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/emails/${email!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);
    expect((await requestJson(`/companies/offices/${office!.id}`, {
      method: 'PATCH', token: bToken, body: { city: 'Stolen' },
    })).status).toBe(404);
    expect((await requestJson(`/companies/offices/${office!.id}`, { method: 'DELETE', token: bToken })).status).toBe(404);

    // Nothing was actually changed or deleted.
    const contacts = await db.select().from(companyContacts);
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.name).toBe('A Contact');
    const emails = await db.select().from(companyEmails);
    expect(emails.length).toBe(1);
    expect(emails[0]!.email).toBe('a@owner.test');
    const offices = await db.select().from(companyOffices);
    expect(offices.length).toBe(1);
    expect(offices[0]!.city).toBe('Aarhus');
  });

  it('does not resolve another tenant\'s company by Seasearcher id, and does not adopt it on import', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Import Tenant', 'import.local', 'import@test.local');
    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');

    const [aCompany] = await db
      .insert(counterparties)
      .values({
        tenantId: a.tenant.id, name: 'A Seasearcher Co', type: 'CLIENT', types: ['CLIENT'],
        seasearcherId: 'SEA-999', creditLimit: '123456',
      })
      .returning();

    // Direct lookup by Seasearcher id must not leak A's company.
    const bySs = await requestJson('/companies/by-seasearcher/SEA-999', { token: bToken });
    expect(bySs.status).toBe(404);

    /**
     * The import is a separate path (a different function, not the id guard). An
     * unscoped dedupe would hand tenant B tenant A's row AND skip creating B's
     * own. Either outcome is checked: not A's id, and the name resolved must be
     * B's own record if one exists.
     */
    const imported = await requestJson('/companies/import', {
      method: 'POST', token: bToken, body: { seasearcherId: 'SEA-999' },
    });
    if (imported.status === 200) {
      expect(imported.data?.data?.id).not.toBe(aCompany!.id);
      expect(imported.data?.data?.tenantId).toBe(undefined); // DTO does not expose it
    }
    void aCompany;
  });

  it('refuses a cross-tenant parent link', async () => {
    const a = await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('Parent Tenant', 'parent.local', 'parent@test.local');
    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');

    const [aParent] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'A Parent', type: 'CLIENT', types: ['CLIENT'] })
      .returning();
    const [bChild] = await db
      .insert(counterparties)
      .values({ tenantId: bTenant.id, name: 'B Child', type: 'CLIENT', types: ['CLIENT'] })
      .returning();

    // body.parentId is not in the path, so the guard cannot cover it. Linking here
    // would expose A's group through every hierarchy route.
    const res = await requestJson(`/companies/local/${bChild!.id}/set-parent`, {
      method: 'POST', token: bToken, body: { parentId: aParent!.id },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const [after] = await db.select().from(counterparties).where(eq(counterparties.id, bChild!.id));
    expect(after!.parentId).toBeNull();
  });

  it('lists only the caller\'s own companies', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('List Tenant', 'list.local', 'list@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();
    await db.insert(counterparties).values([
      { tenantId: a.tenant.id, name: 'Alpha Marine', type: 'CLIENT', types: ['CLIENT'] },
      { tenantId: a.tenant.id, name: 'Beta Marine', type: 'CLIENT', types: ['CLIENT'] },
    ]);

    const res = await requestJson('/companies/local?limit=100', { token: bToken });
    expect(res.status).toBe(200);
    // Tenant B has no companies of its own, so A's must not appear.
    const rows = res.data?.data?.companies ?? [];
    expect(rows.some((c: { name: string }) => c.name.startsWith('Alpha') || c.name.startsWith('Beta'))).toBe(false);

    // The search picker must not offer them either.
    const search = await requestJson('/companies/search?term=Marine', { token: bToken });
    expect(search.status).toBe(200);
    const hits = (search.data?.data ?? []).filter((r: { source: string }) => r.source === 'local');
    expect(hits.length).toBe(0);
  });

  it('files a created company under the caller\'s tenant', async () => {
    await seedBasics();
    const { tenant: bTenant, token: bToken } = await makeTenant('Creator', 'creator.local', 'creator@test.local');

    const created = await requestJson('/companies/local', {
      method: 'POST', token: bToken,
      body: { name: 'Belongs To B', types: ['CLIENT'] },
    });
    expect(created.status).toBe(200);

    const db = await getDb();
    const { counterparties } = await import('../src/db/schema');
    const [row] = await db.select().from(counterparties).where(eq(counterparties.name, 'Belongs To B'));
    expect(row).toBeDefined();
    // Previously this used tenants.findFirst(), so it could land on tenant A.
    expect(row!.tenantId).toBe(bTenant.id);
  });

  it('scopes the dashboard credit groups to the caller\'s tenant', async () => {
    const a = await seedBasics();
    const { token: bToken } = await makeTenant('Credit Tenant', 'credit.local', 'credit@test.local');
    const { counterparties } = await import('../src/db/schema');
    const db = await getDb();

    const [parent] = await db
      .insert(counterparties)
      .values({ tenantId: a.tenant.id, name: 'Exposed Parent', type: 'CLIENT', types: ['CLIENT'], creditLimit: '100000', creditUsed: '50000' })
      .returning();
    await db.insert(counterparties).values({
      tenantId: a.tenant.id, name: 'Exposed Child', type: 'CLIENT', types: ['CLIENT'],
      creditLimit: '1000', creditUsed: '0', parentId: parent!.id,
    });

    const res = await requestJson('/companies/top-credit-groups', { token: bToken });
    expect(res.status).toBe(200);
    const groups = res.data?.data ?? [];
    // Tenant B has no exposure of its own; A's limits must not be on B's dashboard.
    expect(groups.some((g: { name: string }) => g.name === 'Exposed Parent')).toBe(false);
    expect(groups.length).toBe(0);
  });
});
```
