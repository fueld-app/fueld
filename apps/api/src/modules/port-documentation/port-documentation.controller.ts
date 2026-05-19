import { Elysia, t } from 'elysia';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import { logActivity } from '../activity/activity.service';
import {
  assertPortDocumentationEnabled,
  createGateListPerson,
  downloadOrderPortDocument,
  downloadPortDocumentAsset,
  generateBunkerInstructionsDocument,
  generateGateListDocument,
  getBunkerInstructionsPreview,
  getPortDocumentAbsolutePath,
  getPortDocumentationOrderContext,
  includeFlangeWorksheet,
  listGateListPersonnel,
  listPortDocumentAssets,
  listPortDocumentationPlaces,
  uploadPortDocumentAsset,
  updateGateListPerson,
} from './port-documentation.service';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

export const portDocumentationController = new Elysia()
  .use(authGuard)

  .get('/admin/port-documentation/gate-list/personnel', async ({ auth }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await listGateListPersonnel(auth.tenantId);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Port Documentation'], summary: 'List admin-managed port gate list personnel' },
  })

  .post('/admin/port-documentation/gate-list/personnel', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await createGateListPerson(auth.tenantId, auth.sub, body);
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'CREATE',
        entityType: 'port_gate_list_person',
        entityId: data.id,
        entityName: data.fullName,
        metadata: { company: data.company, roleTitle: data.roleTitle },
      });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      fullName: t.String({ minLength: 1 }),
      roleTitle: t.String({ minLength: 1 }),
      company: t.String({ minLength: 1 }),
      active: t.Optional(t.Boolean()),
      notes: t.Optional(t.Nullable(t.String())),
      placeId: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Port Documentation'], summary: 'Create gate list personnel entry' },
  })

  .patch('/admin/port-documentation/gate-list/personnel/:id', async ({ auth, params, body }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await updateGateListPerson(auth.tenantId, auth.sub, params.id, body);
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'UPDATE',
        entityType: 'port_gate_list_person',
        entityId: data.id,
        entityName: data.fullName,
        metadata: { active: data.active },
      });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      fullName: t.Optional(t.String({ minLength: 1 })),
      roleTitle: t.Optional(t.String({ minLength: 1 })),
      company: t.Optional(t.String({ minLength: 1 })),
      active: t.Optional(t.Boolean()),
      notes: t.Optional(t.Nullable(t.String())),
      placeId: t.Optional(t.Nullable(t.String())),
    }),
    detail: { tags: ['Port Documentation'], summary: 'Update gate list personnel entry' },
  })

  .get('/admin/port-documentation/assets', async ({ auth, query }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await listPortDocumentAssets(auth.tenantId, query.documentKind || undefined);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    query: t.Object({ documentKind: t.Optional(t.String()) }),
    detail: { tags: ['Port Documentation'], summary: 'List static port document assets' },
  })

  .post('/admin/port-documentation/assets/flange-worksheet', async ({ auth, body }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const allowed = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/pdf',
      ];
      if (!allowed.includes(body.file.type)) {
        return { success: false, data: null, message: 'Only XLSX, XLS, or PDF files are allowed' } satisfies ApiResponse<null>;
      }
      if (body.file.size > 10 * 1024 * 1024) {
        return { success: false, data: null, message: 'Flange Worksheet must be under 10 MB' } satisfies ApiResponse<null>;
      }

      const data = await uploadPortDocumentAsset({
        tenantId: auth.tenantId,
        userId: auth.sub,
        documentKind: 'FLANGE_WORKSHEET',
        displayName: 'Flange Worksheet',
        file: body.file,
      });
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'CREATE',
        entityType: 'port_document_asset',
        entityId: data.id,
        entityName: data.displayName,
        metadata: { documentKind: data.documentKind, versionNumber: data.versionNumber },
      });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ file: t.File() }),
    detail: { tags: ['Port Documentation'], summary: 'Upload a new Flange Worksheet asset version' },
  })

  .get('/admin/port-documentation/assets/:id/download', async ({ auth, params, set }) => {
    try {
      requireAdmin(auth);
      await assertPortDocumentationEnabled(auth.tenantId);
      const fileMeta = await downloadPortDocumentAsset(auth.tenantId, params.id);
      const file = Bun.file(getPortDocumentAbsolutePath(fileMeta.filePath));
      set.headers['Content-Type'] = fileMeta.mimeType;
      set.headers['Content-Disposition'] = `attachment; filename="${fileMeta.fileName}"`;
      return file;
    } catch (err) {
      set.status = 404;
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Download a static port document asset' },
  })

  .get('/admin/port-documentation/places', async ({ auth }) => {
    try {
      requireAdmin(auth);
      const data = await listPortDocumentationPlaces();
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Port Documentation'], summary: 'List places for gate list assignment' },
  })

  .get('/orders/:id/port-documentation', async ({ auth, params }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await getPortDocumentationOrderContext(auth.tenantId, params.id);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Get Port Documentation order context' },
  })

  .get('/orders/:id/port-documentation/bunker-instructions/preview', async ({ auth, params }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await getBunkerInstructionsPreview(auth.tenantId, params.id);
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Preview bunker instructions content for an order' },
  })

  .post('/orders/:id/port-documentation/bunker-instructions/generate', async ({ auth, params }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await generateBunkerInstructionsDocument(auth.tenantId, params.id, auth.sub);
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'CREATE',
        entityType: 'order_port_document',
        entityId: data.document.id,
        entityName: data.fileName,
        metadata: { documentKind: 'BUNKER_INSTRUCTIONS', orderId: params.id },
      });
      return { success: true, data: data.document } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Generate bunker instructions XLSX for an order' },
  })

  .post('/orders/:id/port-documentation/gate-list/generate', async ({ auth, params }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await generateGateListDocument(auth.tenantId, params.id, auth.sub);
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'CREATE',
        entityType: 'order_port_document',
        entityId: data.document.id,
        entityName: data.fileName,
        metadata: { documentKind: 'GATE_LIST', orderId: params.id },
      });
      return { success: true, data: data.document } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Generate gate list XLSX for an order' },
  })

  .post('/orders/:id/port-documentation/flange-worksheet/include', async ({ auth, params }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const data = await includeFlangeWorksheet(auth.tenantId, params.id, auth.sub);
      await logActivity({
        tenantId: auth.tenantId,
        userId: auth.sub,
        action: 'CREATE',
        entityType: 'order_port_document',
        entityId: data.id,
        entityName: data.fileName,
        metadata: { documentKind: 'FLANGE_WORKSHEET', orderId: params.id },
      });
      return { success: true, data } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Include the current Flange Worksheet on an order' },
  })

  .get('/orders/:id/port-documentation/documents/:documentId/download', async ({ auth, params, set }) => {
    try {
      await assertPortDocumentationEnabled(auth.tenantId);
      const fileMeta = await downloadOrderPortDocument(auth.tenantId, params.id, params.documentId);
      const file = Bun.file(getPortDocumentAbsolutePath(fileMeta.filePath));
      set.headers['Content-Type'] = fileMeta.mimeType;
      set.headers['Content-Disposition'] = `attachment; filename="${fileMeta.fileName}"`;
      return file;
    } catch (err) {
      set.status = 404;
      const message = err instanceof Error ? err.message : 'Failed';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    params: t.Object({ id: t.String(), documentId: t.String() }),
    detail: { tags: ['Port Documentation'], summary: 'Download an order port document' },
  });