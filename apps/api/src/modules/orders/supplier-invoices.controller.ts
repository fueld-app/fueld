/**
 * Supplier invoice routes — money owed TO us BY a supplier.
 *
 * Mounted under `/supplier-invoices`. Every route is gated on the tenant's
 * broker-deals flag: the nav link is hidden without it, but the API is the
 * authority, and an authenticated user of any tenant must not be able to raise
 * or read a supplier receivable.
 *
 * The PDF route renders from the invoice's frozen snapshot, not from the orders.
 * See `supplier-invoice-document.ts` for why that matters.
 */
import { Elysia, t } from 'elysia';
import { and, eq } from 'drizzle-orm';
import type { ApiResponse, SupplierInvoiceDto, CreateSupplierInvoicesResultDto } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import { db } from '../../db';
import { counterparties, supplierInvoices, tenants, type TenantSettings } from '../../db/schema';
import { getDateFormatSettings, getDocumentBrandingSettings } from '../admin/settings.service';
import {
  buildDocumentFooter,
  createPdfBuffer,
  resolveTenantDocAccent,
  tryLoadLogoDataUrl,
} from '../documents/document.service';
import { buildSupplierInvoiceDocument } from '../documents/supplier-invoice-document';
import {
  assertSupplierInvoicesEnabled,
  createSupplierInvoicesFromReport,
  getSupplierInvoice,
  listSupplierInvoices,
  listSuppliersWithSupplierCommission,
  voidSupplierInvoice,
} from './supplier-invoice.service';

const DateOnly = t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

