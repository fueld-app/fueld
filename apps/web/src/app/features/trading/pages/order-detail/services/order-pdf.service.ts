import { Injectable, inject } from '@angular/core';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_URL, toAbsoluteUrl } from '@app/core/config/api';
import { OrderStatus } from '@fueld/types';

interface PdfModal {
  showLoading(title: string): void;
  showError(): void;
  setBlob(blob: Blob, fileName: string, verifyUrl: string | null): void;
}

interface ShowToast {
  (type: 'error' | 'success' | 'info' | 'warning', message: string): void;
}

@Injectable({ providedIn: 'root' })
export class OrderPdfService {
  private readonly http = inject(HttpClient);

  async viewInvoicePdf(
    orderId: string,
    pdfModal: PdfModal | null,
    hasLineItems: boolean,
    hasBankAccount: boolean,
    showToast: ShowToast,
    invoiceNumber: string | null | undefined,
    orderNumber: string | null | undefined,
    status: string | null | undefined,
  ): Promise<void> {
    if (!orderId) return;
    if (!hasLineItems) {
      showToast('error', 'Add at least one line item before viewing Invoice/Proforma.');
      return;
    }
    if (!hasBankAccount) {
      showToast('error', 'Select a bank account before viewing Invoice/Proforma.');
      return;
    }
    if (!pdfModal) return;

    const isFinalInvoice =
      status === OrderStatus.Delivered ||
      status === OrderStatus.Invoiced ||
      status === OrderStatus.Paid;
    const documentTitle = isFinalInvoice ? 'Invoice' : 'Proforma Invoice';
    const endpoint = isFinalInvoice
      ? `${API_URL}/orders/${orderId}/invoice/pdf`
      : `${API_URL}/orders/${orderId}/proforma/pdf`;
    const fileName = isFinalInvoice
      ? `Fueld_Invoice_${invoiceNumber ?? orderId}.pdf`
      : `Proforma_Invoice_${orderNumber ?? orderId}.pdf`;

    pdfModal.showLoading(documentTitle);
    try {
      const res = await firstValueFrom(
        this.http.get(endpoint, { responseType: 'blob', observe: 'response' }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      pdfModal.setBlob(blob, fileName, this.buildVerifyUrlFromResponse(res));
    } catch {
      pdfModal.showError();
      showToast('error', `Failed to generate ${documentTitle.toLowerCase()} PDF.`);
    }
  }

  async viewOfferPdf(
    orderId: string,
    pdfModal: PdfModal | null,
    hasLineItems: boolean,
    hasInvoicingCompany: boolean,
    showToast: ShowToast,
    isInquiryContext: boolean,
    orderNumber: string | null | undefined,
  ): Promise<void> {
    if (!orderId) return;
    const documentName = isInquiryContext ? 'Offer' : 'Confirmation';
    if (!hasLineItems) {
      showToast('error', `Add at least one line item before generating ${documentName} PDF.`);
      return;
    }
    if (!hasInvoicingCompany) {
      showToast('error', `Select an invoicing company before generating ${documentName} PDF.`);
      return;
    }
    if (!pdfModal) return;

    pdfModal.showLoading(documentName);
    try {
      const res = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${orderId}/offer/pdf`, {
          responseType: 'blob',
          observe: 'response',
        }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      pdfModal.setBlob(
        blob,
        `${documentName}_${orderNumber ?? orderId}.pdf`,
        this.buildVerifyUrlFromResponse(res),
      );
    } catch {
      pdfModal.showError();
      showToast('error', `Failed to generate ${documentName.toLowerCase()} PDF.`);
    }
  }

  async viewProformaPdf(
    orderId: string,
    pdfModal: PdfModal | null,
    hasLineItems: boolean,
    hasSupplier: boolean,
    hasInvoicingCompany: boolean,
    showToast: ShowToast,
    hasMultipleOrderSuppliers: boolean,
    activeOrderSupplierId: string | null | undefined,
    orderNumber: string | null | undefined,
  ): Promise<void> {
    if (!orderId) return;
    if (!hasLineItems) {
      showToast('error', 'Add at least one line item before generating Nomination PDF.');
      return;
    }
    if (!hasSupplier) {
      showToast('error', 'Select a supplier before generating Nomination PDF.');
      return;
    }
    if (!hasInvoicingCompany) {
      showToast('error', 'Select an invoicing company before generating Nomination PDF.');
      return;
    }
    if (!pdfModal) return;

    pdfModal.showLoading('Nomination');
    const supplierQuery =
      hasMultipleOrderSuppliers && activeOrderSupplierId
        ? `?orderSupplierId=${encodeURIComponent(activeOrderSupplierId)}`
        : '';

    try {
      const res = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${orderId}/nomination/pdf${supplierQuery}`, {
          responseType: 'blob',
          observe: 'response',
        }),
      );
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      pdfModal.setBlob(
        blob,
        `Nomination_${orderNumber ?? orderId}.pdf`,
        this.buildVerifyUrlFromResponse(res),
      );
    } catch {
      pdfModal.showError();
      showToast('error', 'Failed to generate nomination PDF.');
    }
  }

  buildVerifyUrlFromResponse(res: HttpResponse<Blob>): string | null {
    const token = res.headers.get('X-Document-Verify-Token')?.trim();
    return token ? toAbsoluteUrl(`${API_URL}/verify/token/${token}`) : null;
  }
}