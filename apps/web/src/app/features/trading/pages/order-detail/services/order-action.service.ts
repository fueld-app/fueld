import { Service, inject } from '@angular/core';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  OrderDto,
  OrderStatus,
  CounterpartyDto,
  DeliveryDocumentationSettingsDto,
} from '@fueld/types';
import type { OrderItemRow } from '../../../components/order-items/order-item.types';
import { API_URL, toAbsoluteUrl } from '@app/core/config/api';
import { OrderFinancialService } from './order-financial.service';
import { OrderPortDocumentationService } from './order-port-documentation.service';
import { OrderReferenceDataService } from './order-reference-data.service';
import { OrderInquiryService } from './order-inquiry.service';
import { OrderSupplierService } from './order-supplier.service';

export interface OrderActionContext {
  order: () => OrderDto | null;
  orderId: () => string;
  itemRows: () => OrderItemRow[];
  hasLineItems: () => boolean;
  hasBankAccount: () => boolean;
  hasInvoicingCompany: () => boolean;
  hasEta: () => boolean;
  hasSupplier: () => boolean;
  isReadonly: () => boolean;
  isInquiryContext: () => boolean;
  isResponsibleUser: () => boolean;
  isPaidOrCancelled: () => boolean;
  deliveredQtyComplete: () => boolean;
  hasDeliveryDocumentation: () => boolean;
  hasInventoryShortage: () => boolean;
  hasEnoughPaymentsForMarkPaid: () => boolean;
  hasIncompleteDraftItems: (rows: OrderItemRow[]) => boolean;
  activeOrderSupplier: () => { id: string; companyId?: string | null } | null;
  hasMultipleOrderSuppliers: () => boolean;
  invoiceNumber: () => string;
  availableInquiryCancelReasons: () => string[];
  deliveryDocumentationSettings: () => DeliveryDocumentationSettingsDto;
  getEffectiveDeliveredQuantity: (row: OrderItemRow) => number | null;
  buildItemPayload: (rows: OrderItemRow[], options?: { fillMissingDeliveredQuantity?: boolean }) => Record<string, string | null>[];
  pdfModal: () => { showLoading: (title: string) => void; setBlob: (blob: Blob, fileName: string, verifyUrl: string | null) => void; showError: () => void } | null;
  convertModalRef: () => { show: () => void; close: () => void } | null;
  cancelModalRef: () => { show: () => void; close: () => void } | null;
  openPaymentModal: () => void;
  openSendEmailModal: (docType: string) => void;
  openSendInquiryModal: () => void;
  openBookingEmailModal: () => void;
  syncOrderSupplierRecords: (orderId: string) => Promise<void>;
  clearSavedDraftItemIds: (rows: OrderItemRow[]) => void;
  normalizeDetailRoute: (status: OrderStatus, id: string) => Promise<void>;
  updateOrder: (updater: (o: OrderDto) => OrderDto) => void;
  setConvertingToOrder: (v: boolean) => void;
  setCancellingInquiry: (v: boolean) => void;
  setItemRows: (rows: OrderItemRow[]) => void;
  setSaving: (v: boolean) => void;
  showToast: (type: 'success' | 'error', msg: string) => void;
}

