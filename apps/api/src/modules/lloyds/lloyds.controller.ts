import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { searchVessels, searchPlaces, searchCompanies, importPlaceFromLli, listPlaces, getPlaceById, getPlaceByLliId, getPlaceEnrichment, createPlace, updateLocalPlace, updatePlaceOrderRemark, deletePlace, syncPlaceFromSeasearcher, getOrdersForPlace, getPortFacilities, getExpectedArrivals, getPortSuppliers, addPortSupplier, updatePortSupplier, deletePortSupplier, updateResponsibleUser, listActiveUsers, getSupplyPortsForCompany } from './lli.service';
import { buildStructuredActivityDiff } from '../activity/activity-diff';
import { logActivity } from '../activity/activity.service';
import { db } from '../../db';
import { users, places } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Controller
//  All routes are protected via authGuard.
//
//  GET /lloyds/vessels?imo=...&name=...&mmsi=...
//  GET /lloyds/places?name=...&country=...&placeType=...
//  GET /lloyds/places/local?search=...&country=...&placeType=...&page=...&limit=...
//  GET /lloyds/places/local/:id
//  GET /lloyds/places/enrichment/:seasearcherId
//  POST /lloyds/places/import   { lliPlaceId: number }
//  GET /lloyds/companies?name=...&country=...&imo=...
// ═══════════════════════════════════════════════════════════════════════

