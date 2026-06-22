import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  ReportExceptionType,
  ReportScheduleBodyMode,
  ReportScheduleDeliveryMode,
  ReportScheduleMode,
  ReportScheduleType,
} from '@fueld/types';
import { Role } from '@fueld/types';

@Component({
  selector: 'app-reports-schedule-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[520px]">
      <div class="grid gap-3 sm:grid-cols-2">
        <input
          type="text"
          data-testid="reports-schedule-name"
          [value]="name()"
          (input)="nameChange.emit(($any($event.target).value || '').trimStart())"
          placeholder="Schedule name"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <input
          type="text"
          data-testid="reports-schedule-description"
          [value]="description()"
          (input)="descriptionChange.emit(($any($event.target).value || '').trimStart())"
          placeholder="Description (optional)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <select
          data-testid="reports-schedule-mode"
          [value]="mode()"
          (change)="modeChange.emit($any($event.target).value)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="SUMMARY">Summary</option>
          <option value="EXCEPTIONS">Exceptions</option>
        </select>
        <select
          data-testid="reports-schedule-report-type"
          [value]="reportType()"
          (change)="reportTypeChange.emit($any($event.target).value)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="SUMMARY">Summary</option>
          <option value="MARGIN_ANALYSIS">Margin analysis</option>
        </select>
        <select
          data-testid="reports-schedule-delivery-mode"
          [value]="deliveryMode()"
          (change)="deliveryModeChange.emit($any($event.target).value)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="HTML">HTML summary</option>
          <option value="CSV">CSV attachment</option>
          <option value="XLSX">XLSX attachment</option>
          <option value="CSV_XLSX">CSV + XLSX</option>
        </select>
        <select
          data-testid="reports-schedule-body-mode"
          [value]="bodyMode()"
          (change)="bodyModeChange.emit($any($event.target).value)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          <option value="HTML_SUMMARY">Include HTML summary</option>
          <option value="ATTACHMENT_ONLY">Attachment only email</option>
        </select>
        <select
          data-testid="reports-schedule-hour"
          [value]="hourUtc()"
          (change)="onHourChange($event)"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        >
          @for (hour of utcHours(); track hour) {
            <option [value]="hour">{{ hour }}:00 UTC</option>
          }
        </select>
        <input
          type="text"
          data-testid="reports-schedule-extra-emails"
          [value]="extraEmails()"
          (input)="extraEmailsChange.emit(($any($event.target).value || '').trimStart())"
          placeholder="Extra emails, comma-separated"
          class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm text-gray-900 dark:text-ink focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
      </div>

      @if (mode() === 'EXCEPTIONS') {
        <div class="flex flex-wrap gap-2">
          @for (type of exceptionTypeOptions; track type) {
            <button
              type="button"
              [attr.data-testid]="'reports-schedule-exception-type-' + type"
              (click)="toggleExceptionType(type)"
              class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
              [class]="isExceptionTypeSelected(type)
                ? 'border-red-600 bg-red-600 text-white'
                : 'border-gray-300 dark:border-line-strong bg-white dark:bg-surface text-gray-700 dark:text-ink-dim'"
            >
              {{ exceptionTypeLabel(type) }}
            </button>
          }
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim">
          <input
            data-testid="reports-schedule-send-only-non-empty"
            type="checkbox"
            [checked]="sendOnlyWhenNonEmpty()"
            (change)="sendOnlyWhenNonEmptyChange.emit($any($event.target).checked)"
            class="rounded border-gray-300 dark:border-line-strong"
          />
          Send only when exceptions exist
        </label>
      }

      @if (editing()) {
        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim">
          <input
            type="checkbox"
            [checked]="isActive()"
            (change)="isActiveChange.emit($any($event.target).checked)"
            class="rounded border-gray-300 dark:border-line-strong"
          />
          Active schedule
        </label>
      }

      <div class="flex flex-wrap gap-2">
        @for (role of roleOptions(); track role) {
          <button
            type="button"
            (click)="toggleRole(role)"
            class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
            [class]="isRoleSelected(role)
              ? 'border-gray-900 bg-gray-900 text-white dark:border-ink dark:bg-ink dark:text-bg'
              : 'border-gray-300 dark:border-line-strong bg-white dark:bg-surface text-gray-700 dark:text-ink-dim'"
          >
            {{ roleLabel(role) }}
          </button>
        }
      </div>

      <div class="flex gap-2">
        <button
          type="button"
          data-testid="reports-save-schedule"
          (click)="save.emit()"
          [disabled]="saving() || !name().trim() || recipientRoles().length === 0"
          class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {{ saving() ? 'Saving…' : editing() ? 'Update schedule' : 'Create schedule' }}
        </button>
        @if (editing()) {
          <button
            type="button"
            (click)="cancel.emit()"
            class="inline-flex items-center justify-center rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim transition-colors hover:bg-gray-50 dark:hover:bg-surface-tint"
          >
            Cancel
          </button>
        }
      </div>
    </div>
  `,
})
export class ReportsScheduleFormComponent {
  readonly editing = input(false);
  readonly saving = input(false);
  readonly name = input('');
  readonly description = input('');
  readonly mode = input<ReportScheduleMode>('SUMMARY');
  readonly reportType = input<ReportScheduleType>('SUMMARY');
  readonly deliveryMode = input<ReportScheduleDeliveryMode>('HTML');
  readonly bodyMode = input<ReportScheduleBodyMode>('HTML_SUMMARY');
  readonly hourUtc = input(8);
  readonly recipientRoles = input<Role[]>([]);
  readonly extraEmails = input('');
  readonly exceptionTypes = input<ReportExceptionType[]>([]);
  readonly sendOnlyWhenNonEmpty = input(true);
  readonly isActive = input(true);
  readonly utcHours = input<number[]>([]);
  readonly roleOptions = input<Role[]>([]);

  readonly nameChange = output<string>();
  readonly descriptionChange = output<string>();
  readonly modeChange = output<ReportScheduleMode>();
  readonly reportTypeChange = output<ReportScheduleType>();
  readonly deliveryModeChange = output<ReportScheduleDeliveryMode>();
  readonly bodyModeChange = output<ReportScheduleBodyMode>();
  readonly hourUtcChange = output<number>();
  readonly recipientRolesChange = output<Role[]>();
  readonly extraEmailsChange = output<string>();
  readonly exceptionTypesChange = output<ReportExceptionType[]>();
  readonly sendOnlyWhenNonEmptyChange = output<boolean>();
  readonly isActiveChange = output<boolean>();
  readonly save = output<void>();
  readonly cancel = output<void>();

  readonly exceptionTypeOptions: ReportExceptionType[] = [
    'NEGATIVE_NET_PROFIT_ORDER',
    'SEVERELY_OVERDUE_INVOICE',
    'LOW_MARGIN_CUSTOMER',
  ];

  onHourChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement | null)?.value ?? 8);
    this.hourUtcChange.emit(Number.isFinite(value) ? value : 8);
  }

  toggleRole(role: Role): void {
    const current = this.recipientRoles();
    const next = current.includes(role)
      ? current.filter((v) => v !== role)
      : [...current, role];
    this.recipientRolesChange.emit(next);
  }

  isRoleSelected(role: Role): boolean {
    return this.recipientRoles().includes(role);
  }

  toggleExceptionType(type: ReportExceptionType): void {
    const current = this.exceptionTypes();
    const next = current.includes(type)
      ? current.filter((v) => v !== type)
      : [...current, type];
    this.exceptionTypesChange.emit(next);
  }

  isExceptionTypeSelected(type: ReportExceptionType): boolean {
    return this.exceptionTypes().includes(type);
  }

  roleLabel(role: Role): string {
    switch (role) {
      case Role.Teamlead: return 'Team lead';
      case Role.CreditManager: return 'Credit';
      case Role.OperationsManager: return 'Operations';
      case Role.Light: return 'Light';
      default: return role.charAt(0) + role.slice(1).toLowerCase();
    }
  }

  exceptionTypeLabel(type: ReportExceptionType): string {
    switch (type) {
      case 'NEGATIVE_NET_PROFIT_ORDER': return 'Negative net profit orders';
      case 'SEVERELY_OVERDUE_INVOICE': return 'Severely overdue invoices';
      case 'LOW_MARGIN_CUSTOMER': return 'Low-margin customers';
    }
  }
}