@Service()
export class OrderActionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly financialSvc = inject(OrderFinancialService);
  private readonly portDocSvc = inject(OrderPortDocumentationService);
  private readonly refData = inject(OrderReferenceDataService);
  private readonly inquirySvc = inject(OrderInquiryService);
  private readonly supplierSvc = inject(OrderSupplierService);

  async onAction(action: string, ctx: OrderActionContext): Promise<void> {
    switch (action) {
      case 'generate-invoice':
        if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before viewing Invoice/Proforma.'); break; }
        if (!ctx.hasBankAccount()) { ctx.showToast('error', 'Select a bank account before viewing Invoice/Proforma.'); break; }
        await this.viewInvoicePdf(ctx);
        break;
      case 'view-offer':
        if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before generating Confirmation PDF.'); break; }
        if (!ctx.hasInvoicingCompany()) { ctx.showToast('error', 'Select an invoicing company before generating Confirmation PDF.'); break; }
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before generating Confirmation PDF.'); break; }
        await this.viewOfferPdf(ctx);
        break;
      case 'view-proforma':
        if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before generating Nomination PDF.'); break; }
        if (!ctx.hasSupplier()) { ctx.showToast('error', 'Select a supplier before generating Nomination PDF.'); break; }
        if (!ctx.hasInvoicingCompany()) { ctx.showToast('error', 'Select an invoicing company before generating Nomination PDF.'); break; }
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before generating Nomination PDF.'); break; }
        await this.viewProformaPdf(ctx);
        break;
      case 'convert-to-order':
        this.openConvertToOrderModal(ctx);
        break;
      case 'cancel-inquiry':
      case 'cancel-order':
        this.openCancelInquiryModal(ctx);
        break;
      case 'send-email':
        if (!ctx.isResponsibleUser()) { ctx.showToast('error', 'Only the responsible user can send this email.'); break; }
        ctx.openSendEmailModal('INVOICE');
        break;
      case 'send-offer':
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before sending.'); break; }
        ctx.openSendEmailModal('OFFER');
        break;
      case 'send-confirmation':
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before sending.'); break; }
        ctx.openSendEmailModal('CONFIRMATION');
        break;
      case 'send-nomination':
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before sending.'); break; }
        ctx.openSendEmailModal('NOMINATION');
        break;
      case 'send-proforma':
        if (!ctx.hasEta()) { ctx.showToast('error', 'Set an ETA before sending.'); break; }
        ctx.openSendEmailModal('PROFORMA');
        break;
      case 'send-invoice':
        ctx.openSendEmailModal('INVOICE');
        break;
      case 'send-port-documentation':
        if (!(await this.ensurePortDocumentationReadyForSend(ctx))) { break; }
        ctx.openSendEmailModal('PORT_DOCUMENTATION');
        break;
      case 'send-inquiry':
        ctx.openSendInquiryModal();
        break;
      case 'send-booking':
        ctx.openBookingEmailModal();
        break;
      case 'mark-paid':
        await this.markPaid(ctx);
        break;
      case 'sync-quickbooks':
        await this.syncToQuickBooks(ctx);
        break;
      case 'mark-delivered':
        await this.markDelivered(ctx);
        break;
      case 'reopen-order':
        await this.reopenOrder(ctx);
        break;
    }
  }

  private async ensurePortDocumentationReadyForSend(ctx: OrderActionContext): Promise<boolean> {
    const ready = await this.portDocSvc.ensureReadyForSend(ctx.orderId(), ctx.activeOrderSupplier()?.id ?? null);
    if (!ready) {
      const enabled = this.portDocSvc.portDocumentationContext()?.enabled;
      if (enabled === false) {
        ctx.showToast('error', 'Port Documentation is not enabled for this order.');
      } else {
        const warnings = this.portDocSvc.portDocumentationContext()?.readinessWarnings ?? [];
        ctx.showToast('error', warnings[0] ?? 'Port Documentation could not be prepared automatically.');
      }
    }
    return ready;
  }

  openConvertToOrderModal(ctx: OrderActionContext): void {
    if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before converting to order.'); return; }
    ctx.convertModalRef()?.show();
  }

  openCancelInquiryModal(ctx: OrderActionContext): void {
    const status = ctx.order()?.status;
    const canCancel = status === 'INQUIRY' || status === 'OFFER' || status === 'CONFIRMED' || status === 'DELIVERED' || status === 'INVOICED';
    if (!canCancel) { ctx.showToast('error', 'This record cannot be cancelled from this action.'); return; }
    if (!ctx.availableInquiryCancelReasons().length) { ctx.showToast('error', 'No cancellation reasons configured.'); return; }
    ctx.cancelModalRef()?.show();
  }

  async confirmConvertToOrder(ctx: OrderActionContext): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before converting to order.'); return; }
    if (ctx.hasInventoryShortage()) {
      ctx.showToast('error', 'One or more tracked line items are short on inventory. Adjust quantity, warehouse, or planned date before confirming.');
      return;
    }

    ctx.setConvertingToOrder(true);
    try {
      const res = await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status: 'CONFIRMED' }));
      if (res.success) {
        ctx.updateOrder((o) => ({ ...o, status: 'CONFIRMED' as OrderStatus }));
        ctx.convertModalRef()?.close();
        ctx.showToast('success', 'Inquiry converted to order.');
        await this.router.navigate(['/trading/orders', id]);
      } else {
        ctx.showToast('error', res.message ?? 'Failed to convert inquiry.');
      }
    } catch {
      ctx.showToast('error', 'Failed to convert inquiry.');
    } finally {
      ctx.setConvertingToOrder(false);
    }
  }

  async confirmCancelInquiry(ctx: OrderActionContext, event: { reason: string; reasonOther?: string }): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    const isInquiry = ctx.isInquiryContext();
    const reason = event.reason.trim();
    if (!reason) return;
    const lossReason = reason === 'Other' ? `Other: ${(event.reasonOther ?? '').trim()}` : reason;
    if (reason === 'Other' && !event.reasonOther?.trim()) return;

    ctx.setCancellingInquiry(true);
    try {
      const res = await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status: 'CANCELLED', lossReason }));
      if (res.success) {
        // API decides actual status: LOST for inquiries, CANCELLED for orders
        const newStatus = isInquiry ? ('LOST' as OrderStatus) : ('CANCELLED' as OrderStatus);
        ctx.updateOrder((o) => ({ ...o, status: newStatus, lossReason }));
        const updatedOrder = ctx.order();
        if (updatedOrder?.clientId) await this.financialSvc.loadCustomerCreditLines(updatedOrder.clientId);
        await this.financialSvc.loadSupplierCreditLines(ctx.activeOrderSupplier()?.companyId ?? updatedOrder?.supplierId);
        ctx.cancelModalRef()?.close();
        ctx.showToast('success', `${isInquiry ? 'Inquiry' : 'Order'} cancelled.`);
        await ctx.normalizeDetailRoute(newStatus, id);
      } else {
        ctx.showToast('error', res.message ?? `Failed to cancel ${isInquiry ? 'inquiry' : 'order'}.`);
      }
    } catch {
      ctx.showToast('error', `Failed to cancel ${isInquiry ? 'inquiry' : 'order'}.`);
    } finally {
      ctx.setCancellingInquiry(false);
    }
  }

  private async markDelivered(ctx: OrderActionContext): Promise<void> {
    const status = ctx.order()?.status;
    const id = ctx.orderId();
    if (status !== 'CONFIRMED') { ctx.showToast('error', 'Only confirmed orders can be marked as delivered.'); return; }
    if (!id) return;
    if (!ctx.hasLineItems()) { ctx.showToast('error', 'Add at least one line item before marking delivered.'); return; }
    if (!ctx.order()?.deliveredAt) { ctx.showToast('error', 'Enter delivered date before marking delivered.'); return; }
    if (!ctx.deliveredQtyComplete()) { ctx.showToast('error', 'Enter delivered quantity for every line item before marking delivered.'); return; }
    const docSettings = ctx.deliveryDocumentationSettings();
    if (docSettings.requireDeliveryDocumentation && !ctx.hasDeliveryDocumentation()) {
      ctx.showToast('error', 'Upload required delivery documentation before marking delivered.'); return;
    }

    const normalizedRows = ctx.itemRows().map((row) => ({ ...row, deliveredQuantity: ctx.getEffectiveDeliveredQuantity(row) }));
    try {
      const itemsRes = await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, {
        items: ctx.buildItemPayload(normalizedRows, { fillMissingDeliveredQuantity: true }),
      }));
      this.requireApiSuccess(itemsRes);
      ctx.setItemRows(normalizedRows);
    } catch {
      ctx.showToast('error', 'Failed to save delivered quantities.');
      return;
    }
    await this.setOrderStatus(ctx, 'DELIVERED');
  }

  private async reopenOrder(ctx: OrderActionContext): Promise<void> {
    const status = ctx.order()?.status;
    if (status !== 'DELIVERED' && status !== 'INVOICED') { ctx.showToast('error', 'Only delivered or invoiced orders can be reopened.'); return; }
    await this.setOrderStatus(ctx, 'CONFIRMED');
    ctx.showToast('success', 'Order reopened for editing.');
  }

  private async setOrderStatus(ctx: OrderActionContext, status: string): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    try {
      await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/status`, { status }));
      ctx.updateOrder((o) => ({ ...o, status: status as OrderStatus }));
    } catch {
      ctx.showToast('error', 'Failed to update order status.');
    }
  }

  async saveOrder(ctx: OrderActionContext): Promise<void> {
    const id = ctx.orderId();
    const o = ctx.order();
    if (!id || !o) return;
    if (ctx.hasIncompleteDraftItems(ctx.itemRows())) {
      ctx.showToast('error', 'Complete supplier and product on new line items before saving.');
      return;
    }

    ctx.setSaving(true);
    try {
      const orderRes = await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}`, {
        clientId: o.clientId, vesselId: o.vesselId, placeId: o.placeId,
        salesRepId: o.salesRepId ?? null, invoicingCompanyId: o.invoicingCompanyId,
        bankAccountId: o.bankAccountId ?? null, currency: o.currency,
        customerPaymentTermType: o.customerPaymentTermType ?? null, customerCreditDays: o.customerCreditDays ?? null,
        customerNote: o.customerNote ?? null, purchaseOrderNumber: o.purchaseOrderNumber ?? null,
        customerContactId: o.customerContactId ?? null, supplierId: o.supplierId ?? null,
        supplierPaymentTermType: o.supplierPaymentTermType ?? null, supplierCreditDays: o.supplierCreditDays ?? null,
        supplierNote: o.supplierNote ?? null, supplierContactId: o.supplierContactId ?? null,
        brokerId: o.brokerId ?? null, brokerContactId: o.brokerContactId ?? null,
        brokerGetsAll: o.brokerGetsAll ?? false, agentId: o.agentId ?? null,
        agentContactId: o.agentContactId ?? null, termsAndConditions: o.termsAndConditions ?? null,
        categoryKey: o.categoryKey ?? null, eta: o.eta, etd: o.etd, deliveredAt: o.deliveredAt ?? null,
        deliveryMethod: (o as any).deliveryMethod ?? null,
      }));
      this.requireApiSuccess(orderRes);

      await ctx.syncOrderSupplierRecords(id);
      const itemRows = ctx.itemRows();
      const itemPayload = ctx.buildItemPayload(itemRows).map((item: Record<string, string | null>) => ({
        ...item,
        costCurrency: item['costCurrency'] ?? o.currency,
        salesCurrency: item['salesCurrency'] ?? o.currency,
      }));
      const itemsRes = await firstValueFrom(this.http.put<ApiResponse<any>>(`${API_URL}/orders/${id}/items`, { items: itemPayload }));
      this.requireApiSuccess(itemsRes);
      ctx.clearSavedDraftItemIds(itemRows);
      await this.financialSvc.loadCustomerCreditLines(o.clientId);
      await this.financialSvc.loadSupplierCreditLines(ctx.activeOrderSupplier()?.companyId ?? o.supplierId);
      ctx.showToast('success', 'Order saved successfully.');
    } catch {
      ctx.showToast('error', 'Failed to save order.');
    } finally {
      ctx.setSaving(false);
    }
  }

  private async viewInvoicePdf(ctx: OrderActionContext): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    const status = ctx.order()?.status;
    const isFinalInvoice = status === 'DELIVERED' || status === 'INVOICED' || status === 'PAID';
    const documentTitle = isFinalInvoice ? 'Invoice' : 'Proforma Invoice';
    const endpoint = isFinalInvoice ? `${API_URL}/orders/${id}/invoice/pdf` : `${API_URL}/orders/${id}/proforma/pdf`;
    const fileName = isFinalInvoice ? `Fueld_Invoice_${ctx.invoiceNumber()}.pdf` : `Proforma_Invoice_${ctx.order()?.orderNumber ?? id}.pdf`;
    const modal = ctx.pdfModal();
    if (!modal) return;
    modal.showLoading(documentTitle);
    try {
      const res = await firstValueFrom(this.http.get(endpoint, { responseType: 'blob', observe: 'response' }));
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(blob, fileName, this.buildVerifyUrlFromResponse(res));
    } catch {
      modal.showError();
      ctx.showToast('error', `Failed to generate ${documentTitle.toLowerCase()} PDF.`);
    }
  }

  private async viewOfferPdf(ctx: OrderActionContext): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    const isInquiry = ctx.isInquiryContext();
    const documentName = isInquiry ? 'Offer' : 'Confirmation';
    const modal = ctx.pdfModal();
    if (!modal) return;
    modal.showLoading(documentName);
    try {
      const res = await firstValueFrom(this.http.get(`${API_URL}/orders/${id}/offer/pdf`, { responseType: 'blob', observe: 'response' }));
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(blob, `${documentName}_${ctx.order()?.orderNumber ?? id}.pdf`, this.buildVerifyUrlFromResponse(res));
    } catch {
      modal.showError();
      ctx.showToast('error', `Failed to generate ${documentName.toLowerCase()} PDF.`);
    }
  }

  private async viewProformaPdf(ctx: OrderActionContext): Promise<void> {
    const id = ctx.orderId();
    if (!id) return;
    const modal = ctx.pdfModal();
    if (!modal) return;
    modal.showLoading('Nomination');
    const supplierQuery = ctx.hasMultipleOrderSuppliers() && ctx.activeOrderSupplier()?.id
      ? `?orderSupplierId=${encodeURIComponent(ctx.activeOrderSupplier()!.id)}`
      : '';
    try {
      const res = await firstValueFrom(this.http.get(`${API_URL}/orders/${id}/nomination/pdf${supplierQuery}`, { responseType: 'blob', observe: 'response' }));
      const blob = res.body;
      if (!blob) throw new Error('Missing PDF body');
      modal.setBlob(blob, `Nomination_${ctx.order()?.orderNumber ?? id}.pdf`, this.buildVerifyUrlFromResponse(res));
    } catch {
      modal.showError();
      ctx.showToast('error', 'Failed to generate nomination PDF.');
    }
  }

  private async markPaid(ctx: OrderActionContext): Promise<void> {
    if (ctx.order()?.status === 'PAID') { ctx.showToast('error', 'Order is already marked as paid.'); return; }
    if (!ctx.hasEnoughPaymentsForMarkPaid()) { ctx.showToast('error', 'Add payments equal to the total due before marking as paid.'); ctx.openPaymentModal(); return; }
    ctx.openPaymentModal();
  }

  private async syncToQuickBooks(ctx: OrderActionContext): Promise<void> {
    const orderId = ctx.orderId();
    ctx.showToast('success', 'Syncing to QuickBooks…');
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ qbInvoiceId: string; qbInvoiceNumber: string }>>(
          `${API_URL}/admin/settings/integrations/quickbooks/sync-order/${orderId}`,
          {},
        ),
      );
      if (res.success && res.data) {
        ctx.showToast('success', `Synced to QuickBooks — Invoice #${res.data.qbInvoiceNumber}`);
      } else {
        ctx.showToast('error', res.message ?? 'Failed to sync to QuickBooks.');
      }
    } catch (err: any) {
      const msg = err?.error?.message ?? 'Failed to sync to QuickBooks. Is QuickBooks connected?';
      ctx.showToast('error', msg);
    }
  }

  private buildVerifyUrlFromResponse(res: HttpResponse<Blob>): string | null {
    const token = res.headers.get('X-Document-Verify-Token')?.trim();
    return token ? toAbsoluteUrl(`${API_URL}/verify/token/${token}`) : null;
  }

  private requireApiSuccess(response: ApiResponse<any>): void {
    if (!response.success) throw new Error(response.message ?? 'Request failed');
  }
}