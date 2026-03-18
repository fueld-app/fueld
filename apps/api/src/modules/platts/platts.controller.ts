import { Elysia, t } from 'elysia';
import type {
  ApiResponse,
  CreatePlattsReportResponseDto,
  PaginatedResponse,
  PlattsReportDetailDto,
  PlattsReportDto,
  PlattsSuggestionRequestItemDto,
  PlattsSuggestionsResponseDto,
} from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  createPlattsReportFromUpload,
  enqueuePlattsReparse,
  getCanonicalPlattsReport,
  getPlattsReportDetail,
  getPlattsSuggestions,
  getPlattsReportSource,
  listPlattsReports,
  replaceCanonicalPlattsReport,
} from './platts.service';

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const candidate = error.message;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

function requireAdmin(role: string): void {
  if (role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const plattsController = new Elysia({ prefix: '/platts' })
  .use(authGuard)
  .get(
    '/reports',
    async ({ auth, query }) => {
      try {
        const data = await listPlattsReports({
          tenantId: auth.tenantId,
          family: query.family || undefined,
          from: query.from || undefined,
          to: query.to || undefined,
          status: query.status || undefined,
          search: query.search || undefined,
          canonicalOnly: query.canonicalOnly !== 'false',
          page: Number(query.page || 1),
          pageSize: Math.min(Number(query.pageSize || 20), 100),
        });
        return { success: true, data } satisfies ApiResponse<PaginatedResponse<PlattsReportDto>>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to list Platts reports';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      query: t.Object({
        family: t.Optional(t.String()),
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        canonicalOnly: t.Optional(t.String()),
        page: t.Optional(t.String()),
        pageSize: t.Optional(t.String()),
      }),
      detail: { tags: ['Platts'], summary: 'List Platts reports for the current tenant' },
    },
  )
  .get(
    '/reports/canonical/:family/:publicationDate',
    async ({ auth, params, set }) => {
      try {
        const data = await getCanonicalPlattsReport(auth.tenantId, params.family, params.publicationDate);
        if (!data) {
          set.status = 404;
          return { success: false, data: null, message: 'Canonical Platts report not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data } satisfies ApiResponse<PlattsReportDetailDto>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load canonical Platts report';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      params: t.Object({ family: t.String(), publicationDate: t.String() }),
      detail: { tags: ['Platts'], summary: 'Get canonical Platts report by family and publication date' },
    },
  )
  .post(
    '/suggestions',
    async ({ auth, body, set }) => {
      try {
        const data = await getPlattsSuggestions({
          tenantId: auth.tenantId,
          publicationDate: body.publicationDate ?? null,
          family: body.family as 'EUROPEAN_MARKETSCAN' | undefined,
          items: body.items as PlattsSuggestionRequestItemDto[],
          limitPerItem: body.limitPerItem ?? 5,
        });
        return { success: true, data } satisfies ApiResponse<PlattsSuggestionsResponseDto>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load Platts suggestions';
        set.status = 400;
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        publicationDate: t.Optional(t.Nullable(t.String())),
        family: t.Optional(t.String()),
        limitPerItem: t.Optional(t.Number()),
        items: t.Array(t.Object({
          key: t.String(),
          productType: t.String(),
          description: t.Optional(t.Nullable(t.String())),
        })),
      }),
      detail: { tags: ['Platts'], summary: 'Get canonical Platts suggestions for products and date' },
    },
  )
  .post(
    '/reports',
    async ({ auth, body, set }) => {
      try {
        const data = await createPlattsReportFromUpload({
          tenantId: auth.tenantId,
          userId: auth.userId,
          file: body.file,
          family: body.family as 'EUROPEAN_MARKETSCAN' | undefined,
          importMode: body.importMode ?? 'single',
          importBatchId: body.importBatchId ?? null,
          notes: body.notes ?? null,
        });
        set.status = 201;
        return { success: true, data } satisfies ApiResponse<CreatePlattsReportResponseDto>;
      } catch (error) {
        console.error('[Platts] Upload failed:', error);
        const message = getErrorMessage(error, 'Failed to upload Platts report');
        set.status = 400;
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      body: t.Object({
        file: t.File(),
        family: t.Optional(t.String()),
        importMode: t.Optional(t.String()),
        importBatchId: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.Nullable(t.String())),
      }),
      detail: { tags: ['Platts'], summary: 'Upload a Platts PDF for parsing and archival' },
    },
  )
  .get(
    '/reports/:id',
    async ({ auth, params, set }) => {
      try {
        const data = await getPlattsReportDetail(auth.tenantId, params.id);
        if (!data) {
          set.status = 404;
          return { success: false, data: null, message: 'Platts report not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data } satisfies ApiResponse<PlattsReportDetailDto>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load Platts report';
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Platts'], summary: 'Get a Platts report with parsed detail' },
    },
  )
  .get(
    '/reports/:id/source',
    async ({ auth, params, set }) => {
      const result = await getPlattsReportSource(auth.tenantId, params.id);
      if (!result) {
        set.status = 404;
        return 'Not found';
      }

      set.headers['Content-Type'] = result.file.type || 'application/pdf';
      set.headers['Content-Disposition'] = `inline; filename="${result.fileName}"`;
      set.headers['Cache-Control'] = 'private, max-age=300';
      return result.file;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Platts'], summary: 'Stream the original uploaded Platts PDF' },
    },
  )
  .post(
    '/reports/:id/reparse',
    async ({ auth, params, set }) => {
      try {
        const data = await enqueuePlattsReparse(auth.tenantId, params.id, auth.userId);
        if (!data) {
          set.status = 404;
          return { success: false, data: null, message: 'Platts report not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data } satisfies ApiResponse<PlattsReportDto>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to queue reparse';
        set.status = 400;
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Platts'], summary: 'Queue a Platts report for reparsing' },
    },
  )
  .post(
    '/reports/:id/replace-canonical',
    async ({ auth, params, set }) => {
      try {
        requireAdmin(auth.role);
        const data = await replaceCanonicalPlattsReport(auth.tenantId, params.id, auth.userId);
        if (!data) {
          set.status = 404;
          return { success: false, data: null, message: 'Platts report not found' } satisfies ApiResponse<null>;
        }
        return { success: true, data } satisfies ApiResponse<PlattsReportDto>;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to replace canonical Platts report';
        set.status = message === 'Admin access required' ? 403 : 400;
        return { success: false, data: null, message } satisfies ApiResponse<null>;
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { tags: ['Platts'], summary: 'Promote a report to canonical for its publication date' },
    },
  );