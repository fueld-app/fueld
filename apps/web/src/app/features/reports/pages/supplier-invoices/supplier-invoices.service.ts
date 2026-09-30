import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams, type HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  CreateSupplierInvoicesResultDto,
  SupplierInvoiceCandidatesDto,
  SupplierInvoiceDto,
} from '@fueld/types';
import { API } from '@app/core/config/api';
import { filenameFromResponse } from '@app/features/trading/pages/order-detail/services/filename-from-response';

// ═══════════════════════════════════════════════════════════════════════
//  SupplierInvoicesService — money owed TO us BY a supplier.
//
//  Every route 404s when the tenant's broker-deals flag is off; the nav entry
//  is hidden in that case, but a stale tab must not read a 404 as "no invoices".
// ═══════════════════════════════════════════════════════════════════════

export interface SendSupplierInvoiceResult {
  sentTo: string[];
  channel: string;
  pdfFileName: string;
}

/**
 * The send route reports a fallback channel OUTSIDE `data`; the shared
 * ApiResponse has no slot for it, so it is added here rather than widening the
 * shared DTO for one endpoint.
 */
export interface SendSupplierInvoiceResponse extends ApiResponse<SendSupplierInvoiceResult> {
  /** Present when the Microsoft connection expired and SMTP was used instead. */
  tokenExpiredWarning?: string;
}

@Service()
export class SupplierInvoicesService {
  private readonly http = inject(HttpClient);

  /** Newest first, as the API orders them. */
  async list(options: { supplierId?: string | null; includeVoid?: boolean } = {}): Promise<SupplierInvoiceDto[]> {
    let params = new HttpParams();
    if (options.supplierId) params = params.set('supplierId', options.supplierId);
    if (options.includeVoid) params = params.set('includeVoid', 'true');

    const res = await firstValueFrom(
      this.http.get<ApiResponse<SupplierInvoiceDto[]>>(`${API}/supplier-invoices`, { params }),
    );
    return res.success ? res.data ?? [] : [];
  }

  async get(id: string): Promise<SupplierInvoiceDto | null> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<SupplierInvoiceDto>>(`${API}/supplier-invoices/${encodeURIComponent(id)}`),
    );
    return res.success ? res.data ?? null : null;
  }

  /**
   * Raise one invoice per supplier for the period. Idempotent per
   * (tenant, period, supplier), so a repeat call creates nothing and reports the
   * suppliers it skipped.
   */
  async create(from: string, to: string): Promise<CreateSupplierInvoicesResultDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<CreateSupplierInvoicesResultDto>>(`${API}/supplier-invoices`, { from, to }),
    );
    return res.success ? res.data ?? null : null;
  }

  /**
   * What WOULD be invoiced for a period, and what will be skipped.
   *
   * Fetched BEFORE the operator presses the button: the skipped deals otherwise
   * only surface in the result afterwards, and a missing invoice then reads as
   * "nothing was owed".
   */
  async candidates(from: string, to: string): Promise<SupplierInvoiceCandidatesDto | null> {
    const params = new HttpParams().set('from', from).set('to', to);
    const res = await firstValueFrom(
      this.http.get<ApiResponse<SupplierInvoiceCandidatesDto>>(`${API}/supplier-invoices/candidates`, { params }),
    );
    return res.success ? res.data ?? null : null;
  }

  /** Money received from the supplier against an invoice. */
  async addReceipt(
    id: string,
    body: { amount: string; currency: string; receivedAt?: string | null; method?: string | null; note?: string | null },
  ): Promise<SupplierInvoiceDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<SupplierInvoiceDto | null>>(
        `${API}/supplier-invoices/${encodeURIComponent(id)}/receipts`,
        body,
      ),
    );
    return res.success ? res.data ?? null : null;
  }

  async deleteReceipt(id: string, receiptId: string): Promise<SupplierInvoiceDto | null> {
    const res = await firstValueFrom(
      this.http.delete<ApiResponse<SupplierInvoiceDto | null>>(
        `${API}/supplier-invoices/${encodeURIComponent(id)}/receipts/${encodeURIComponent(receiptId)}`,
      ),
    );
    return res.success ? res.data ?? null : null;
  }

  async voidInvoice(id: string, reason: string | null): Promise<SupplierInvoiceDto | null> {
    const res = await firstValueFrom(
      this.http.post<ApiResponse<SupplierInvoiceDto | null>>(
        `${API}/supplier-invoices/${encodeURIComponent(id)}/void`,
        { reason },
      ),
    );
    return res.success ? res.data ?? null : null;
  }

  /**
   * Email the invoice PDF to the supplier.
   *
   * The whole response is returned, not just `data`: the page must surface
   * `message` (no address on file, void invoice) and `tokenExpiredWarning`
   * (the Microsoft connection expired and SMTP was used instead) — an error
   * toast would misreport the latter.
   */
  async send(
    id: string,
    body: { recipientEmails?: string[]; ccEmails?: string[]; bccEmails?: string[]; subject?: string; htmlBody?: string },
  ): Promise<SendSupplierInvoiceResponse> {
    return firstValueFrom(
      this.http.post<SendSupplierInvoiceResponse>(
        `${API}/supplier-invoices/${encodeURIComponent(id)}/send`,
        body,
      ),
    );
  }

  /**
   * Download the PDF through HttpClient so the cookie/CSRF interceptor runs.
   * A plain `<a href>` would be an unauthenticated request and 401.
   * The API answers 400 for a voided invoice.
   */
  async downloadPdf(invoice: { id: string; invoiceNumber: string }): Promise<void> {
    const res: HttpResponse<Blob> = await firstValueFrom(
      this.http.get(`${API}/supplier-invoices/${encodeURIComponent(invoice.id)}/pdf`, {
        responseType: 'blob',
        observe: 'response',
      }),
    );
    const blob = res.body;
    if (!blob) throw new Error('Missing PDF body');
    downloadBlob(blob, filenameFromResponse(res) ?? defaultFileName(invoice.invoiceNumber));
  }
}

function defaultFileName(invoiceNumber: string): string {
  return `Supplier_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}
