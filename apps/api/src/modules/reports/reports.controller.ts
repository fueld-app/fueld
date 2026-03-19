import { Elysia, t } from 'elysia';
import type {
  ApiResponse,
  ReleaseOneReportsDto,
  ReleaseTwoReportsDto,
  ReportScheduleDto,
  SavedReportViewDto,
} from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  createReportSchedule,
  createSavedReportView,
  deleteReportSchedule,
  deleteSavedReportView,
  exportCommercialSummaryCsv,
  exportCommercialSummaryXlsx,
  exportInvoiceAgingCsv,
  exportInvoiceAgingXlsx,
  exportMarginAnalysisCsv,
  exportMarginAnalysisXlsx,
  exportTraderPerformanceCsv,
  exportTraderPerformanceXlsx,
  getReleaseOneReports,
  getReleaseTwoReports,
  updateReportSchedule,
  updateSavedReportView,
} from './reports.service';

const reportFiltersSchema = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  traderId: t.Optional(t.String()),
  teamId: t.Optional(t.String()),
  customerId: t.Optional(t.String()),
  productType: t.Optional(t.String()),
});

const reportFiltersBodySchema = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String()),
  traderId: t.Optional(t.Nullable(t.String())),
  teamId: t.Optional(t.Nullable(t.String())),
  customerId: t.Optional(t.Nullable(t.String())),
  productType: t.Optional(t.Nullable(t.String())),
});

