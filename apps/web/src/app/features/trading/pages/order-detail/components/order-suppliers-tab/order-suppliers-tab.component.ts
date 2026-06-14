import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import type { InquirySupplierComparisonRow, InquiryQuoteMatrixRow, SupplierInquiryReplyRow, InquiryReplyRecommendation } from '../../order-detail-page.component';

@Component({
  selector: 'app-order-suppliers-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mt-4">
      <!-- Supplier Comparison Context -->
      <div class="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50 shadow-sm">
        <div class="border-b border-slate-200/70 px-5 py-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Inquiry intelligence</div>
              <h3 class="mt-1 text-base font-semibold text-slate-900">Supplier Comparison Context</h3>
              <p class="text-sm text-slate-500">Delivery history and quote hit-rate for suppliers at this port.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 font-medium text-slate-600">{{ suppliers().length }} supplier{{ suppliers().length === 1 ? '' : 's' }} ranked</span>
              @if (selectedSupplierId()) {
                <span class="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">Reviewing {{ selectedSupplierName() }}</span>
              }
            </div>
          </div>
        </div>
        <div class="px-5 py-5">
          @if (loading()) {
            <p class="text-sm text-slate-400">Loading supplier comparison context...</p>
          } @else if (suppliers().length === 0) {
            <p class="text-sm text-slate-400">No supplier history available for this inquiry yet.</p>
          } @else {
            <div class="grid gap-3 lg:grid-cols-2">
              @for (supplier of suppliers(); track supplier.supplierId) {
                <div class="rounded-2xl border px-4 py-3 shadow-sm transition-all"
                  [class.border-emerald-300]="selectedSupplierId() === supplier.supplierId"
                  [class.bg-emerald-50/80]="selectedSupplierId() === supplier.supplierId"
                  [class.border-slate-200]="selectedSupplierId() !== supplier.supplierId"
                  [class.bg-white]="selectedSupplierId() !== supplier.supplierId"
                >
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-slate-900">{{ supplier.supplierName }}</span>
                    @if (isTopSupplier(supplier)) { <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Best here</span> }
                    @if (selectedSupplierId() === supplier.supplierId) { <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">Selected</span> }
                  </div>
                  @if (supplier.products.length) {
                    <div class="mt-1 flex flex-wrap gap-1">
                      @for (product of supplier.products; track product) { <span class="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{{ product }}</span> }
                    </div>
                  }
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    @if (supplier.performance.deliveredCountOverall > 0) { <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">{{ supplier.performance.deliveredCountOverall }} delivered</span> }
                    @if (supplier.performance.deliveredCountAtPlace > 0) { <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">{{ supplier.performance.deliveredCountAtPlace }} at this place</span> }
                    @if (supplier.performance.quotedCount > 0) { <span class="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 ring-1 ring-fuchsia-200">{{ quoteRateLabel(supplier.performance) }}</span> }
                    @if (supplier.performance.averageResponseHours !== null) { <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200">{{ averageResponseLabel(supplier.performance) }}</span> }
                  </div>
                  @if (!readonly()) {
                    <button (click)="select.emit(supplier)"
                      [disabled]="selectedSupplierId() === supplier.supplierId"
                      class="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                      [class.bg-brand-600]="selectedSupplierId() !== supplier.supplierId"
                      [class.text-white]="selectedSupplierId() !== supplier.supplierId"
                      [class.bg-slate-100]="selectedSupplierId() === supplier.supplierId"
                      [class.text-slate-500]="selectedSupplierId() === supplier.supplierId"
                    >{{ selectedSupplierId() === supplier.supplierId ? 'Selected' : 'Set as supplier' }}</button>
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>

      <!-- Quote Matrix -->
      @if (replies().length > 0) {
        <div class="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div class="border-b border-slate-200 px-5 py-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Line comparison</div>
                <h3 class="text-base font-semibold text-slate-900">Quote Matrix</h3>
                <p class="text-sm text-slate-500">Compare all supplier responses by line item.</p>
              </div>
              <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">{{ replies().length }} repl{{ replies().length === 1 ? 'y' : 'ies' }}</span>
                <span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-600">{{ matrixRows().length }} line{{ matrixRows().length === 1 ? '' : 's' }}</span>
              </div>
            </div>
          </div>
          <div class="overflow-x-auto px-5 py-4">
            <table class="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th class="sticky left-0 z-10 min-w-64 border-b border-slate-200 bg-white px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Line item</th>
                  @for (reply of replies(); track reply.id) {
                    <th class="min-w-52 border-b border-slate-200 px-4 py-3 text-left align-top" [class.bg-slate-50]="selectedReplySupplierId() === reply.supplierId">
                      <div class="flex items-center gap-2">
                        <span class="font-semibold text-slate-900">{{ reply.supplierName }}</span>
                        @if (selectedReplySupplierId() === reply.supplierId) { <span class="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold text-white">Selected</span> }
                      </div>
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        @if (recommendation(reply.id)?.bestOverall) { <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Best overall</span> }
                        @if (recommendation(reply.id)?.lowestComparable) { <span class="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-200">Lowest total</span> }
                        @if (recommendation(reply.id)?.mostComplete) { <span class="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">Most complete</span> }
                        @if (recommendation(reply.id)?.fastest) { <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">Fastest</span> }
                      </div>
                      <div class="mt-1 text-[11px] text-slate-500">{{ summary(reply) }}</div>
                      @if (reply.responseHours !== null) { <div class="mt-1 text-[11px] text-slate-400">{{ responseHoursLabel(reply.responseHours) }} response</div> }
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of matrixRows(); track row.orderItemId) {
                  <tr>
                    <td class="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 align-top">
                      <div class="font-semibold text-slate-900">{{ row.productType }}</div>
                      <div class="mt-1 text-xs text-slate-500">{{ row.quantity }}{{ row.unit }}@if (row.description) { · {{ row.description }} }</div>
                    </td>
                    @for (cell of row.cells; track cell.supplierInquiryId) {
                      <td class="border-b border-slate-100 px-4 py-3 align-top" [class.bg-slate-50]="cell.isSelectedSupplier">
                        @if (cell.price !== null && showPrices()) {
                          <div class="font-semibold text-slate-900">{{ cell.price }} {{ cell.currency }}</div>
                          @if (cell.note) { <div class="mt-1 text-xs text-slate-500">{{ cell.note }}</div> }
                        } @else if (cell.price !== null && !showPrices()) {
                          <div class="font-medium text-slate-400 italic">Hidden</div>
                        } @else {
                          <div class="font-medium text-slate-500">{{ cell.note || cell.status }}</div>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderSuppliersTabComponent {
  readonly suppliers = input<InquirySupplierComparisonRow[]>([]);
  readonly loading = input(false);
  readonly readonly = input(false);
  readonly selectedSupplierId = input<string | null>(null);
  readonly selectedSupplierName = input<string>('');
  readonly isTopSupplier = input<(s: InquirySupplierComparisonRow) => boolean>(() => false);
  readonly quoteRateLabel = input<(p: any) => string>(() => '');
  readonly averageResponseLabel = input<(p: any) => string>(() => '');

  readonly replies = input<SupplierInquiryReplyRow[]>([]);
  readonly matrixRows = input<InquiryQuoteMatrixRow[]>([]);
  readonly selectedReplySupplierId = input<string | null>(null);
  readonly showPrices = input(false);
  readonly recommendation = input<(replyId: string) => InquiryReplyRecommendation | undefined>(() => undefined);
  readonly summary = input<(reply: SupplierInquiryReplyRow) => string>(() => '');
  readonly responseHoursLabel = input<(hours: number) => string>(() => '');

  readonly select = output<InquirySupplierComparisonRow>();
}