export const lloydsController = new Elysia({ prefix: '/lloyds' })
  .use(authGuard)

  // ─── Vessel Search ─────────────────────────────────────────────────
  .get(
    '/vessels',
    async ({ query }) => {
      const results = await searchVessels({
        imo: query.imo,
        name: query.name,
        mmsi: query.mmsi,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        imo: t.Optional(t.String()),
        name: t.Optional(t.String()),
        mmsi: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'Search vessels (local DB → LLI fallback)',
        description:
          'Search by IMO number, vessel name, or MMSI. ' +
          'Returns local DB matches first; falls back to Lloyd\'s List Intelligence if none found.',
      },
    },
  )

  // ─── Place Search (LLI) ───────────────────────────────────────────
  .get(
    '/places',
    async ({ query }) => {
      try {
        const results = await searchPlaces({
          name: query.name,
          country: query.country,
          placeType: query.placeType,
        });
        return { success: true, data: results } satisfies ApiResponse<typeof results>;
      } catch (err) {
        console.error('[LLI] Place search failed:', err);
        return { success: true, data: [] } satisfies ApiResponse<never[]>;
      }
    },
    {
      query: t.Object({
        name: t.Optional(t.String()),
        country: t.Optional(t.String()),
        placeType: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'Search places (local DB → LLI fallback)',
        description:
          'Search by place name, country code, or place type (POR, PSP, ANC, TER, FIL). ' +
          'Returns local DB matches first; falls back to Lloyd\'s List Intelligence if none found.',
      },
    },
  )

  // ─── Place List (local DB) ────────────────────────────────────────
  .get(
    '/places/local',
    async ({ query }) => {
      const results = await listPlaces({
        search: query.search,
        country: query.country,
        placeType: query.placeType,
        responsibleUserId: query.responsibleUserId,
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
        country: t.Optional(t.String()),
        placeType: t.Optional(t.String()),
        responsibleUserId: t.Optional(t.String()),
        sortBy: t.Optional(t.String()),
        sortDir: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'List places from local database',
        description:
          'Returns paginated list of places stored locally. ' +
          'Supports filtering by search term, country code, and place type.',
      },
    },
  )

  // ─── Get Single Place (local DB) ──────────────────────────────────
  .get(
    '/places/local/:id',
    async ({ params }) => {
      const place = await getPlaceById(params.id);
      if (!place) {
        return { success: false, data: null, error: 'Place not found' };
      }
      return { success: true, data: place } satisfies ApiResponse<typeof place>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Get a single place by ID',
      },
    },
  )

  // ─── Place Enrichment (Seasearcher geoJson, hierarchy) ────────────
  .get(
    '/places/enrichment/:seasearcherId',
    async ({ params }) => {
      try {
        const enrichment = await getPlaceEnrichment(params.seasearcherId);
        return { success: true, data: enrichment } satisfies ApiResponse<typeof enrichment>;
      } catch (err) {
        console.error('[Seasearcher] Enrichment failed:', err);
        return { success: false, data: null, message: 'Failed to load enrichment data' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Get Seasearcher enrichment (geoJson, hierarchy, parent)',
      },
    },
  )

  // ─── Find Place by LLI/Seasearcher ID ─────────────────────────────
  .get(
    '/places/by-lli/:lliPlaceId',
    async ({ params }) => {
      const place = await getPlaceByLliId(params.lliPlaceId);
      if (!place) {
        return { success: false, data: null };
      }
      return { success: true, data: place } satisfies ApiResponse<typeof place>;
    },
    {
      params: t.Object({ lliPlaceId: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Find a local place by its Seasearcher/LLI ID',
      },
    },
  )

  // ─── Create Place (manual entry) ──────────────────────────────────
  .post(
    '/places/local',
    async ({ body }) => {
      const place = await createPlace(body);
      return { success: true, data: place } satisfies ApiResponse<typeof place>;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        country: t.String({ minLength: 1 }),
        countryIso: t.Optional(t.String()),
        area: t.Optional(t.String()),
        subRegion: t.Optional(t.String()),
        placeType: t.Optional(t.Union([
          t.Literal('POR'),
          t.Literal('PSP'),
          t.Literal('ANC'),
          t.Literal('TER'),
          t.Literal('FIL'),
        ])),
        timezone: t.Optional(t.String()),
        lat: t.Optional(t.Number()),
        long: t.Optional(t.Number()),
        unlocode: t.Optional(t.String()),
        admiraltyChart: t.Optional(t.String()),
        parentPlaceId: t.Optional(t.String()),
        parentPlaceName: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Create a place manually in local database',
      },
    },
  )

  // ─── Update Place (manual entry) ─────────────────────────────────
  .put(
    '/places/local/:id',
    async ({ params, body, set, auth }) => {
      const existing = await getPlaceById(params.id);
      if (!existing) {
        set.status = 404;
        return { success: false, data: null, message: 'Place not found' };
      }

      if (existing.lliPlaceId) {
        set.status = 409;
        return {
          success: false,
          data: null,
          message: 'This place is synced from Seasearcher and cannot be edited manually.',
        };
      }

      const updated = await updateLocalPlace(params.id, body);
      if (!updated) {
        set.status = 500;
        return { success: false, data: null, message: 'Failed to update place' };
      }

      const after = await getPlaceById(params.id);
      if (after) {
        const metadata = buildStructuredActivityDiff({
          action: 'update_place_fields',
          before: existing,
          after,
          fields: [
            { field: 'name', value: (place) => place.name },
            { field: 'country', value: (place) => place.country },
            { field: 'countryIso', value: (place) => place.countryIso ?? null },
            { field: 'area', value: (place) => place.area ?? null },
            { field: 'subRegion', value: (place) => place.subRegion ?? null },
            { field: 'placeType', value: (place) => place.placeType ?? null },
            { field: 'timezone', value: (place) => place.timezone ?? null },
            { field: 'lat', value: (place) => place.lat ?? null },
            { field: 'long', value: (place) => place.long ?? null },
            { field: 'unlocode', value: (place) => place.unlocode ?? null },
            { field: 'admiraltyChart', value: (place) => place.admiraltyChart ?? null },
            {
              field: 'parentPlaceId',
              value: (place) => place.parentPlaceId ?? null,
              displayValue: (place) => place.parentPlaceName ?? null,
            },
            { field: 'orderRemark', value: (place) => place.orderRemark ?? null },
          ],
        });

        if (metadata) {
          await logActivity({
            userId: auth.sub,
            action: 'UPDATE',
            entityType: 'place',
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
        country: t.Optional(t.String({ minLength: 1 })),
        countryIso: t.Optional(t.Nullable(t.String())),
        area: t.Optional(t.Nullable(t.String())),
        subRegion: t.Optional(t.Nullable(t.String())),
        placeType: t.Optional(
          t.Nullable(
            t.Union([
              t.Literal('POR'),
              t.Literal('PSP'),
              t.Literal('ANC'),
              t.Literal('TER'),
              t.Literal('FIL'),
            ]),
          ),
        ),
        timezone: t.Optional(t.Nullable(t.String())),
        lat: t.Optional(t.Nullable(t.Number())),
        long: t.Optional(t.Nullable(t.Number())),
        unlocode: t.Optional(t.Nullable(t.String())),
        admiraltyChart: t.Optional(t.Nullable(t.String())),
        parentPlaceId: t.Optional(t.Nullable(t.String())),
        parentPlaceName: t.Optional(t.Nullable(t.String())),
        orderRemark: t.Optional(t.Nullable(t.String())),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Update a locally created place',
      },
    },
  )

  // ─── Update Place Default Order Remark (applies to all orders) ───
  .put(
    '/places/local/:id/order-remark',
    async ({ params, body, set, auth }) => {
      const existing = await getPlaceById(params.id);
      if (!existing) {
        set.status = 404;
        return { success: false, data: null, message: 'Place not found' };
      }

      const updated = await updatePlaceOrderRemark(params.id, body.orderRemark ?? null);
      if (!updated) {
        set.status = 500;
        return { success: false, data: null, message: 'Failed to update order remark' };
      }

      const full = await getPlaceById(params.id);
      if (!full) {
        set.status = 500;
        return { success: false, data: null, message: 'Failed to load updated place' };
      }

      const metadata = buildStructuredActivityDiff({
        action: 'update_place_order_remark',
        before: existing,
        after: full,
        fields: [
          { field: 'orderRemark', value: (place) => place.orderRemark ?? null },
        ],
      });

      if (metadata) {
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'place',
          entityId: params.id,
          metadata,
        });
      }

      return { success: true, data: full } satisfies ApiResponse<typeof full>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        orderRemark: t.Nullable(t.String()),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Update the default order remark for a place',
      },
    },
  )

  // ─── Import Place from LLI ────────────────────────────────────────
  .post(
    '/places/import',
    async ({ body }) => {
      const place = await importPlaceFromLli(String(body.lliPlaceId));
      return { success: true, data: place } satisfies ApiResponse<typeof place>;
    },
    {
      body: t.Object({
        lliPlaceId: t.Union([t.String(), t.Number()]),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'Import a place from LLI into local database',
        description:
          'Fetches full place details from LLI /placeadvancedchars_v3 and upserts into local DB.',
      },
    },
  )

  // ─── Delete Place (local DB) ───────────────────────────────────────
  .delete(
    '/places/local/:id',
    async ({ params, auth, set }) => {
      if (auth.role !== 'ADMIN') {
        set.status = 403;
        return { success: false, data: null, message: 'Only admins can delete places' };
      }
      try {
        const deleted = await deletePlace(params.id);
        if (!deleted) {
          return { success: false, data: null, message: 'Place not found' };
        }
        return { success: true, data: { id: params.id } } satisfies ApiResponse<{ id: string }>;
      } catch (err: any) {
        // FK violation — place is referenced by orders or other records
        const pgCode = err?.code || err?.cause?.code;
        if (pgCode === '23503') {
          set.status = 409;
          return {
            success: false,
            data: null,
            message: 'Cannot delete this place because it is referenced by one or more orders. Remove or reassign those orders first.',
          };
        }
        console.error('[Delete Place] Error:', err);
        set.status = 500;
        return { success: false, data: null, message: 'Failed to delete place' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Delete a place from local database',
      },
    },
  )

  // ─── Sync Place from Seasearcher ──────────────────────────────────
  .post(
    '/places/local/:id/sync',
    async ({ params }) => {
      const updated = await syncPlaceFromSeasearcher(params.id);
      if (!updated) {
        return { success: false, data: null, message: 'Place not found or no Seasearcher ID' };
      }
      return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Sync place data from Seasearcher',
        description: 'Fetches latest data from Seasearcher and updates the local record.',
      },
    },
  )

  // ─── Orders for a Place ────────────────────────────────────────────
  .get(
    '/places/local/:id/orders',
    async ({ params }) => {
      try {
        const orders = await getOrdersForPlace(params.id);
        return { success: true, data: orders } satisfies ApiResponse<typeof orders>;
      } catch (err) {
        console.error('[Orders] Failed to load orders for place:', err);
        return { success: false, data: [], message: 'Failed to load orders' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Get all orders for a place',
      },
    },
  )

  // ─── Port Facilities (Seasearcher) ────────────────────────────────
  .get(
    '/places/facilities/:seasearcherId',
    async ({ params }) => {
      try {
        const data = await getPortFacilities(params.seasearcherId);
        return { success: true, data } satisfies ApiResponse<typeof data>;
      } catch (err) {
        console.error('[Seasearcher] Port facilities failed:', err);
        return { success: false, data: null, message: 'Failed to load port facilities' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Get port facilities from Seasearcher',
      },
    },
  )

  // ─── Company / Contact Search ─────────────────────────────────────
  .get(
    '/companies',
    async ({ query }) => {
      const results = await searchCompanies({
        name: query.name,
        country: query.country,
        imo: query.imo,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        name: t.Optional(t.String()),
        country: t.Optional(t.String()),
        imo: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'Search companies/contacts (local DB → LLI fallback)',
        description:
          'Search by company name, country code, or company IMO. ' +
          'Returns local counterparties first; falls back to Lloyd\'s List Intelligence if none found.',
      },
    },
  )

  // ─── Expected Arrivals (Seasearcher) ──────────────────────────────
  .get(
    '/places/arrivals/:seasearcherId',
    async ({ params, query }) => {
      try {
        const daysAhead = query.days ? parseInt(query.days) : 7;
        const arrivals = await getExpectedArrivals(params.seasearcherId, daysAhead);
        return { success: true, data: arrivals } satisfies ApiResponse<typeof arrivals>;
      } catch (err) {
        console.error('[Seasearcher] Expected arrivals failed:', err);
        return { success: false, data: [], message: 'Failed to load expected arrivals' };
      }
    },
    {
      params: t.Object({ seasearcherId: t.String() }),
      query: t.Object({ days: t.Optional(t.String()) }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Get expected vessel arrivals from Seasearcher',
      },
    },
  )

  // ─── Port Suppliers: List ─────────────────────────────────────────
  .get(
    '/places/local/:id/suppliers',
    async ({ params }) => {
      try {
        const suppliers = await getPortSuppliers(params.id);
        return { success: true, data: suppliers } satisfies ApiResponse<typeof suppliers>;
      } catch (err) {
        console.error('[Suppliers] List failed:', err);
        return { success: false, data: [], message: 'Failed to load suppliers' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'List port suppliers for a place',
      },
    },
  )

  // ─── Port Suppliers: Create ───────────────────────────────────────
  .post(
    '/places/local/:id/suppliers',
    async ({ params, body, auth }) => {
      try {
        // Look up user name + place name for audit trail
        const [[u], [pl]] = await Promise.all([
          db.select({ name: users.name }).from(users).where(eq(users.id, auth.sub)).limit(1),
          db.select({ name: places.name }).from(places).where(eq(places.id, params.id)).limit(1),
        ]);
        const supplier = await addPortSupplier(
          params.id,
          { companyId: body.companyId, contactId: body.contactId, products: body.products, note: body.note },
          auth.sub,
          u?.name ?? auth.email,
        );

        // Log activity with metadata
        logActivity({
          userId: auth.sub,
          action: 'CREATE',
          entityType: 'place',
          entityId: params.id,
          entityName: pl?.name ?? null,
          httpMethod: 'POST',
          httpPath: `/lloyds/places/local/${params.id}/suppliers`,
          metadata: { supplier: supplier?.companyName, products: body.products, note: body.note },
        }).catch(() => {});

        return { success: true, data: supplier } satisfies ApiResponse<typeof supplier>;
      } catch (err) {
        console.error('[Suppliers] Create failed:', err);
        return { success: false, data: null, message: 'Failed to add supplier' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        companyId: t.String({ minLength: 1 }),
        contactId: t.Optional(t.Union([t.String(), t.Null()])),
        products: t.Optional(t.Array(t.String())),
        note: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Add a supplier to a place',
      },
    },
  )

  // ─── Port Suppliers: Update ───────────────────────────────────────
  .put(
    '/places/suppliers/:supplierId',
    async ({ params, body, auth }) => {
      try {
        const supplier = await updatePortSupplier(params.supplierId, body);
        if (!supplier) {
          return { success: false, data: null, message: 'Supplier not found' };
        }

        // Look up place name for audit trail
        const [pl] = await db.select({ name: places.name }).from(places).where(eq(places.id, supplier.placeId)).limit(1);

        // Log activity against the place with metadata
        logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'place',
          entityId: supplier.placeId,
          entityName: pl?.name ?? null,
          httpMethod: 'PUT',
          httpPath: `/lloyds/places/suppliers/${params.supplierId}`,
          metadata: { supplier: supplier.companyName, ...body },
        }).catch(() => {});

        return { success: true, data: supplier } satisfies ApiResponse<typeof supplier>;
      } catch (err) {
        console.error('[Suppliers] Update failed:', err);
        return { success: false, data: null, message: 'Failed to update supplier' };
      }
    },
    {
      params: t.Object({ supplierId: t.String() }),
      body: t.Object({
        contactId: t.Optional(t.Union([t.String(), t.Null()])),
        products: t.Optional(t.Array(t.String())),
        note: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Update a port supplier',
      },
    },
  )

  // ─── Port Suppliers: Delete ───────────────────────────────────────
  .delete(
    '/places/suppliers/:supplierId',
    async ({ params, auth }) => {
      try {
        const deleted = await deletePortSupplier(params.supplierId);
        if (!deleted) {
          return { success: false, data: null, message: 'Supplier not found' };
        }

        // Look up place name for audit trail
        const [pl] = await db.select({ name: places.name }).from(places).where(eq(places.id, deleted.placeId)).limit(1);

        // Log activity against the place
        logActivity({
          userId: auth.sub,
          action: 'DELETE',
          entityType: 'place',
          entityId: deleted.placeId,
          entityName: pl?.name ?? null,
          httpMethod: 'DELETE',
          httpPath: `/lloyds/places/suppliers/${params.supplierId}`,
          metadata: { supplier: deleted.companyName, products: deleted.products },
        }).catch(() => {});

        return { success: true, data: { id: params.supplierId } } satisfies ApiResponse<{ id: string }>;
      } catch (err) {
        console.error('[Suppliers] Delete failed:', err);
        return { success: false, data: null, message: 'Failed to delete supplier' };
      }
    },
    {
      params: t.Object({ supplierId: t.String() }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Delete a port supplier',
      },
    },
  )

  // ─── Responsible User: Update ─────────────────────────────────────
  .patch(
    '/places/local/:id/responsible-user',
    async ({ params, body, auth }) => {
      try {
        const updated = await updateResponsibleUser(params.id, body.userId);
        if (!updated) {
          return { success: false, data: null, message: 'Place not found' };
        }

        // Log activity
        await logActivity({
          userId: auth.sub,
          action: 'UPDATE',
          entityType: 'place',
          entityId: params.id,
          entityName: updated.name,
          metadata: { field: 'responsibleUser', responsibleUserId: body.userId },
        });

        return { success: true, data: updated } satisfies ApiResponse<typeof updated>;
      } catch (err) {
        console.error('[ResponsibleUser] Update failed:', err);
        return { success: false, data: null, message: 'Failed to update responsible user' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        userId: t.Union([t.String(), t.Null()]),
      }),
      detail: {
        tags: ["Lloyd's"],
        summary: 'Set or clear the responsible user for a place',
      },
    },
  )

  // ─── Active Users (for dropdowns) ─────────────────────────────────
  .get(
    '/users',
    async () => {
      try {
        const userList = await listActiveUsers();
        return { success: true, data: userList } satisfies ApiResponse<typeof userList>;
      } catch (err) {
        console.error('[Users] List failed:', err);
        return { success: false, data: [], message: 'Failed to load users' };
      }
    },
    {
      detail: {
        tags: ["Lloyd's"],
        summary: 'List active users for dropdowns',
      },
    },
  );
