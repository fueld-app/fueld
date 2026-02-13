// ═══════════════════════════════════════════════════════════════════════
//  Vessels Controller
//
//  GET    /vessels/local?search=...&page=...&limit=...
//  GET    /vessels/local/:id
//  GET    /vessels/local/:id/orders
//  POST   /vessels/local/match
//  GET    /vessels/search?term=...
//  GET    /vessels/enrichment/:seasearcherId
//  GET    /vessels/by-seasearcher/:seasearcherId
//  POST   /vessels/local
//  POST   /vessels/import  { seasearcherId }
//  POST   /vessels/local/:id/sync
//  POST   /vessels/local/:id/merge  { seasearcherId }
//  GET    /vessels/seasearcher-lookup?imo=...
//  PATCH  /vessels/local/:id
//  DELETE /vessels/local/:id
// ═══════════════════════════════════════════════════════════════════════

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { users, vessels as vesselsTable } from '../../db/schema';
import { authGuard } from '../auth/auth.guard';
import {
  listVessels,
  getVesselById,
  getVesselBySeasearcherId,
  matchLocalVessels,
  createVessel,
  updateVessel,
  importVesselFromSeasearcher,
  syncVesselFromSeasearcher,
  deleteVessel,
  lookupSeasearcherByImo,
  mergeWithSeasearcher,
  searchVesselsTypeahead,
  getVesselEnrichment,
  getOrdersForVessel,
  getVesselMovements,
  getVesselCompanies,
  addVesselCompany,
  updateVesselCompany,
  deleteVesselCompany,
} from './vessel.service';
import type { ApiResponse, VesselCompanyRole } from '@fueld/types';

