import { Elysia, t } from 'elysia';
import { authGuard } from '../auth/auth.guard';
import { searchVessels, searchPorts, searchCompanies } from './lli.service';
import type { ApiResponse } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Lloyd's List Intelligence — Controller
//  All routes are protected via authGuard.
//
//  GET /lloyds/vessels?imo=...&name=...&mmsi=...
//  GET /lloyds/ports?name=...&country=...
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

  // ─── Port Search ──────────────────────────────────────────────────
  .get(
    '/ports',
    async ({ query }) => {
      const results = await searchPorts({
        name: query.name,
        country: query.country,
      });
      return { success: true, data: results } satisfies ApiResponse<typeof results>;
    },
    {
      query: t.Object({
        name: t.Optional(t.String()),
        country: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Lloyd\'s'],
        summary: 'Search ports (local DB → LLI fallback)',
        description:
          'Search by port name or country code. ' +
          'Returns local DB matches first; falls back to Lloyd\'s List Intelligence if none found.',
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
