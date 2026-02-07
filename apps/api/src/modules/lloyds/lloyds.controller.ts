import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { searchVessels, searchPlaces, searchCompanies, importPlaceFromLli, listPlaces, getPlaceById } from './lli.service';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Controller
//  All routes are protected via authGuard.
//
//  GET /lloyds/vessels?imo=...&name=...&mmsi=...
//  GET /lloyds/places?name=...&country=...&placeType=...
//  GET /lloyds/places/local?search=...&country=...&placeType=...&page=...&limit=...
//  GET /lloyds/places/local/:id
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
        page: query.page ? parseInt(query.page) : undefined,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        country: t.Optional(t.String()),
        placeType: t.Optional(t.String()),
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
  );
