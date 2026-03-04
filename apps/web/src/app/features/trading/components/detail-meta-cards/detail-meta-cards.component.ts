import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { OwnCompanyDto, BankAccountDto } from '@fueld/types';
import {
  SearchableDropdownComponent,
  type DropdownOption,
} from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';

@Component({
  selector: 'app-trading-detail-meta-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchableDropdownComponent, FormsModule],
  template: `
    <div class="mb-8 grid gap-4 grid-cols-1 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-4">
      <!-- Client + Customer Contact + Customer Payment -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          (click)="navigateToClient()"
          [disabled]="!clientId()"
          class="text-xs font-medium uppercase tracking-wider mb-1.5"
          [class.text-gray-500]="!clientId()"
          [class.text-brand-600]="!!clientId()"
          [class.hover:underline]="!!clientId()"
          [class.cursor-pointer]="!!clientId()"
          [class.cursor-not-allowed]="!clientId()"
          [class.opacity-50]="!clientId()"
        >
          Client
        </button>
        @if (canEditClient()) {
          <app-searchable-dropdown
            [options]="clientOptions()"
            [selected]="clientId()"
            [asyncSearch]="true"
            [loading]="clientLoading()"
            placeholder="Search clients..."
            (searchChange)="clientSearch.emit($event)"
            (selectionChange)="clientChange.emit($event)"
          />
        } @else {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ clientName() }}</p>
        }
        <div class="mt-3 border-t border-gray-100 pt-3">
          <label class="text-xs font-medium text-gray-400">Contact Person</label>
          @if (isReadonly()) {
            <p class="mt-1 text-sm text-gray-900">{{ customerContactName() || '—' }}</p>
          } @else {
            <select
              [ngModel]="customerContactId()"
              (ngModelChange)="customerContactChange.emit($event)"
              class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
            >
              <option value="">— None —</option>
              @for (c of customerContactOptions(); track c.value) {
                <option [value]="c.value">{{ c.label }}</option>
              }
            </select>
          }
        </div>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <ng-content select="[customerPayment]"></ng-content>
        </div>
      </div>
      <!-- Supplier + Supplier Contact + Supplier Payment -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          (click)="navigateToSupplier()"
          [disabled]="!supplierId()"
          class="text-xs font-medium uppercase tracking-wider mb-1.5"
          [class.text-gray-500]="!supplierId()"
          [class.text-brand-600]="!!supplierId()"
          [class.hover:underline]="!!supplierId()"
          [class.cursor-pointer]="!!supplierId()"
          [class.cursor-not-allowed]="!supplierId()"
          [class.opacity-50]="!supplierId()"
        >
          Supplier
        </button>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ supplierName() }}</p>
        } @else {
          <app-searchable-dropdown
            [options]="supplierOptions()"
            [selected]="supplierId()"
            [asyncSearch]="true"
            [loading]="supplierLoading()"
            placeholder="Search suppliers..."
            (searchChange)="supplierSearch.emit($event)"
            (selectionChange)="supplierChange.emit($event)"
          />
        }
        <div class="mt-3 border-t border-gray-100 pt-3">
          <label class="text-xs font-medium text-gray-400">Contact Person</label>
          @if (isReadonly()) {
            <p class="mt-1 text-sm text-gray-900">{{ supplierContactName() || '—' }}</p>
          } @else {
            <select
              [ngModel]="supplierContactId()"
              (ngModelChange)="supplierContactChange.emit($event)"
              [disabled]="!supplierId()"
              class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">— None —</option>
              @for (c of supplierContactOptions(); track c.value) {
                <option [value]="c.value">{{ c.label }}</option>
              }
            </select>
          }
        </div>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <ng-content select="[supplierPayment]"></ng-content>
        </div>
      </div>
      <!-- Voyage: Vessel + Place + ETA/ETD -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          (click)="navigateToVessel()"
          [disabled]="!vesselId()"
          class="text-xs font-medium uppercase tracking-wider mb-1.5"
          [class.text-gray-500]="!vesselId()"
          [class.text-brand-600]="!!vesselId()"
          [class.hover:underline]="!!vesselId()"
          [class.cursor-pointer]="!!vesselId()"
          [class.cursor-not-allowed]="!vesselId()"
          [class.opacity-50]="!vesselId()"
        >
          Vessel
        </button>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ vesselName() }}</p>
        } @else {
          <app-searchable-dropdown
            [options]="vesselOptions()"
            [selected]="vesselId()"
            [asyncSearch]="true"
            [loading]="vesselLoading()"
            placeholder="Search vessels..."
            (searchChange)="vesselSearch.emit($event)"
            (selectionChange)="vesselChange.emit($event)"
          />
        }
        <div class="mt-3 border-t border-gray-100 pt-3">
          <button
            type="button"
            (click)="navigateToPlace()"
            [disabled]="!placeId()"
            class="text-xs font-medium uppercase tracking-wider mb-1.5"
            [class.text-gray-500]="!placeId()"
            [class.text-brand-600]="!!placeId()"
            [class.hover:underline]="!!placeId()"
            [class.cursor-pointer]="!!placeId()"
            [class.cursor-not-allowed]="!placeId()"
            [class.opacity-50]="!placeId()"
          >
            Place
          </button>
          @if (isReadonly()) {
            <p class="mt-1 text-sm font-semibold text-gray-900">{{ placeName() }}</p>
          } @else {
            <app-searchable-dropdown
              [options]="placeOptions()"
              [selected]="placeId()"
              [asyncSearch]="true"
              [loading]="placeLoading()"
              placeholder="Search places..."
              (searchChange)="placeSearch.emit($event)"
              (selectionChange)="placeChange.emit($event)"
            />
          }
        </div>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">ETA</p>
          @if (isReadonly()) {
            <p class="mt-1 text-sm font-semibold text-gray-900">
              {{ formatDateTimeLabel(eta()) }}
            </p>
          } @else {
            <input
              type="datetime-local"
              step="60"
              [ngModel]="formatDateTimeForInput(eta())"
              (ngModelChange)="etaChange.emit($event)"
              [min]="minDateTime()"
              class="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
            />
          }
        </div>
        @if (showEtd()) {
          <div class="mt-3 border-t border-gray-100 pt-3">
            <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1.5">ETD</p>
            @if (isReadonly()) {
              <p class="mt-1 text-sm font-semibold text-gray-900">
                {{ formatDateTimeLabel(etd()) }}
              </p>
            } @else {
              <input
                type="datetime-local"
                step="60"
                [ngModel]="formatDateTimeForInput(etd())"
                (ngModelChange)="etdChange.emit($event)"
                [min]="etaMinDateTime() || minDateTime()"
                class="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm text-gray-900
                       focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
              />
            }
          </div>
        }
      </div>
      <!-- Invoicing + Notes + T&C -->
      <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-xs font-medium uppercase tracking-wider text-gray-500">Invoicing Company</p>
        @if (isReadonly()) {
          <p class="mt-1 text-sm font-semibold text-gray-900">{{ invoicingCompanyName() }}</p>
        } @else {
          <select
            [ngModel]="invoicingCompanyId()"
            (ngModelChange)="invoicingCompanyChange.emit($event)"
            class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-semibold text-gray-900
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
          >
            <option value="">- Select -</option>
            @for (co of ownCompanies(); track co.id) {
              <option [value]="co.id">{{ co.name }}</option>
            }
          </select>
        }
        <!-- Bank Account -->
        <div class="mt-3 border-t border-gray-100 pt-3">
          <label class="text-xs font-medium text-gray-400">Bank Account</label>
          @if (isReadonly()) {
            <p class="mt-1 text-sm text-gray-900">{{ bankAccountLabel() }}</p>
          } @else {
            <select
              [ngModel]="bankAccountId()"
              (ngModelChange)="bankAccountChange.emit($event)"
              [disabled]="!invoicingCompanyId() || bankAccountOptions().length === 0"
              class="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">— None —</option>
              @for (ba of bankAccountOptions(); track ba.id) {
                <option [value]="ba.id">{{ ba.label }} ({{ ba.currency }})</option>
              }
            </select>
          }
        </div>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <ng-content select="[notesAndTerms]"></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class TradingDetailMetaCardsComponent {
  private readonly router = inject(Router);

  readonly clientName = input.required<string>();
  readonly supplierName = input<string>('—');
  readonly vesselName = input.required<string>();
  readonly placeName = input.required<string>();

  readonly clientId = input<string>('');
  readonly supplierId = input<string>('');
  readonly vesselId = input<string>('');
  readonly placeId = input<string>('');

  readonly clientOptions = input<DropdownOption[]>([]);
  readonly supplierOptions = input<DropdownOption[]>([]);
  readonly vesselOptions = input<DropdownOption[]>([]);
  readonly placeOptions = input<DropdownOption[]>([]);

  readonly clientLoading = input<boolean>(false);
  readonly supplierLoading = input<boolean>(false);
  readonly vesselLoading = input<boolean>(false);
  readonly placeLoading = input<boolean>(false);

  readonly canEditClient = input<boolean>(false);
  readonly isReadonly = input<boolean>(false);

  readonly eta = input<string | null>(null);
  readonly etd = input<string | null>(null);
  readonly minDateTime = input<string>('');
  readonly etaMinDateTime = input<string>('');
  readonly timezone = input<string>('UTC');
  readonly showEtd = input<boolean>(true);

  readonly invoicingCompanyId = input<string>('');
  readonly invoicingCompanyName = input<string>('-');
  readonly ownCompanies = input<OwnCompanyDto[]>([]);
  readonly bankAccountId = input<string>('');
  readonly bankAccountOptions = input<BankAccountDto[]>([]);
  readonly responsibleUserId = input<string>('');
  readonly responsibleOptions = input<DropdownOption[]>([]);

  readonly customerContactId = input<string>('');
  readonly supplierContactId = input<string>('');
  readonly customerContactName = input<string>('');
  readonly supplierContactName = input<string>('');
  readonly customerContactOptions = input<{ value: string; label: string }[]>([]);
  readonly supplierContactOptions = input<{ value: string; label: string }[]>([]);

  readonly clientSearch = output<string>();
  readonly supplierSearch = output<string>();
  readonly vesselSearch = output<string>();
  readonly placeSearch = output<string>();

  readonly clientChange = output<string>();
  readonly supplierChange = output<string>();
  readonly vesselChange = output<string>();
  readonly placeChange = output<string>();
  readonly etaChange = output<string>();
  readonly etdChange = output<string>();
  readonly invoicingCompanyChange = output<string>();
  readonly bankAccountChange = output<string>();
  readonly responsibleChange = output<string>();
  readonly customerContactChange = output<string>();
  readonly supplierContactChange = output<string>();

  navigateToClient(): void {
    const id = this.clientId();
    if (!id) return;
    void this.router.navigate(['/companies', id]);
  }

  navigateToSupplier(): void {
    const id = this.supplierId();
    if (!id) return;
    void this.router.navigate(['/companies', id]);
  }

  navigateToVessel(): void {
    const id = this.vesselId();
    if (!id) return;
    void this.router.navigate(['/vessels', id]);
  }

  navigateToPlace(): void {
    const id = this.placeId();
    if (!id) return;
    void this.router.navigate(['/places', id]);
  }

  formatDateTimeForInput(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return this.formatDateTimeParts(date);
  }

  formatDateTimeLabel(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const tz = this.timezone();

    // IANA timezone path (preferred)
    const safeTimezone = this.normalizeTimeZone(tz);
    if (safeTimezone !== 'UTC' || tz === 'UTC') {
      // Check it's a valid IANA timezone (not a legacy "GMT +04H" that fell through to UTC)
      try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        const formatted = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date);

        // Get timezone abbreviation
        const abbrParts = new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'short',
        }).formatToParts(date);
        const abbr = abbrParts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        return abbr ? `${formatted} ${abbr}` : formatted;
      } catch { /* fall through to legacy path */ }
    }

    // Legacy fixed-offset path
    const fixedOffset = this.parseFixedOffsetMinutes(tz);
    if (fixedOffset !== null) {
      const shifted = new Date(date.getTime() + fixedOffset * 60_000);
      const day = String(shifted.getUTCDate()).padStart(2, '0');
      const month = shifted.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
      const year = shifted.getUTCFullYear();
      const hour = String(shifted.getUTCHours()).padStart(2, '0');
      const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
      return `${day} ${month} ${year}, ${hour}:${minute} ${tz}`;
    }

    // Fallback: UTC
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private formatDateTimeParts(date: Date): string {
    const fixedOffset = this.parseFixedOffsetMinutes(this.timezone());
    if (fixedOffset !== null) {
      const shifted = new Date(date.getTime() + fixedOffset * 60_000);
      const year = String(shifted.getUTCFullYear()).padStart(4, '0');
      const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
      const day = String(shifted.getUTCDate()).padStart(2, '0');
      const hour = String(shifted.getUTCHours()).padStart(2, '0');
      const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hour}:${minute}`;
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.normalizeTimeZone(this.timezone()),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const year = map.get('year') ?? '0000';
    const month = map.get('month') ?? '01';
    const day = map.get('day') ?? '01';
    const hour = map.get('hour') ?? '00';
    const minute = map.get('minute') ?? '00';
    return `${year}-${month}-${day}T${hour}:${minute}`;
  }

  private normalizeTimeZone(timeZone: string): string {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
      return timeZone;
    } catch {
      return 'UTC';
    }
  }

  private parseFixedOffsetMinutes(timeZone: string): number | null {
    const match = timeZone.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
    if (!match) return null;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? '0');
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

    return sign * (hours * 60 + minutes);
  }

  responsibleLabel(): string {
    const id = this.responsibleUserId();
    if (!id) return '-';
    const match = this.responsibleOptions().find((u) => u.value === id);
    return match?.label ?? '-';
  }

  bankAccountLabel(): string {
    const id = this.bankAccountId();
    if (!id) return '—';
    const match = this.bankAccountOptions().find((ba) => ba.id === id);
    return match ? `${match.label} (${match.currency})` : '—';
  }
}
