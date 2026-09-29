import { Service, inject } from '@angular/core';
import { HttpClient, HttpParams, type HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  CreateSupplierInvoicesResultDto,
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
