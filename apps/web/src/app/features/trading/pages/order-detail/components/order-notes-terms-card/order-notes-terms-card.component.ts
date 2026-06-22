import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-order-notes-terms-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <p class="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-muted mb-1.5">Place remark</p>
      @if (!readonly()) {
        <textarea
          rows="3"
          class="mt-1 block w-full rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 focus:bg-white dark:focus:bg-surface"
          placeholder="Remark to include on order documents"
          [ngModel]="placeRemark()"
          (ngModelChange)="placeRemarkChange.emit($event)"
        ></textarea>
      } @else if (placeRemark()) {
        <p
          class="mt-1 text-sm text-gray-700 dark:text-ink-dim whitespace-pre-line"
          [class.fueld-clamp-2]="!showPlaceRemarkFull()"
        >{{ placeRemark() }}</p>
        <button
          type="button"
          (click)="showPlaceRemarkFull.set(!showPlaceRemarkFull())"
          class="mt-1 text-xs text-gray-400 dark:text-muted hover:text-gray-600 transition-colors"
        >{{ showPlaceRemarkFull() ? 'Show less' : 'Show more' }}</button>
      } @else {
        <p class="mt-1 text-sm text-gray-700 dark:text-ink-dim">-</p>
      }

      <div class="mt-4"></div>
      <div class="flex items-center gap-2 mb-1.5">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-muted">Customer terms</p>
        @if (hasOrderTermsOverride()) {
          <span class="inline-flex rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">Order override</span>
        } @else if (clientSpecialTermsLabel()) {
          <span class="inline-flex rounded-full bg-blue-100 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">{{ clientSpecialTermsLabel() }}</span>
        }
      </div>
      @if (customerTermsText()) {
        <p
          class="mt-1 text-sm text-gray-700 dark:text-ink-dim whitespace-pre-line"
          [class.fueld-clamp-2]="!showCustomerTermsFull()"
        >{{ customerTermsText() }}</p>
        <button
          type="button"
          (click)="showCustomerTermsFull.set(!showCustomerTermsFull())"
          class="mt-1 text-xs text-gray-400 dark:text-muted hover:text-gray-600 transition-colors"
        >{{ showCustomerTermsFull() ? 'Show less' : 'Show more' }}</button>
      } @else {
        <p class="mt-1 text-sm text-gray-700 dark:text-ink-dim">-</p>
      }

      <div class="mt-4"></div>
      <p class="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-muted mb-1.5">Supplier terms</p>
      @if (supplierTermsText()) {
        <p
          class="mt-1 text-sm text-gray-700 dark:text-ink-dim whitespace-pre-line"
          [class.fueld-clamp-2]="!showSupplierTermsFull()"
        >{{ supplierTermsText() }}</p>
        <button
          type="button"
          (click)="showSupplierTermsFull.set(!showSupplierTermsFull())"
          class="mt-1 text-xs text-gray-400 dark:text-muted hover:text-gray-600 transition-colors"
        >{{ showSupplierTermsFull() ? 'Show less' : 'Show more' }}</button>
      } @else {
        <p class="mt-1 text-sm text-gray-700 dark:text-ink-dim">-</p>
      }

      <p class="mt-2 text-[11px] text-gray-400 dark:text-muted">Edit in Admin → Our Companies</p>
    </div>
  `,
})
export class OrderNotesTermsCardComponent {
  readonly readonly = input(false);
  readonly placeRemark = input<string | null>(null);
  readonly customerTermsText = input<string | null>(null);
  readonly supplierTermsText = input<string | null>(null);
  readonly hasOrderTermsOverride = input(false);
  readonly clientSpecialTermsLabel = input<string | null>(null);

  readonly placeRemarkChange = output<string>();

  protected readonly showPlaceRemarkFull = signal(false);
  protected readonly showCustomerTermsFull = signal(false);
  protected readonly showSupplierTermsFull = signal(false);
}
