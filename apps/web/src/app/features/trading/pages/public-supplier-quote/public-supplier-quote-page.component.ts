import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PublicSupplierInquiryDto, SubmitSupplierInquiryQuoteDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-public-supplier-quote-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="min-h-screen bg-slate-100 px-4 py-10">
      <div class="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div class="border-b border-slate-200 px-8 py-6">
          <h1 class="text-2xl font-semibold text-slate-900">Supplier Quote</h1>
          <p class="mt-1 text-sm text-slate-500">Submit one price per line item without logging in.</p>
        </div>

        @if (loading()) {
          <div class="px-8 py-14 text-center text-sm text-slate-400">Loading quote request...</div>
        } @else if (loadError()) {
          <div class="px-8 py-14 text-center">
            <p class="text-sm font-medium text-red-600">{{ loadError() }}</p>
          </div>
        } @else if (inquiry()) {
          <div class="space-y-6 px-8 py-6">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div class="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Supplier</div>
                  <div class="mt-1 font-medium text-slate-900">{{ inquiry()!.supplierName }}</div>
                  @if (inquiry()!.contactName) {
                    <div class="mt-1 text-xs text-slate-500">Attention {{ inquiry()!.contactName }}</div>
                  }
                </div>
                <div>
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Voyage</div>
                  <div class="mt-1 font-medium text-slate-900">{{ inquiry()!.vesselName }} · {{ inquiry()!.portName }}</div>
                  @if (inquiry()!.eta) {
                    <div class="mt-1 text-xs text-slate-500">ETA {{ formatDate(inquiry()!.eta!) }}</div>
                  }
                </div>
              </div>
            </div>

            @if (inquiry()!.responseDeadlineAt) {
              <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Please reply by <strong>{{ formatDateTime(inquiry()!.responseDeadlineAt!) }}</strong>.
              </div>
            }

            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Can you deliver?</div>
              <div class="mt-3 flex gap-3">
                <button
                  type="button"
                  (click)="canDeliver.set(true)"
                  class="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  [class.bg-emerald-600]="canDeliver()"
                  [class.text-white]="canDeliver()"
                  [class.bg-slate-100]="!canDeliver()"
                  [class.text-slate-600]="!canDeliver()"
                >Yes, we can deliver</button>
                <button
                  type="button"
                  (click)="canDeliver.set(false)"
                  class="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  [class.bg-rose-600]="!canDeliver()"
                  [class.text-white]="!canDeliver()"
                  [class.bg-slate-100]="canDeliver()"
                  [class.text-slate-600]="canDeliver()"
                >No, we cannot deliver</button>
              </div>
            </div>

            @if (canDeliver()) {
              <div class="space-y-3">
                @for (item of inquiry()!.items; track item.orderItemId) {
                  <div class="rounded-2xl border border-slate-200 p-4">
                    <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div class="text-sm font-semibold text-slate-900">{{ item.productType }}</div>
                        <div class="mt-1 text-sm text-slate-600">{{ item.quantity }} {{ item.unit }}@if (item.description) { · {{ item.description }} }</div>
                      </div>
                      <div class="w-full md:w-56">
                        <label class="mb-2 flex items-center gap-2 text-xs font-medium text-slate-600">
                          <input
                            type="checkbox"
                            class="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            [ngModel]="quotedItemMap()[item.orderItemId]"
                            (ngModelChange)="setQuotedItem(item.orderItemId, $event)"
                          />
                          Quote this line
                        </label>
                        <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Price ({{ inquiry()!.currency }})</label>
                        <input
                          type="number"
                          min="0"
                          step="0.0001"
                          [ngModel]="priceByItem()[item.orderItemId] || ''"
                          (ngModelChange)="setItemPrice(item.orderItemId, $event)"
                          [disabled]="!quotedItemMap()[item.orderItemId]"
                          class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-right text-sm text-slate-900
                                 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                                 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                        />
                        <label class="mt-3 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Line note</label>
                        <textarea
                          rows="2"
                          [ngModel]="noteByItem()[item.orderItemId] || ''"
                          (ngModelChange)="setItemNote(item.orderItemId, $event)"
                          class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                          [placeholder]="quotedItemMap()[item.orderItemId] ? 'Optional note for this line' : 'Why is this line not quoted?'"
                        ></textarea>
                      </div>
                    </div>
                  </div>
                }
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Quote valid until</label>
                  <input
                    type="datetime-local"
                    [ngModel]="quoteValidUntil()"
                    (ngModelChange)="quoteValidUntil.set($event)"
                    class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Delivery window</label>
                  <input
                    type="text"
                    [ngModel]="deliveryWindow()"
                    (ngModelChange)="deliveryWindow.set($event)"
                    class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Ex. 12 Mar AM barge"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Payment terms</label>
                  <input
                    type="text"
                    [ngModel]="supplierPaymentTerms()"
                    (ngModelChange)="supplierPaymentTerms.set($event)"
                    class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Ex. Net 30 days"
                  />
                </div>
                <div class="md:col-span-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Comments</label>
                  <textarea
                    rows="3"
                    [ngModel]="supplierComment()"
                    (ngModelChange)="supplierComment.set($event)"
                    class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Add any remarks, assumptions, or exclusions"
                  ></textarea>
                </div>
              </div>
            } @else {
              <div>
                <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Why can you not deliver?</label>
                <textarea
                  rows="4"
                  [ngModel]="declineReason()"
                  (ngModelChange)="declineReason.set($event)"
                  class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="Please explain why this stem cannot be supplied"
                ></textarea>
              </div>
            }

            @if (submitError()) {
              <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ submitError() }}</div>
            }
            @if (submitSuccess()) {
              <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Quote submitted successfully.</div>
            }

            <div class="flex justify-end">
              <button
                type="button"
                (click)="submit()"
                [disabled]="submitting() || !canSubmit()"
                class="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {{ submitting() ? 'Submitting...' : canDeliver() ? 'Submit Quote' : 'Submit Response' }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class PublicSupplierQuotePageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly token = signal(this.route.snapshot.paramMap.get('token') ?? '');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly inquiry = signal<PublicSupplierInquiryDto | null>(null);
  readonly canDeliver = signal(true);
  readonly declineReason = signal('');
  readonly priceByItem = signal<Record<string, string>>({});
  readonly noteByItem = signal<Record<string, string>>({});
  readonly quotedItemMap = signal<Record<string, boolean>>({});
  readonly quoteValidUntil = signal('');
  readonly deliveryWindow = signal('');
  readonly supplierPaymentTerms = signal('');
  readonly supplierComment = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal('');
  readonly submitSuccess = signal(false);
  readonly canSubmit = computed(() => {
    const inquiry = this.inquiry();
    if (!inquiry) return false;
    if (!this.canDeliver()) return this.declineReason().trim().length > 0;
    const quotedItems = inquiry.items.filter((item) => this.quotedItemMap()[item.orderItemId]);
    return quotedItems.length > 0
      && quotedItems.every((item) => String(this.priceByItem()[item.orderItemId] ?? '').trim().length > 0);
  });

  constructor() {
    void this.load();
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  setItemPrice(orderItemId: string, value: string): void {
    this.priceByItem.update((current) => ({ ...current, [orderItemId]: String(value ?? '') }));
  }

  setItemNote(orderItemId: string, value: string): void {
    this.noteByItem.update((current) => ({ ...current, [orderItemId]: String(value ?? '') }));
  }

  setQuotedItem(orderItemId: string, value: boolean): void {
    this.quotedItemMap.update((current) => ({ ...current, [orderItemId]: !!value }));
  }

  async submit(): Promise<void> {
    const token = this.token();
    const inquiry = this.inquiry();
    if (!token || !inquiry) return;

    this.submitting.set(true);
    this.submitError.set('');
    this.submitSuccess.set(false);

    const payload: SubmitSupplierInquiryQuoteDto = {
      canDeliver: this.canDeliver(),
      declineReason: this.canDeliver() ? null : this.declineReason().trim(),
      quoteValidUntil: this.canDeliver() ? this.toIsoFromDateTimeLocal(this.quoteValidUntil()) : null,
      deliveryWindow: this.canDeliver() ? this.deliveryWindow().trim() : null,
      supplierPaymentTerms: this.canDeliver() ? this.supplierPaymentTerms().trim() : null,
      supplierComment: this.canDeliver() ? this.supplierComment().trim() : null,
      items: this.canDeliver()
        ? inquiry.items.map((item) => ({
          orderItemId: item.orderItemId,
          price: this.quotedItemMap()[item.orderItemId]
            ? String(this.priceByItem()[item.orderItemId] ?? '').trim()
            : null,
          note: String(this.noteByItem()[item.orderItemId] ?? '').trim() || null,
        }))
        : [],
    };

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ submitted: boolean }>>(`${API}/supplier-inquiries/${token}/quote`, payload),
      );
      if (res.success) {
        this.submitSuccess.set(true);
        await this.load();
      } else {
        this.submitError.set(res.message ?? 'Failed to submit quote');
      }
    } catch {
      this.submitError.set('Failed to submit quote');
    } finally {
      this.submitting.set(false);
    }
  }

  private async load(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.loading.set(false);
      this.loadError.set('Supplier inquiry link is missing');
      return;
    }

    this.loading.set(true);
    this.loadError.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PublicSupplierInquiryDto>>(`${API}/supplier-inquiries/${token}`),
      );
      if (res.success) {
        this.inquiry.set(res.data);
        this.canDeliver.set(res.data.canDeliver ?? true);
        this.declineReason.set(res.data.declineReason ?? '');
        this.priceByItem.set(
          Object.fromEntries(res.data.items.map((item) => [item.orderItemId, item.price ?? ''])),
        );
        this.noteByItem.set(
          Object.fromEntries(res.data.items.map((item) => [item.orderItemId, item.note ?? ''])),
        );
        this.quotedItemMap.set(
          Object.fromEntries(res.data.items.map((item) => [item.orderItemId, item.price !== null || !item.note])),
        );
        this.quoteValidUntil.set(this.toDateTimeLocal(res.data.quoteValidUntil ?? ''));
        this.deliveryWindow.set(res.data.deliveryWindow ?? '');
        this.supplierPaymentTerms.set(res.data.supplierPaymentTerms ?? '');
        this.supplierComment.set(res.data.supplierComment ?? '');
      } else {
        this.loadError.set(res.message ?? 'Supplier inquiry link is invalid or expired');
      }
    } catch {
      this.loadError.set('Supplier inquiry link is invalid or expired');
    } finally {
      this.loading.set(false);
    }
  }

  private toDateTimeLocal(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoFromDateTimeLocal(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}