export const reportsController = new Elysia({ prefix: '/reports' })
  .use(authGuard)
  .get(
    '/release-one',
    async ({ auth, query }) => {
      const data = await getReleaseOneReports(auth.tenantId, auth.userId, query as any);
      return { success: true, data } satisfies ApiResponse<ReleaseOneReportsDto>;
    },
    {
      query: reportFiltersSchema,
      detail: {
        tags: ['Reports'],
        summary: 'Get Release 1 reports landing data',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get(
    '/release-two',
    async ({ auth, query }) => {
      const data = await getReleaseTwoReports(auth.tenantId, auth.userId, query as any);
      return { success: true, data } satisfies ApiResponse<ReleaseTwoReportsDto>;
    },
    {
      query: reportFiltersSchema,
      detail: {
        tags: ['Reports'],
        summary: 'Get Release 2 reports payload',
        description: 'Returns Release 1 data plus filter options, saved views, schedules, and margin analysis.',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/saved-views',
    async ({ auth, body }) => {
      const views = await createSavedReportView(auth.tenantId, auth.userId, auth.email ?? null, body as any);
      return { success: true, data: views } satisfies ApiResponse<SavedReportViewDto[]>;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        filters: t.Optional(reportFiltersBodySchema),
      }),
      detail: {
        tags: ['Reports'],
        summary: 'Create a shared saved report view',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/saved-views/:id',
    async ({ auth, body, params }) => {
      const views = await updateSavedReportView(auth.tenantId, auth.userId, params.id, body as any);
      return { success: true, data: views } satisfies ApiResponse<SavedReportViewDto[]>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        filters: t.Optional(reportFiltersBodySchema),
      }),
      detail: {
        tags: ['Reports'],
        summary: 'Update a shared saved report view',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/saved-views/:id',
    async ({ auth, params }) => {
      const views = await deleteSavedReportView(auth.tenantId, auth.userId, params.id);
      return { success: true, data: views } satisfies ApiResponse<SavedReportViewDto[]>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Reports'],
        summary: 'Delete a shared saved report view',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .post(
    '/schedules',
    async ({ auth, body }) => {
      const schedules = await createReportSchedule(auth.tenantId, auth.userId, body as any);
      return { success: true, data: schedules } satisfies ApiResponse<ReportScheduleDto[]>;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        reportType: t.Union([t.Literal('SUMMARY'), t.Literal('MARGIN_ANALYSIS')]),
        deliveryMode: t.Optional(t.Union([t.Literal('HTML'), t.Literal('CSV'), t.Literal('XLSX'), t.Literal('CSV_XLSX')])),
        bodyMode: t.Optional(t.Union([t.Literal('HTML_SUMMARY'), t.Literal('ATTACHMENT_ONLY')])),
        hourUtc: t.Number({ minimum: 0, maximum: 23 }),
        recipientRoles: t.Array(t.String()),
        extraEmails: t.Optional(t.Array(t.String())),
        filters: t.Optional(reportFiltersBodySchema),
      }),
      detail: {
        tags: ['Reports'],
        summary: 'Create a report delivery schedule',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .patch(
    '/schedules/:id',
    async ({ auth, body, params }) => {
      const schedules = await updateReportSchedule(auth.tenantId, auth.userId, params.id, body as any);
      return { success: true, data: schedules } satisfies ApiResponse<ReportScheduleDto[]>;
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        reportType: t.Union([t.Literal('SUMMARY'), t.Literal('MARGIN_ANALYSIS')]),
        deliveryMode: t.Optional(t.Union([t.Literal('HTML'), t.Literal('CSV'), t.Literal('XLSX'), t.Literal('CSV_XLSX')])),
        bodyMode: t.Optional(t.Union([t.Literal('HTML_SUMMARY'), t.Literal('ATTACHMENT_ONLY')])),
        hourUtc: t.Number({ minimum: 0, maximum: 23 }),
        recipientRoles: t.Array(t.String()),
        extraEmails: t.Optional(t.Array(t.String())),
        filters: t.Optional(reportFiltersBodySchema),
        isActive: t.Optional(t.Boolean()),
      }),
      detail: {
        tags: ['Reports'],
        summary: 'Update a report delivery schedule',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .delete(
    '/schedules/:id',
    async ({ auth, params }) => {
      const schedules = await deleteReportSchedule(auth.tenantId, auth.userId, params.id);
      return { success: true, data: schedules } satisfies ApiResponse<ReportScheduleDto[]>;
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Reports'],
        summary: 'Delete a report delivery schedule',
        security: [{ bearerAuth: [] }],
      },
    },
  )
  .get('/trader-performance/export', async ({ auth, query, set }) => {
    const { csv, fileName } = await exportTraderPerformanceCsv(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'text/csv; charset=utf-8';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return csv;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export trader performance CSV', security: [{ bearerAuth: [] }] },
  })
  .get('/trader-performance/export.xlsx', async ({ auth, query, set }) => {
    const { content, fileName } = await exportTraderPerformanceXlsx(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return content;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export trader performance XLSX', security: [{ bearerAuth: [] }] },
  })
  .get('/invoice-aging/export', async ({ auth, query, set }) => {
    const { csv, fileName } = await exportInvoiceAgingCsv(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'text/csv; charset=utf-8';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return csv;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export invoice aging CSV', security: [{ bearerAuth: [] }] },
  })
  .get('/invoice-aging/export.xlsx', async ({ auth, query, set }) => {
    const { content, fileName } = await exportInvoiceAgingXlsx(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return content;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export invoice aging XLSX', security: [{ bearerAuth: [] }] },
  })
  .get('/commercial-summary/export', async ({ auth, query, set }) => {
    const { csv, fileName } = await exportCommercialSummaryCsv(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'text/csv; charset=utf-8';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return csv;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export commercial summary CSV', security: [{ bearerAuth: [] }] },
  })
  .get('/commercial-summary/export.xlsx', async ({ auth, query, set }) => {
    const { content, fileName } = await exportCommercialSummaryXlsx(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return content;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export commercial summary XLSX', security: [{ bearerAuth: [] }] },
  })
  .get('/margin-analysis/export', async ({ auth, query, set }) => {
    const { csv, fileName } = await exportMarginAnalysisCsv(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'text/csv; charset=utf-8';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return csv;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export margin analysis CSV', security: [{ bearerAuth: [] }] },
  })
  .get('/margin-analysis/export.xlsx', async ({ auth, query, set }) => {
    const { content, fileName } = await exportMarginAnalysisXlsx(auth.tenantId, auth.userId, query as any);
    set.headers['Content-Type'] = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    set.headers['Content-Disposition'] = `attachment; filename="${fileName}"`;
    return content;
  }, {
    query: reportFiltersSchema,
    detail: { tags: ['Reports'], summary: 'Export margin analysis XLSX', security: [{ bearerAuth: [] }] },
  });
