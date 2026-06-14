import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, SupplierInquiryReplyRow } from '../order-detail-page.component';
import { API_URL } from '@app/core/config/api';

export interface InquirySupplierPerformance {
  deliveredCountOverall: number;
  deliveredCountAtPlace: number;
  sentCount: number;
  quotedCount: number;
  declinedCount: number;
  noReplyCount: number;
  respondedCount: number;
  deliverableCount: number;
  nonDeliverableCount: number;
  averageResponseHours: number | null;
}

@Injectable({ providedIn: 'root' })
export class OrderReplyService {
  private readonly http = inject(HttpClient);

  readonly editingReplyId = signal<string | null>(null);
  readonly replyStatus = signal<'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'>('SENT');
  readonly replyRespondedAt = signal('');
  readonly replyDeclineReason = signal('');
  readonly replyPrices = signal<Record<string, string>>({});
  readonly replyNotes = signal<Record<string, string>>({});
  readonly replyQuoteValidUntil = signal('');
  readonly replyDeliveryWindow = signal('');
  readonly replySupplierPaymentTerms = signal('');
  readonly replySupplierComment = signal('');
  readonly replySavingId = signal<string | null>(null);

  openEditor(row: SupplierInquiryReplyRow): void {
    this.editingReplyId.set(row.id);
    this.replyStatus.set(row.status);
    this.replyRespondedAt.set(this.fmtDateTime(row.respondedAt));
    this.replyDeclineReason.set(row.declineReason ?? '');
    this.replyPrices.set(Object.fromEntries(row.items.map((item) => [item.orderItemId, item.price ?? ''])));
    this.replyNotes.set(Object.fromEntries(row.items.map((item) => [item.orderItemId, item.note ?? ''])));
    this.replyQuoteValidUntil.set(this.fmtDateTime(row.quoteValidUntil));
    this.replyDeliveryWindow.set(row.deliveryWindow ?? '');
    this.replySupplierPaymentTerms.set(row.supplierPaymentTerms ?? '');
    this.replySupplierComment.set(row.supplierComment ?? '');
  }

  cancelEditor(): void {
    this.editingReplyId.set(null);
    this.replyStatus.set('SENT');
    this.replyRespondedAt.set('');
    this.replyDeclineReason.set('');
    this.replyPrices.set({});
    this.replyNotes.set({});
    this.replyQuoteValidUntil.set('');
    this.replyDeliveryWindow.set('');
    this.replySupplierPaymentTerms.set('');
    this.replySupplierComment.set('');
  }

  isEditing(row: SupplierInquiryReplyRow): boolean {
    return this.editingReplyId() === row.id;
  }

  setStatus(status: 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY'): void {
    this.replyStatus.set(status);
    if (status === 'SENT' || status === 'NO_REPLY') { this.replyRespondedAt.set(''); this.replyDeclineReason.set(''); }
    if (status !== 'DECLINED') this.replyDeclineReason.set('');
  }

  setPrice(orderItemId: string, value: string): void {
    this.replyPrices.update((p) => ({ ...p, [orderItemId]: String(value ?? '') }));
  }
  setNote(orderItemId: string, value: string): void {
    this.replyNotes.update((p) => ({ ...p, [orderItemId]: String(value ?? '') }));
  }

  canSave(row: SupplierInquiryReplyRow): boolean {
    const s = this.replyStatus();
    if (s === 'QUOTED') return !!this.replyRespondedAt() && row.items.some((i) => String(this.replyPrices()[i.orderItemId] ?? '').trim().length > 0);
    if (s === 'DECLINED') return !!this.replyRespondedAt() && this.replyDeclineReason().trim().length > 0;
    return true;
  }

  async save(row: SupplierInquiryReplyRow, orderId: string, reloadReplies: () => Promise<void>, reloadContext: () => Promise<void>, showToast: (type: 'success' | 'error', msg: string) => void): Promise<void> {
    if (!orderId) return;
    this.replySavingId.set(row.id);
    try {
      const s = this.replyStatus();
      const body = {
        status: s,
        respondedAt: (s === 'QUOTED' || s === 'DECLINED') ? this.toIso(this.replyRespondedAt()) : null,
        declineReason: s === 'DECLINED' ? this.replyDeclineReason().trim() : null,
        quoteValidUntil: s === 'QUOTED' ? this.toIso(this.replyQuoteValidUntil()) : null,
        deliveryWindow: s === 'QUOTED' ? this.replyDeliveryWindow().trim() : null,
        supplierPaymentTerms: s === 'QUOTED' ? this.replySupplierPaymentTerms().trim() : null,
        supplierComment: s === 'QUOTED' ? this.replySupplierComment().trim() : null,
        items: s === 'QUOTED' ? row.items.map((i) => ({
          orderItemId: i.orderItemId,
          price: String(this.replyPrices()[i.orderItemId] ?? '').trim() || null,
          note: String(this.replyNotes()[i.orderItemId] ?? '').trim() || null,
        })) : [],
      };
      const res = await firstValueFrom(this.http.patch<ApiResponse<{ updated: boolean }>>(`${API_URL}/orders/${orderId}/inquiry/sent/${row.id}`, body));
      if (!res.success) { showToast('error', res.message ?? 'Failed to save.'); return; }
      await Promise.all([reloadReplies(), reloadContext()]);
      this.cancelEditor();
      showToast('success', `Updated reply for ${row.supplierName}.`);
    } catch { showToast('error', 'Failed to save reply.'); }
    finally { this.replySavingId.set(null); }
  }

  statusBadgeClass(status: string): string {
    const map: Record<string, string> = { SENT: 'bg-blue-100 text-blue-700', QUOTED: 'bg-green-100 text-green-700', DECLINED: 'bg-red-100 text-red-700' };
    return map[status] ?? 'bg-gray-100 text-gray-500';
  }

  fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmtDateTime(iso: string | null | undefined): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  quoteRateLabel(perf: InquirySupplierPerformance): string {
    if (perf.sentCount <= 0 || perf.quotedCount <= 0) return '';
    return `${Math.round((perf.quotedCount / perf.sentCount) * 100)}% quote rate`;
  }

  avgResponseLabel(perf: InquirySupplierPerformance): string {
    if (perf.averageResponseHours == null || perf.respondedCount <= 0) return '';
    return perf.averageResponseHours >= 24
      ? `${Number((perf.averageResponseHours / 24).toFixed(1))}d avg reply`
      : `${Number(perf.averageResponseHours.toFixed(1))}h avg reply`;
  }

  responseHoursLabel(hours: number): string {
    if (hours >= 24) return `${(hours / 24).toFixed(1)}d`;
    return `${hours.toFixed(0)}h`;
  }

  private toIso(value: string): string | null {
    return value || value.includes('T') ? value : value ? `${value}:00` : null;
  }

  private fmtDateTimeInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 16);
  }
}
