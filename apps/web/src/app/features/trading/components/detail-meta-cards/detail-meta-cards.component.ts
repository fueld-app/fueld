import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  output,
  signal,
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
    <div class="mb-4 grid gap-4 grid-cols-1 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-4">
      <!-- Client + Customer Contact + Broker + Agent + Customer Payment -->
      <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-1">
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="activeClientPartyTab() === 'client' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
              (click)="clientPartyTab.set('client')"
            >
              Client
            </button>
            @if (showBrokerTab()) {
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                [class]="activeClientPartyTab() === 'broker' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
                (click)="clientPartyTab.set('broker')"
              >
                Broker
              </button>
            }
            @if (showAgentTab()) {
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
                [class]="activeClientPartyTab() === 'agent' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'"
                (click)="clientPartyTab.set('agent')"
              >
                Agent
              </button>
            }
          </div>
          @if (!isReadonly()) {
            <div class="flex items-center gap-1">
              @if (!showBrokerTab()) {
                <button
                  type="button"
                  (click)="openBrokerTab()"
                  class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
                >
                  + Add broker
                </button>
              }
              @if (!showAgentTab()) {
                <button
                  type="button"
                  (click)="openAgentTab()"
                  class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 transition-colors hover:bg-brand-100"
                >
                  + Add agent
                </button>
              }
            </div>
          }
        </div>
        <div class="px-5 py-4">
          @if (activeClientPartyTab() === 'client') {
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
            @if (!brokerId()) {
              <div class="mt-3 border-t border-gray-100 pt-3">
                <label class="text-xs font-medium text-gray-400">Contact Person</label>
                @if (isReadonly()) {
                  <p class="mt-1 text-sm text-gray-900">{{ customerContactName() || '—' }}</p>
                } @else {
                  <select
                    [ngModel]="customerContactId()"
                    (ngModelChange)="customerContactChange.emit($event)"
                    class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    <option value="">— None —</option>
                    @for (c of customerContactOptions(); track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                  </select>
                }
              </div>
            }
          }
          @if (activeClientPartyTab() === 'broker' && showBrokerTab()) {
            <button
              type="button"
              (click)="navigateToBroker()"
              [disabled]="!brokerId()"
              class="text-xs font-medium uppercase tracking-wider mb-1.5"
              [class.text-gray-500]="!brokerId()"
              [class.text-brand-600]="!!brokerId()"
              [class.hover:underline]="!!brokerId()"
              [class.cursor-pointer]="!!brokerId()"
              [class.cursor-not-allowed]="!brokerId()"
              [class.opacity-50]="!brokerId()"
            >
              Broker
            </button>
            @if (isReadonly()) {
              <p class="mt-1 text-sm font-semibold text-gray-900">{{ brokerName() }}</p>
            } @else {
              <app-searchable-dropdown
                [options]="brokerOptions()"
                [selected]="brokerId()"
                [asyncSearch]="true"
                [loading]="brokerLoading()"
                [clearable]="true"
                placeholder="Search brokers..."
                (searchChange)="brokerSearch.emit($event)"
                (selectionChange)="handleBrokerSelection($event)"
              />
            }
            @if (brokerId()) {
              <div class="mt-3 border-t border-gray-100 pt-3">
                <label class="text-xs font-medium text-gray-400">Broker Contact</label>
                @if (isReadonly()) {
                  <p class="mt-1 text-sm text-gray-900">{{ brokerContactName() || '—' }}</p>
                } @else {
                  <select
                    [ngModel]="brokerContactId()"
                    (ngModelChange)="brokerContactChange.emit($event)"
                    class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    <option value="">— None —</option>
                    @for (c of brokerContactOptions(); track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                  </select>
                }
              </div>
              <div class="mt-2">
                <label class="flex items-center gap-2 cursor-pointer">
                  <button
                    type="button"
                    (click)="brokerGetsAllChange.emit(!brokerGetsAll())"
                    [disabled]="isReadonly()"
                    class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                    [class]="brokerGetsAll() ? 'bg-brand-600' : 'bg-gray-300'"
                  >
                    <span
                      class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                      [class.translate-x-4]="brokerGetsAll()"
                      [class.translate-x-0]="!brokerGetsAll()"
                    ></span>
                  </button>
                  <span class="text-xs text-gray-600">Broker gets all comms</span>
                </label>
              </div>
            }
          }
          @if (activeClientPartyTab() === 'agent' && showAgentTab()) {
            <button
              type="button"
              (click)="navigateToAgent()"
              [disabled]="!agentId()"
              class="text-xs font-medium uppercase tracking-wider mb-1.5"
              [class.text-gray-500]="!agentId()"
              [class.text-brand-600]="!!agentId()"
              [class.hover:underline]="!!agentId()"
              [class.cursor-pointer]="!!agentId()"
              [class.cursor-not-allowed]="!agentId()"
              [class.opacity-50]="!agentId()"
            >
              Agent
            </button>
            @if (isReadonly()) {
              <p class="mt-1 text-sm font-semibold text-gray-900">{{ agentName() }}</p>
            } @else {
              <app-searchable-dropdown
                [options]="agentOptions()"
                [selected]="agentId()"
                [asyncSearch]="true"
                [loading]="agentLoading()"
                [clearable]="true"
                placeholder="Search companies..."
                (searchChange)="agentSearch.emit($event)"
                (selectionChange)="handleAgentSelection($event)"
              />
            }
            @if (agentId()) {
              <div class="mt-3 border-t border-gray-100 pt-3">
                <label class="text-xs font-medium text-gray-400">Agent Contact</label>
                @if (isReadonly()) {
                  <p class="mt-1 text-sm text-gray-900">{{ agentContactName() || '—' }}</p>
                } @else {
                  <select
                    [ngModel]="agentContactId()"
                    (ngModelChange)="agentContactChange.emit($event)"
                    class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
                  >
                    <option value="">— None —</option>
                    @for (c of agentContactOptions(); track c.value) {
                      <option [value]="c.value">{{ c.label }}</option>
                    }
                  </select>
                }
              </div>
            }
          }
          <div class="mt-3 border-t border-gray-100 pt-3">
            <ng-content select="[customerPayment]"></ng-content>
          </div>
        </div>
      </div>
      <!-- Supplier + Supplier Contact + Supplier Payment -->
      <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
          @if (!supplierId()) {
            <button
              type="button"
              (click)="navigateToSupplier()"
              [disabled]="!supplierId()"
              class="text-xs font-medium uppercase tracking-wider shrink-0"
              [class.text-gray-500]="!supplierId()"
              [class.text-brand-600]="!!supplierId()"
              [class.hover:underline]="!!supplierId()"
              [class.cursor-pointer]="!!supplierId()"
              [class.cursor-not-allowed]="!supplierId()"
              [class.opacity-50]="!supplierId()"
            >
              Supplier
            </button>
          }
          <div class="min-w-0 flex-1">
            <ng-content select="[supplierHeaderTabs]"></ng-content>
          </div>
        </div>
        <div class="px-5 py-4">
          @if (isReadonly()) {
            <p class="mt-1 text-sm font-semibold text-gray-900">{{ supplierName() }}</p>
          } @else {
            <app-searchable-dropdown
              [options]="supplierOptions()"
              [selected]="supplierId()"
              [asyncSearch]="true"
              [loading]="supplierLoading()"
              [clearable]="true"
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
                class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
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
              {{ formatDateLabel(eta()) }}
            </p>
          } @else {
            <input
              type="date"
              [ngModel]="formatDateForInput(eta())"
              (ngModelChange)="etaChange.emit($event)"
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
                {{ formatDateLabel(etd()) }}
              </p>
            } @else {
              <input
                type="date"
                [ngModel]="formatDateForInput(etd())"
                (ngModelChange)="etdChange.emit($event)"
                [min]="etaMinDateTime()"
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
            data-testid="order-invoicing-company"
            [ngModel]="invoicingCompanyId()"
            (ngModelChange)="invoicingCompanyChange.emit($event)"
            [disabled]="ownCompanies().length === 0"
            class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-semibold text-gray-900
                   focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white
                   disabled:opacity-50 disabled:cursor-not-allowed"
          >
            @if (ownCompanies().length === 0) {
              <option value="">- Select -</option>
            }
            @for (co of ownCompanies(); track co.id) {
              <option [value]="co.id">{{ co.name }}</option>
            }
          </select>
        }
        <!-- Bank Account -->
        <div class="mt-3 border-t border-gray-100 pt-3">
          <label class="text-xs font-medium text-gray-400">Bank Account</label>
          @if (isReadonly() && !allowBankAccountEdit()) {
            <p class="mt-1 text-sm text-gray-900">{{ bankAccountLabel() }}</p>
          } @else {
            <select
              data-testid="order-bank-account"
              [ngModel]="bankAccountId()"
              (ngModelChange)="bankAccountChange.emit($event)"
              [disabled]="!invoicingCompanyId() || bankAccountOptions().length === 0"
              class="fueld-select-no-chevron mt-1 w-full appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                     focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (bankAccountOptions().length === 0) {
                <option value="">— None —</option>
              }
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
  readonly brokerExpanded = signal(false);
  readonly agentExpanded = signal(false);
  readonly clientPartyTab = signal<'client' | 'broker' | 'agent'>('client');
  readonly showBrokerTab = computed(() => this.brokerExpanded() || !!this.brokerId());
  readonly showAgentTab = computed(() => this.agentExpanded() || !!this.agentId());
  readonly activeClientPartyTab = computed<'client' | 'broker' | 'agent'>(() => {
    const current = this.clientPartyTab();
    if (current === 'broker' && !this.showBrokerTab()) {
      return this.showAgentTab() ? 'agent' : 'client';
    }
    if (current === 'agent' && !this.showAgentTab()) {
      return this.showBrokerTab() ? 'broker' : 'client';
    }
    return current;
  });

  readonly clientName = input<string>('');
  readonly supplierName = input<string>('—');
  readonly vesselName = input<string>('');
  readonly placeName = input<string>('');

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
  readonly etaMinDateTime = input<string>('');
  readonly timezone = input<string>('UTC');
  readonly showEtd = input<boolean>(true);

  readonly timezoneAbbr = computed(() => {
    const tz = this.timezone();
    if (!tz || tz === 'UTC') return '';
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      }).formatToParts(new Date());
      return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  });

  readonly invoicingCompanyId = input<string>('');
  readonly invoicingCompanyName = input<string>('-');
  readonly ownCompanies = input<OwnCompanyDto[]>([]);
  readonly allowBankAccountEdit = input<boolean>(false);
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

  // Broker
  readonly brokerId = input<string>('');
  readonly brokerName = input<string>('—');
  readonly brokerOptions = input<DropdownOption[]>([]);
  readonly brokerLoading = input<boolean>(false);
  readonly brokerContactId = input<string>('');
  readonly brokerContactName = input<string>('');
  readonly brokerContactOptions = input<{ value: string; label: string }[]>([]);
  readonly brokerGetsAll = input<boolean>(false);

  readonly agentId = input<string>('');
  readonly agentName = input<string>('—');
  readonly agentOptions = input<DropdownOption[]>([]);
  readonly agentLoading = input<boolean>(false);
  readonly agentContactId = input<string>('');
  readonly agentContactName = input<string>('');
  readonly agentContactOptions = input<{ value: string; label: string }[]>([]);

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
  readonly brokerSearch = output<string>();
  readonly brokerChange = output<string>();
  readonly brokerContactChange = output<string>();
  readonly brokerGetsAllChange = output<boolean>();
  readonly agentSearch = output<string>();
  readonly agentChange = output<string>();
  readonly agentContactChange = output<string>();

  openBrokerTab(): void {
    this.brokerExpanded.set(true);
    this.clientPartyTab.set('broker');
  }

  openAgentTab(): void {
    this.agentExpanded.set(true);
    this.clientPartyTab.set('agent');
  }

  handleBrokerSelection(brokerId: string): void {
    if (!brokerId) {
      this.brokerExpanded.set(false);
      if (this.activeClientPartyTab() === 'broker') {
        this.clientPartyTab.set(this.showAgentTab() ? 'agent' : 'client');
      }
    } else {
      this.brokerExpanded.set(true);
    }
    this.brokerChange.emit(brokerId);
  }

  handleAgentSelection(agentId: string): void {
    if (!agentId) {
      this.agentExpanded.set(false);
      if (this.activeClientPartyTab() === 'agent') {
        this.clientPartyTab.set(this.showBrokerTab() ? 'broker' : 'client');
      }
    } else {
      this.agentExpanded.set(true);
    }
    this.agentChange.emit(agentId);
  }

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

  navigateToBroker(): void {
    const id = this.brokerId();
    if (!id) return;
    void this.router.navigate(['/companies', id]);
  }

  navigateToAgent(): void {
    const id = this.agentId();
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

  formatDateForInput(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    return this.formatUtcDateOnly(date);
  }

  formatDateLabel(dateStr: string | null | undefined): string {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private formatUtcDateOnly(date: Date): string {
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
