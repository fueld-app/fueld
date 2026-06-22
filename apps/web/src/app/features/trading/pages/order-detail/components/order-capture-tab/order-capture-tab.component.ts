import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import type { SupplierInquiryReplyRow } from '../../order-detail.types';

@Component({
  selector: 'app-order-capture-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4">
      <div class="rounded-3xl border border-slate-200 dark:border-slate-500/30 bg-white dark:bg-surface shadow-sm">
        <div class="border-b border-slate-200 dark:border-slate-500/30 px-5 py-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Manual capture</div>
              <h3 class="text-base font-semibold text-slate-900 dark:text-slate-300">Supplier Replies</h3>
              <p class="text-sm text-slate-500 dark:text-slate-300">Record manual supplier replies so future ranking reflects actual responsiveness.</p>
            </div>
            <span class="rounded-full border border-slate-200 dark:border-slate-500/30 bg-slate-50 dark:bg-slate-500/15 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              {{ replies().length }} supplier{{ replies().length === 1 ? '' : 's' }} contacted
            </span>
          </div>
        </div>
        <div class="px-5 py-5">
          @if (loading()) {
            <p class="text-sm text-slate-400">Loading supplier replies...</p>
          } @else if (replies().length === 0) {
            <p class="text-sm text-slate-400">No supplier inquiries have been sent yet.</p>
          } @else {
            <div class="space-y-3">
              @for (reply of replies(); track reply.id) {
                <div class="rounded-2xl border border-slate-200 dark:border-slate-500/30 bg-gradient-to-b from-white to-slate-50/50 p-4 shadow-sm">
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-sm font-semibold text-slate-900 dark:text-slate-300">{{ reply.supplierName }}</span>
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" [class]="badgeClass()(reply.status)">{{ reply.status }}</span>
                        @if (selectedSupplierId() === reply.supplierId) {
                          <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">Selected supplier</span>
                        }
                      </div>
                      @if (reply.email || reply.contactName) {
                        <div class="mt-1 text-xs text-slate-500 dark:text-slate-300">
                          {{ reply.email }}
                          @if (reply.contactName) { <span> • {{ reply.contactName }}</span> }
                        </div>
                      }
                      @if (reply.sentAt) {
                        <div class="mt-1 text-[11px] text-slate-400">Sent {{ formatDateTime()(reply.sentAt) }}</div>
                      }
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      @if (reply.responseHours !== null) {
                        <span class="rounded-full bg-amber-50 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/30">{{ responseHoursLabel()(reply.responseHours) }} response</span>
                      }
                      @if (reply.canDeliver === true) {
                        <span class="rounded-full bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-200 dark:ring-emerald-500/30">Can deliver</span>
                      }
                      @if (!readonly()) {
                        <button (click)="toggleEdit(reply)"
                          class="rounded-lg border border-slate-200 dark:border-slate-500/30 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:border-slate-300 hover:text-slate-900">
                          {{ isEditing(reply) ? 'Close editor' : 'Record reply' }}
                        </button>
                      }
                    </div>
                  </div>
                  <div class="mt-3 rounded-xl border border-slate-200/80 bg-slate-50 dark:bg-slate-500/15 px-3 py-2 text-sm text-slate-600 dark:text-slate-400">
                    {{ summary()(reply) }}
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class OrderCaptureTabComponent {
  readonly replies = input<SupplierInquiryReplyRow[]>([]);
  readonly loading = input(false);
  readonly readonly = input(false);
  readonly selectedSupplierId = input<string | null>(null);
  readonly editingReplyId = input<string | null>(null);

  readonly badgeClass = input<(status: string) => string>(() => '');
  readonly formatDateTime = input<(date: string) => string>(() => '');
  readonly responseHoursLabel = input<(hours: number) => string>(() => '');
  readonly summary = input<(reply: SupplierInquiryReplyRow) => string>(() => '');

  readonly toggleEditor = output<SupplierInquiryReplyRow>();

  protected isEditing(reply: SupplierInquiryReplyRow): boolean {
    return this.editingReplyId() === reply.id;
  }

  protected toggleEdit(reply: SupplierInquiryReplyRow): void {
    this.toggleEditor.emit(reply);
  }
}
