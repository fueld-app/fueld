import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import type { OrderStatus, InvoiceStatus } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  StatusBadge — Theme-aware pill for order / invoice statuses.
//  Renders the shared .status-pill class (styles.css) with a theme-aware
//  color via [attr.data-status]; the leading dot inherits the pill color.
// ═══════════════════════════════════════════════════════════════════════

type BadgeStatus = OrderStatus | InvoiceStatus | 'OVERDUE' | string;

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex' },
  template: `
    <span class="status-pill" [attr.data-status]="dataStatus()">
      <span class="status-dot"></span>
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
  protected readonly dataStatus = computed(() => this.status().toLowerCase());
}