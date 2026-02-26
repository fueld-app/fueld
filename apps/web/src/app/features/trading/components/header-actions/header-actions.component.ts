import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  inject,
  ElementRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { OrderStatus } from '@fueld/types';

// ═══════════════════════════════════════════════════════════════════════
//  Header Actions — Workflow dropdown for order operations
//
//  Actions: Generate Invoice, Send Email, Mark Paid
// ═══════════════════════════════════════════════════════════════════════

export type HeaderAction = 'generate-invoice' | 'view-offer' | 'view-proforma' | 'send-email' | 'mark-paid';

interface ActionItem {
  key: HeaderAction;
  label: string;
  icon: string;
  color: string;
  disabled?: boolean;
}

const ACTIONS: ActionItem[] = [
  {
    key: 'view-offer',
    label: 'View Confirmation',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
    color: 'text-blue-600',
  },
  {
    key: 'view-proforma',
    label: 'View Nomination',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
    color: 'text-purple-600',
  },
  {
    key: 'generate-invoice',
    label: 'View Proforma Invoice',
    icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
    color: 'text-brand-600',
  },
  {
    key: 'send-email',
    label: 'Send Email',
    icon: 'M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75',
    color: 'text-indigo-600',
  },
  {
    key: 'mark-paid',
    label: 'Mark Paid',
    icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    color: 'text-green-600',
  },
];

@Component({
  selector: 'app-header-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-block' },
  template: `
    <!-- Trigger button -->
    <button
      (click)="toggleMenu()"
      class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm
             font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50
             focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
      [attr.aria-expanded]="isOpen()"
      aria-haspopup="true"
    >
      Actions
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
      </svg>
    </button>

    <!-- Dropdown -->
    @if (isOpen()) {
      <div
        class="absolute right-0 z-50 mt-2 w-52 origin-top-right rounded-lg border border-gray-200 bg-white py-1 shadow-lg ring-1 ring-black/5"
        role="menu"
      >
        @for (action of displayActions(); track action.key) {
          <button
            (click)="onAction(action.key)"
            class="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
            [disabled]="loading() || action.disabled"
          >
            <svg xmlns="http://www.w3.org/2000/svg" [class]="'h-5 w-5 ' + action.color" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="action.icon" />
            </svg>
            {{ action.label }}
          </button>
        }
      </div>
    }
  `,
})
export class HeaderActionsComponent implements OnInit, OnDestroy {
  readonly orderId = input.required<string>();
  readonly status = input<OrderStatus | null>(null);
  readonly actionTriggered = output<HeaderAction>();

  readonly isOpen = signal(false);
  readonly loading = signal(false);

  readonly actions = ACTIONS;
  readonly displayActions = signal<ActionItem[]>(ACTIONS);

  private readonly elRef = inject(ElementRef);
  private clickOutside = (e: MouseEvent) => {
    if (!this.elRef.nativeElement.contains(e.target)) this.isOpen.set(false);
  };

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutside);
    this.updateActions();
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutside);
  }

  toggleMenu(): void {
    this.isOpen.update((v) => !v);
    this.updateActions();
  }

  private updateActions(): void {
    const status = this.status();
    const showInvoiceAsFinal =
      status === OrderStatus.Delivered
      || status === OrderStatus.Invoiced
      || status === OrderStatus.Paid;
    const canMarkPaid = status !== OrderStatus.Paid;

    const nextActions = ACTIONS
      .filter((action) => action.key !== 'mark-paid' || canMarkPaid)
      .map((action) =>
        action.key === 'generate-invoice'
          ? { ...action, label: showInvoiceAsFinal ? 'View Invoice' : 'View Proforma Invoice' }
          : action.key === 'mark-paid'
            ? { ...action, disabled: !canMarkPaid }
          : action,
      );

    this.displayActions.set(nextActions);
  }
  onAction(key: HeaderAction): void {
    this.isOpen.set(false);
    this.actionTriggered.emit(key);
  }
}
