/**
 * Rendering a supplier invoice PDF, and the email that carries it.
 *
 * Extracted from the PDF route so the download and the send are the SAME bytes.
 * Two renderers would drift: the operator would mail a PDF that differs from the
 * one they previewed, which on a payable document is a dispute waiting to happen.
 *
 * The document is rendered from the invoice's frozen snapshot (see
 * `supplier-invoice-document.ts`), so sending an old invoice re-renders what it
 * said at issue, not what the deals say today.
 */
import { and, eq } from 'drizzle-orm';
import type { SupplierInvoiceDto } from '@fueld/types';
import { db } from '../../db';
import { counterparties, tenants } from '../../db/schema';
import { getDateFormatSettings, getDocumentBrandingSettings } from '../admin/settings.service';
import {
  buildDocumentFooter,
  createPdfBuffer,
  resolveTenantDocAccent,
  tryLoadLogoDataUrl,
} from '../documents/document.service';
import { buildSupplierInvoiceDocument } from '../documents/supplier-invoice-document';

export interface RenderedSupplierInvoice {
  buffer: Buffer;
  fileName: string;
}

/**
 * Render the PDF for an invoice that has already been fetched and authorised.
 *
 * Issuer branding is resolved LIVE — it is our own letterhead, so a rebrand or a
 * new logo should apply. Every figure and PARTY below comes from the frozen
 * snapshot, and the counterparty is resolved by id AND tenant: `name` is not
 * unique across tenants, so a name lookup could pull another tenant's address
 * and VAT onto our invoice.
 */
export async function renderSupplierInvoicePdf(
  invoice: SupplierInvoiceDto,
  tenantId: string,
): Promise<RenderedSupplierInvoice> {
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

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
      .where(and(eq(counterparties.id, invoice.invoicingCompanyId), eq(counterparties.tenantId, tenantId)))
      .limit(1)
    : [];

  const { dateFormat } = await getDateFormatSettings(tenantId);
  const { enabled: brandingEnabled, layout } = await getDocumentBrandingSettings(tenantId);
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
  const docDefinition = buildSupplierInvoiceDocument({
    invoice,
    bankDetails: invoice.bankDetails,
    logoDataUrl: tryLoadLogoDataUrl(company?.logoUrl ?? null),
    layout,
    footer,
  });

  const buffer = await createPdfBuffer(docDefinition as never);
  const safeNumber = invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_');

  return { buffer, fileName: `Supplier_Invoice_${safeNumber}.pdf` };
}