export const vesselsController = new Elysia({ prefix: '/vessels' })
  .use(authGuard)

  // ─── List Vessels (local, paginated) ───────────────────────────────
  .get(
    '/local',
    async ({ query }) => {
      const results = await listVessels({
        search: query.search,
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'List vessels from local database',
      },
    },
  )

  // ─── Get Single Vessel ─────────────────────────────────────────────
  .get(
    '/local/:id',
    async ({ params }) => {
      const vessel = await getVesselById(params.id);
      if (!vessel) {
        return { success: false, data: null, message: 'Vessel not found' };
      }
      return { success: true, data: vessel } satisfies ApiResponse<typeof vessel>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Get a single vessel by local ID',
      },
    },
  )

  // ─── Orders for a Vessel ───────────────────────────────────────────
  .get(
    '/local/:id/orders',
    async ({ params }) => {
      try {
        const orders = await getOrdersForVessel(params.id);
        return { success: true, data: orders } satisfies ApiResponse<typeof orders>;
      } catch (err) {
        console.error('[Vessels] Failed to load orders for vessel:', err);
        return { success: false, data: [], message: 'Failed to load orders' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Get orders for a vessel',
      },
    },
  )

  // ─── Typeahead Search (local + Seasearcher) ────────────────────────
  .get(
    '/search',
    async ({ query }) => {
      const term = query.term?.trim();
      if (!term || term.length < 2) {
        return { success: true, data: [] } satisfies ApiResponse<never[]>;
      }
      const results = await searchVesselsTypeahead(term);
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        term: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Search vessels (local + Seasearcher)',
      },
    },
  )

  // ─── Enrichment (raw Seasearcher detail) ───────────────────────────
  .get(
    '/enrichment/:seasearcherId',
    async ({ params }) => {
      try {
        const data = await getVesselEnrichment(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err: any) {
        console.error('[Vessels] Enrichment failed:', err.message);
        return { success: false, data: null, message: err.message };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Get raw vessel data from Seasearcher',
      },
    },
  )

  // ─── Find by Seasearcher ID ────────────────────────────────────────
  .get(
    '/by-seasearcher/:seasearcherId',
    async ({ params }) => {
      const vessel = await getVesselBySeasearcherId(params.seasearcherId);
      return { success: true, data: vessel } satisfies ApiResponse<typeof vessel>;
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Find local vessel by Seasearcher ID',
      },
    },
  )

  // ─── Match Local Vessels (batch) ───────────────────────────────────
  .post(
    '/local/match',
    async ({ body }) => {
      const vessels = await matchLocalVessels({
        seasearcherIds: body.seasearcherIds,
        imos: body.imos,
      });
      return { success: true, data: vessels } satisfies ApiResponse<typeof vessels>;
    },
    {
      body: t.Object({
        seasearcherIds: t.Optional(t.Array(t.String())),
        imos: t.Optional(t.Array(t.String())),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Match local vessels by Seasearcher ID or IMO',
      },
    },
  )

  // ─── Create Vessel (manual) ────────────────────────────────────────
  .post(
    '/local',
    async ({ body }) => {
      try {
        const created = await createVessel(body);
        return { success: true, data: created } satisfies ApiResponse<typeof created>;
      } catch (err: any) {
        console.error('[Vessels] Create failed:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to create vessel' };
      }
    },
    {
      body: t.Object({
        name: t.String(),
        imo: t.Optional(t.String()),
        mmsi: t.Optional(t.String()),
        flag: t.Optional(t.String()),
        flagCode: t.Optional(t.String()),
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
        loa: t.Optional(t.Number()),
        breadth: t.Optional(t.Number()),
        depth: t.Optional(t.Number()),
        draught: t.Optional(t.Number()),
        deadWeightTonnage: t.Optional(t.Number()),
        grossTonnage: t.Optional(t.Number()),
        buildYear: t.Optional(t.Number()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Create a vessel manually',
      },
    },
  )

  // ─── Import from Seasearcher ───────────────────────────────────────
  .post(
    '/import',
    async ({ body }) => {
      try {
        const imported = await importVesselFromSeasearcher(body.seasearcherId);
        return { success: true, data: imported } satisfies ApiResponse<typeof imported>;
      } catch (err: any) {
        console.error('[Vessels] Import failed:', err);
        return { success: false, data: null, message: err.message ?? 'Import failed' };
      }
    },
    {
      body: t.Object({
        seasearcherId: t.String(),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Import vessel from Seasearcher',
      },
    },
  )

  // ─── Sync from Seasearcher ─────────────────────────────────────────
  .post(
    '/local/:id/sync',
    async ({ params }) => {
      try {
        const synced = await syncVesselFromSeasearcher(params.id);
        if (!synced) {
          return { success: false, data: null, message: 'Vessel not found or no Seasearcher ID' };
        }
        return { success: true, data: synced } satisfies ApiResponse<typeof synced>;
      } catch (err: any) {
        console.error('[Vessels] Sync failed:', err);
        return { success: false, data: null, message: err.message ?? 'Sync failed' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Sync vessel data from Seasearcher',
      },
    },
  )

  // ─── Lookup Seasearcher by IMO ──────────────────────────────────────
  .get(
    '/seasearcher-lookup',
    async ({ query }) => {
      if (!query.imo || query.imo.length < 5) {
        return { success: false, data: null, message: 'IMO is required (min 5 chars)' };
      }
      try {
        const match = await lookupSeasearcherByImo(query.imo);
        return { success: true, data: match } satisfies ApiResponse<typeof match>;
      } catch (err: any) {
        return { success: false, data: null, message: err.message ?? 'Lookup failed' };
      }
    },
    {
      query: t.Object({
        imo: t.String(),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Check if a vessel exists in Seasearcher by IMO',
      },
    },
  )

  // ─── Merge Manual Vessel with Seasearcher ──────────────────────────
  .post(
    '/local/:id/merge',
    async ({ params, body }) => {
      try {
        const merged = await mergeWithSeasearcher(params.id, body.seasearcherId);
        if (!merged) {
          return { success: false, data: null, message: 'Vessel not found' };
        }
        return { success: true, data: merged } satisfies ApiResponse<typeof merged>;
      } catch (err: any) {
        console.error('[Vessels] Merge failed:', err);
        return { success: false, data: null, message: err.message ?? 'Merge failed' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        seasearcherId: t.String(),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Link a manually-created vessel to Seasearcher and sync data',
      },
    },
  )

  // ─── Update Vessel ─────────────────────────────────────────────────
  .patch(
    '/local/:id',
    async ({ params, body }) => {
      try {
        const updated = await updateVessel(params.id, body);
        if (!updated) {
          return { success: false, data: null, message: 'Vessel not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        console.error('[Vessels] Update failed:', err);
        return { success: false, data: null, message: err.message ?? 'Update failed' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String()),
        imo: t.Optional(t.String()),
        mmsi: t.Optional(t.String()),
        flag: t.Optional(t.String()),
        type: t.Optional(t.String()),
        status: t.Optional(t.String()),
        loa: t.Optional(t.Number()),
        breadth: t.Optional(t.Number()),
        depth: t.Optional(t.Number()),
        draught: t.Optional(t.Number()),
        deadWeightTonnage: t.Optional(t.Number()),
        grossTonnage: t.Optional(t.Number()),
        buildYear: t.Optional(t.Number()),
        builder: t.Optional(t.String()),
        classificationSociety: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Update vessel fields',
      },
    },
  )

  // ─── Delete Vessel ─────────────────────────────────────────────────
  .delete(
    '/local/:id',
    async ({ params, auth, set }) => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Only admins can delete vessels' };
      }
      try {
        const deleted = await deleteVessel(params.id);
        if (!deleted) {
          return { success: false, data: null, message: 'Vessel not found' };
        }
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err: any) {
        const isFkError = err.message?.includes('violates foreign key');
        return {
          success: false,
          data: null,
          message: isFkError
            ? 'Cannot delete vessel with existing orders'
            : (err.message ?? 'Failed to delete'),
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Delete a vessel',
      },
    },
  )

  // ─── Vessel Movements (port calls from Seasearcher) ────────────────
  .get(
    '/movements/:seasearcherId',
    async ({ params }) => {
      try {
        const movements = await getVesselMovements(params.seasearcherId);
        return { success: true, data: movements } satisfies ApiResponse<typeof movements>;
      } catch (err: any) {
        console.error('[Vessels] Movements failed:', err.message);
        return { success: false, data: [], message: err.message };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Get vessel port call movements from Seasearcher',
      },
    },
  )

  // ═══════════════════════════════════════════════════════════════════════
  //  VESSEL COMPANIES (user-managed company associations)
  // ═══════════════════════════════════════════════════════════════════════

  // ─── List Companies for a Vessel ───────────────────────────────────
  .get(
    '/local/:id/companies',
    async ({ params }) => {
      try {
        const companies = await getVesselCompanies(params.id);
        return { success: true, data: companies } satisfies ApiResponse<typeof companies>;
      } catch (err: any) {
        console.error('[Vessels] Failed to load companies:', err);
        return { success: false, data: [], message: 'Failed to load companies' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Get companies associated with a vessel',
      },
    },
  )

  // ─── Add Company to Vessel ─────────────────────────────────────────
  .post(
    '/local/:id/companies',
    async ({ params, body, auth }) => {
      try {
        // Look up user name for audit trail
        const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.sub)).limit(1);
        const company = await addVesselCompany(
          params.id,
          {
            companyId: body.companyId,
            role: body.role as VesselCompanyRole,
            contactId: body.contactId,
            note: body.note,
            replaceExistingRole: body.replaceExistingRole,
          },
          auth.sub,
          u?.name ?? auth.email,
        );
        return { success: true, data: company } satisfies ApiResponse<typeof company>;
      } catch (err: any) {
        console.error('[Vessels] Failed to add company:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to add company' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        companyId: t.String(),
        role: t.String(), // 'OWNER' | 'TIME_CHARTERER' | 'OPERATOR' | 'MANAGER'
        contactId: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.String()),
        replaceExistingRole: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Add a company association to a vessel',
      },
    },
  )

  // ─── Update Vessel Company ─────────────────────────────────────────
  .patch(
    '/local/:id/companies/:companyAssocId',
    async ({ params, body }) => {
      try {
        const updated = await updateVesselCompany(params.companyAssocId, {
          role: body.role as VesselCompanyRole | undefined,
          contactId: body.contactId,
          note: body.note,
        });
        if (!updated) {
          return { success: false, data: null, message: 'Company association not found' };
        }
        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err: any) {
        console.error('[Vessels] Failed to update company:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to update' };
      }
    },
    {
      params: t.Object({ id: t.String(), companyAssocId: t.String() }),
      body: t.Object({
        role: t.Optional(t.String()),
        contactId: t.Optional(t.Nullable(t.String())),
        note: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Vessels'],
        summary: 'Update a vessel company association',
      },
    },
  )

  // ─── Delete Vessel Company ─────────────────────────────────────────
  .delete(
    '/local/:id/companies/:companyAssocId',
    async ({ params }) => {
      try {
        const deleted = await deleteVesselCompany(params.companyAssocId);
        if (!deleted) {
          return { success: false, data: null, message: 'Company association not found' };
        }
        return { success: true, data: deleted } satisfies ApiResponse<typeof deleted>;
      } catch (err: any) {
        console.error('[Vessels] Failed to delete company:', err);
        return { success: false, data: null, message: err.message ?? 'Failed to delete' };
      }
    },
    {
      params: t.Object({ id: t.String(), companyAssocId: t.String() }),
      detail: {
        tags: ['Vessels'],
        summary: 'Remove a company association from a vessel',
      },
    },
  );