export const supplierInvoicesController = new Elysia({ prefix: '/supplier-invoices' })
  .use(authGuard)

  // ── Who owes commission in a period, and has it been invoiced? ─────
  .get('/candidates', async ({ auth, query, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    const data = await listSuppliersWithSupplierCommission(auth.tenantId, query.from, query.to);
    return { success: true, data } satisfies ApiResponse<typeof data>;
  }, {
    query: t.Object({ from: DateOnly, to: DateOnly }),
    detail: { tags: ['Supplier Invoices'], summary: 'Suppliers owing commission in a period', security: [{ bearerAuth: [] }] },
  })

  // ── Raise one invoice per supplier for the period ──────────────────
  .post('/', async ({ auth, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    // Raising a receivable is an admin action, enforced here — the summary said
    // "admin only" while nothing checked the role.
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    // Idempotent per (tenant, period, supplier): a repeat click creates nothing
    // and reports which suppliers were already invoiced.
    const data = await createSupplierInvoicesFromReport(auth.tenantId, body.from, body.to, auth.sub);
    return { success: true, data } satisfies ApiResponse<CreateSupplierInvoicesResultDto>;
  }, {
    body: t.Object({ from: DateOnly, to: DateOnly }),
    detail: { tags: ['Supplier Invoices'], summary: 'Create supplier invoices from a period (admin only)', security: [{ bearerAuth: [] }] },
  })

  // ── List ───────────────────────────────────────────────────────────
  .get('/', async ({ auth, query, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    const data = await listSupplierInvoices(auth.tenantId, {
      supplierId: query.supplierId ?? null,
      includeVoid: query.includeVoid === 'true',
    });
    return { success: true, data } satisfies ApiResponse<SupplierInvoiceDto[]>;
  }, {
    query: t.Object({
      supplierId: t.Optional(t.String()),
      includeVoid: t.Optional(t.String()),
    }),
    detail: { tags: ['Supplier Invoices'], summary: 'List supplier invoices', security: [{ bearerAuth: [] }] },
  })

  // ── Detail ─────────────────────────────────────────────────────────
  .get('/:id', async ({ auth, params, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    // Ownership is established INSIDE the read, before it refreshes anything —
    // see getSupplierInvoice. A foreign id 404s without touching the row.
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto>;
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Get a supplier invoice', security: [{ bearerAuth: [] }] },
  })

  // ── PDF ────────────────────────────────────────────────────────────
  .get('/:id/pdf', async ({ auth, params, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' };
    }
    const invoice = await getSupplierInvoice(params.id, auth.tenantId);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' };
    }
    if (invoice.status === 'VOID') {
      set.status = 400;
      return { success: false, data: null, message: 'This invoice was voided and is kept for audit only.' };
    }

    const [tenant] = await db
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1);
    const settings = (tenant?.settings ?? {}) as TenantSettings;

    // Issuer branding is resolved live (it is our letterhead, not the billed
    // party's) but every figure and party below comes from the frozen snapshot.
    /**
     * Resolved by id AND tenant, never by name. `counterparties.name` is not
     * unique across tenants, so a name lookup could pull another tenant's logo,
     * address and VAT onto our invoice. The id is stored at issue for exactly
     * this reason; the frozen name is only a display fallback.
     */
    const [company] = invoice.invoicingCompanyId
      ? await db
        .select({
          name: counterparties.name,
          address: counterparties.headOfficeAddress,
          phone: counterparties.headOfficePhone,
          email: counterparties.headOfficeEmail,
          vatNumber: counterparties.vatNumber,
          logoUrl: counterparties.logoUrl,
          brandColor: counterparties.brandColor,
        })
        .from(counterparties)
        .where(and(eq(counterparties.id, invoice.invoicingCompanyId), eq(counterparties.tenantId, auth.tenantId)))
        .limit(1)
      : [];

    const { dateFormat } = await getDateFormatSettings(auth.tenantId);
    const { enabled: brandingEnabled, layout } = await getDocumentBrandingSettings(auth.tenantId);
    const accent = resolveTenantDocAccent(company?.brandColor ?? null, brandingEnabled) ?? '#0f766e';

    const footer = buildDocumentFooter({
      senderName: invoice.invoicingCompanyName ?? company?.name ?? tenant?.name ?? '',
      companyAddress: company?.address ?? null,
      companyPhone: company?.phone ?? null,
      companyEmail: company?.email ?? null,
      vatNumber: company?.vatNumber ?? null,
      companyRegistrationNumber: null,
      printMeta: null,
      dateFormat,
      accent,
    });

    // The remittance block was snapshotted at issue, so an issued invoice keeps
    // printing the account it was issued with.
    const bankDetails = invoice.bankDetails;

    const docDefinition = buildSupplierInvoiceDocument({
      invoice,
      bankDetails,
      logoDataUrl: tryLoadLogoDataUrl(company?.logoUrl ?? null),
      layout,
      footer,
    });

    const buffer = await createPdfBuffer(docDefinition as never);
    const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_');

    set.headers['Content-Type'] = 'application/pdf';
    set.headers['Content-Disposition'] = `attachment; filename="Supplier_Invoice_${safeNumber}.pdf"`;
    set.headers['Content-Length'] = String(buffer.length);
    return buffer;
  }, {
    params: t.Object({ id: t.String() }),
    detail: { tags: ['Supplier Invoices'], summary: 'Supplier invoice PDF', security: [{ bearerAuth: [] }] },
  })

  // ── Void ───────────────────────────────────────────────────────────
  .post('/:id/void', async ({ auth, params, body, set }) => {
    if (!(await assertSupplierInvoicesEnabled(auth.tenantId))) {
      set.status = 404;
      return { success: false, data: null, message: 'Broker deals are not enabled for this tenant' } satisfies ApiResponse<null>;
    }
    // Voiding a money document is an admin action.
    if (auth.role !== 'ADMIN') {
      set.status = 403;
      return { success: false, data: null, message: 'Admin access required' } satisfies ApiResponse<null>;
    }
    const invoice = await voidSupplierInvoice(params.id, auth.tenantId, body?.reason ?? null);
    if (!invoice) {
      set.status = 404;
      return { success: false, data: null, message: 'Supplier invoice not found' } satisfies ApiResponse<null>;
    }
    return { success: true, data: invoice } satisfies ApiResponse<SupplierInvoiceDto | null>;
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Optional(t.Object({ reason: t.Optional(t.Nullable(t.String())) })),
    detail: { tags: ['Supplier Invoices'], summary: 'Void a supplier invoice', security: [{ bearerAuth: [] }] },
  });
