import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import type { OrderStatus, InvoiceStatus } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  StatusBadge — Color-coded pill for order / invoice statuses
// ═══════════════════════════════════════════════════════════════════════

type BadgeStatus = OrderStatus | InvoiceStatus | 'OVERDUE' | string;

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  INQUIRY:        { bg: 'bg-yellow-50',  text: 'text-yellow-700',  dot: 'bg-yellow-500' },
  OFFER:          { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  CONFIRMED:      { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  DELIVERED:      { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  INVOICED:       { bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  PAID:           { bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500' },
  CANCELLED:      { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  DRAFT:          { bg: 'bg-gray-50',    text: 'text-gray-600',    dot: 'bg-gray-400' },
  SENT:           { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  OVERDUE:        { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-600' },
  PARTIALLY_PAID: { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  VOID:           { bg: 'bg-gray-100',   text: 'text-gray-500',    dot: 'bg-gray-400' },
};

const DEFAULT_STYLE = { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' };

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span
      [class]="badgeClasses()"
      class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
    >
      <span [class]="dotClass()" class="h-1.5 w-1.5 rounded-full"></span>
      {{ label() }}
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<BadgeStatus>();
  readonly label = computed(() => {
    const s = this.status();
    return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  });

  protected readonly style = computed(() => STATUS_STYLES[this.status()] ?? DEFAULT_STYLE);
  protected readonly badgeClasses = computed(() => `${this.style().bg} ${this.style().text}`);
  protected readonly dotClass = computed(() => this.style().dot);
}
