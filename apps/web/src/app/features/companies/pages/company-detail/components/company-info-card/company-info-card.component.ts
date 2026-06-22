import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  CounterpartyDto,
  CompanyEmailDto,
  CompanyEmailType,
  OwnCompanyDto,
} from '@fueld/types';
import { COUNTRIES, type Country, countryLabel, countryFlagByIso3 } from '../../../../../../shared/data/countries';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

interface CompanyOfficeDto {
  id: string;
  counterpartyId: string;
  city: string;
  country: string | null;
  countryCode: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  seasearcherOfficeId: number | null;
}

interface CompanyEnrichment {
  headOffice: {
    faxNumbers?: Array<{
      countryDialingCode: string;
      areaDialingCode: string;
      number: string;
    }>;
    personnel?: Array<{
      name: string;
      jobTitle: string;
    }>;
  } | null;
}

@Component({
  selector: 'app-company-info-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, FormsModule],
  styles: [`
    :host { display: block; }
  `],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm flex flex-col overflow-hidden">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Info</h2>
        <div class="flex items-center gap-2">
          @if (!editing()) {
            @if (companyInfoTab() === 'info' || companyInfoTab() === 'headOffice' || companyInfoTab() === 'terms') {
              <button
                (click)="startEditing()"
                class="inline-flex items-center gap-1 rounded-md bg-gray-50 dark:bg-bg-2 px-2 py-1 text-[11px] font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                </svg>
                Edit
              </button>
            }
            @if (companyInfoTab() === 'emails') {
              <button (click)="openAddEmail()"
                class="rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors">
                + Add
              </button>
            }
          }
          @if (editing()) {
            <button
              (click)="cancelEditing()"
              class="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-muted hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
            >Cancel</button>
            <button
              (click)="onSaveEditing()"
              [disabled]="editSaving()"
              class="rounded-md bg-brand-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              @if (editSaving()) { Saving… } @else { Save }
            </button>
          }
          <div class="flex gap-1">
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="companyInfoTab() === 'info' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'"
              (click)="companyInfoTab.set('info')"
            >
              Info
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="companyInfoTab() === 'headOffice' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'"
              (click)="companyInfoTab.set('headOffice')"
            >
              Head Office
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="companyInfoTab() === 'offices' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'"
              (click)="companyInfoTab.set('offices')"
            >
              Offices
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="companyInfoTab() === 'terms' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'"
              (click)="companyInfoTab.set('terms')"
            >
              Terms
            </button>
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
              [class]="companyInfoTab() === 'emails' ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'text-gray-400 dark:text-muted hover:text-gray-600'"
              (click)="companyInfoTab.set('emails')"
            >
              Emails
            </button>
          </div>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 text-sm">
        @if (activeConflicts().length > 0) {
          <div class="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/15 p-3 mb-2">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <svg class="h-4 w-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <span class="text-xs font-semibold text-amber-800 dark:text-amber-300">SeaSearcher has different values for {{ activeConflicts().length }} field{{ activeConflicts().length > 1 ? 's' : '' }}</span>
              </div>
              <button (click)="onDismissAllConflicts()" class="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 font-medium">Dismiss all</button>
            </div>
            <div class="space-y-2">
              @for (conflict of activeConflicts(); track conflict.field) {
                <div class="flex items-start justify-between gap-2 rounded-md bg-white/70 px-2.5 py-2 text-xs">
                  <div class="min-w-0 flex-1">
                    <span class="font-semibold text-gray-700 dark:text-ink-dim">{{ FIELD_LABELS[conflict.field] || conflict.field }}</span>
                    <div class="mt-0.5 text-gray-500 dark:text-muted">
                      Yours: <span class="font-medium text-gray-700 dark:text-ink-dim">{{ conflict.localValue || '(empty)' }}</span>
                    </div>
                    <div class="text-gray-500 dark:text-muted">
                      SeaSearcher: <span class="font-medium text-amber-700 dark:text-amber-400">{{ conflict.seasearcherValue || '(empty)' }}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 gap-1.5">
                    <button
                      (click)="onAcceptConflict(conflict.field)"
                      class="rounded bg-amber-100 dark:bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-200 transition-colors"
                    >Accept</button>
                    <button
                      (click)="onDismissConflict(conflict.field, conflict.seasearcherValue)"
                      class="rounded bg-gray-100 dark:bg-surface-3 px-2 py-1 text-[11px] font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-200 transition-colors"
                    >Keep mine</button>
                  </div>
                </div>
              }
            </div>
          </div>
        }
        @if (dismissedConflictsCount() > 0) {
          <div class="rounded-lg border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 px-3 py-2 mb-2">
            <button (click)="showDismissedConflicts.set(!showDismissedConflicts())" class="flex items-center justify-between w-full text-xs text-gray-500 dark:text-muted hover:text-gray-700">
              <span>{{ dismissedConflictsCount() }} dismissed SeaSearcher difference{{ dismissedConflictsCount() > 1 ? 's' : '' }}</span>
              <svg class="h-3.5 w-3.5 transition-transform" [class.rotate-180]="showDismissedConflicts()" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            @if (showDismissedConflicts()) {
              <div class="space-y-1.5 mt-2">
                @for (conflict of dismissedConflictsList(); track conflict.field) {
                  <div class="flex items-center justify-between gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-xs text-gray-500 dark:text-muted">
                    <div class="min-w-0 flex-1">
                      <span class="font-medium text-gray-600 dark:text-ink-dim">{{ FIELD_LABELS[conflict.field] || conflict.field }}</span>
                      — SS: <span class="text-gray-500 dark:text-muted">{{ conflict.seasearcherValue || '(empty)' }}</span>
                    </div>
                    <button
                      (click)="onAcceptConflict(conflict.field)"
                      class="rounded bg-gray-100 dark:bg-surface-3 px-2 py-1 text-[11px] font-medium text-gray-500 dark:text-muted hover:bg-gray-200 transition-colors"
                    >Accept</button>
                  </div>
                }
              </div>
            }
          </div>
        }
        @if (companyInfoTab() === 'info') {
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt class="text-gray-500 dark:text-muted">Company Name</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input
                    type="text"
                    [value]="editName()"
                    (input)="editName.set($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.name }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Type</dt>
              <dd class="mt-0.5 flex flex-wrap gap-1.5">
                @for (t of allTypes(); track t) {
                  <button
                    (click)="onTypeToggle(t)"
                    [disabled]="typeSaving()"
                    class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer"
                    [class]="companyTypes().includes(t)
                      ? typeBadgeClass(t)
                      : 'bg-gray-50 dark:bg-bg-2 text-gray-400 dark:text-muted border border-dashed border-gray-300 dark:border-line-strong hover:border-gray-400 hover:text-gray-500'"
                  >
                    {{ typeLabel(t) }}
                  </button>
                }
                @if (typeSaving()) {
                  <svg class="h-4 w-4 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                }
              </dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Country</dt>
              @if (editing()) {
                <dd class="mt-0.5 relative">
                  <div class="flex items-center gap-2">
                    @if (editCountryIso()) {
                      <span class="text-lg">{{ countryFlag(editCountryIso()) }}</span>
                    }
                    <input
                      type="text"
                      [value]="countrySearchQuery()"
                      (input)="onCountrySearch($any($event.target).value)"
                      (focus)="showCountryDropdown.set(true)"
                      placeholder="Search country…"
                      class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    />
                  </div>
                  @if (showCountryDropdown() && filteredCountries().length) {
                    <div class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg">
                      @for (c of filteredCountries(); track c.code) {
                        <button
                          type="button"
                          (mousedown)="selectCountry(c)"
                          class="flex w-full items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors"
                        >
                          <span>{{ countryFlag(c.code) }}</span>
                          <span class="font-medium text-gray-900 dark:text-ink">{{ c.name }}</span>
                          <span class="ml-auto text-xs text-gray-400 dark:text-muted font-mono">{{ c.code }}</span>
                        </button>
                      }
                    </div>
                  }
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">
                  @if (company()!.countryIso) {
                    <span class="mr-1">{{ countryFlag(company()!.countryIso) }}</span>
                  }
                  {{ company()!.countryIso ? countryLabel(company()!.countryIso) : (company()!.country ?? '—') }}
                </dd>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Country Code</dt>
              <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink font-mono">
                @if (editing()) {
                  {{ editCountryIso() || '—' }}
                } @else {
                  {{ company()!.countryIso ?? '—' }}
                }
              </dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Year Formed</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input
                    type="number"
                    [value]="editYearFormed() ?? ''"
                    (input)="editYearFormed.set($any($event.target).value ? +$any($event.target).value : null)"
                    placeholder="e.g. 1998"
                    class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.yearFormed ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Fleet Size</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input
                    type="number"
                    [value]="editFleetSize() ?? ''"
                    (input)="editFleetSize.set($any($event.target).value ? +$any($event.target).value : null)"
                    placeholder="0"
                    class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.fleetSize ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Credit Limit</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input
                    type="text"
                    [value]="editCreditLimit()"
                    (input)="editCreditLimit.set($any($event.target).value)"
                    placeholder="0"
                    class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">\${{ company()!.creditLimit }}</dd>
              }
              @if (!editing()) {
                <button (click)="requestCredit.emit()"
                  class="mt-1 inline-flex items-center gap-1 rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-xs font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  Request Credit
                </button>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Company IMO</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input
                    type="text"
                    [value]="editCompanyImo()"
                    (input)="editCompanyImo.set($any($event.target).value)"
                    placeholder="IMO number"
                    class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.companyImo ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Seasearcher ID</dt>
              <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.seasearcherId ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-muted">Sanctioned</dt>
              <dd class="mt-0.5">
                @if (company()!.isSanctioned) {
                  <span class="inline-flex rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">Yes</span>
                } @else {
                  <span class="inline-flex rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">No</span>
                }
              </dd>
            </div>
            @if (companyTypes().includes('SUPPLIER')) {
              <div>
                <dt class="text-gray-500 dark:text-muted">Preferred Invoicing Company</dt>
                @if (editing()) {
                  <dd class="mt-0.5">
                    <select
                      [ngModel]="editPreferredInvoicingCompanyId() ?? ''"
                      (ngModelChange)="editPreferredInvoicingCompanyId.set($event || null)"
                      class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2.5 py-1.5 text-sm font-medium text-gray-900 dark:text-ink focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    >
                      <option value="">— None —</option>
                      @for (co of ownCompanies(); track co.id) {
                        <option [value]="co.id">{{ co.name }}</option>
                      }
                    </select>
                  </dd>
                } @else {
                  <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">
                    {{ company()!.preferredInvoicingCompanyName ?? '—' }}
                  </dd>
                }
              </div>
            }
          </dl>
        } @else if (companyInfoTab() === 'headOffice') {
          <div class="space-y-4">
            @if (
              editing() ||
              company()!.headOfficeAddress ||
              company()!.headOfficePhone ||
              company()!.headOfficeEmail ||
              company()!.website ||
              enrichment()?.headOffice?.faxNumbers?.length
            ) {
              <dl class="grid grid-cols-1 gap-y-3 text-sm">
                @if (editing() || company()!.headOfficeAddress) {
                  <div>
                    <dt class="text-gray-500 dark:text-muted">Address</dt>
                    @if (editing()) {
                      <dd class="mt-0.5">
                        <textarea
                          [ngModel]="editHeadOfficeAddress()"
                          (ngModelChange)="editHeadOfficeAddress.set($event)"
                          rows="3"
                          class="block w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm shadow-sm focus:border-brand-600 focus:ring-brand-600"
                          placeholder="Head office address"
                        ></textarea>
                      </dd>
                    } @else {
                      <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink whitespace-pre-line">{{ company()!.headOfficeAddress }}</dd>
                    }
                  </div>
                }
                @if (editing() || company()!.headOfficePhone) {
                  <div>
                    <dt class="text-gray-500 dark:text-muted">Phone</dt>
                    @if (editing()) {
                      <dd class="mt-0.5">
                        <input
                          type="text"
                          [ngModel]="editHeadOfficePhone()"
                          (ngModelChange)="editHeadOfficePhone.set($event)"
                          class="block w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm shadow-sm focus:border-brand-600 focus:ring-brand-600"
                          placeholder="Phone number"
                        />
                      </dd>
                    } @else {
                      <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ company()!.headOfficePhone }}</dd>
                    }
                  </div>
                }
                @if (editing() || company()!.headOfficeEmail) {
                  <div>
                    <dt class="text-gray-500 dark:text-muted">Email</dt>
                    @if (editing()) {
                      <dd class="mt-0.5">
                        <input
                          type="email"
                          [ngModel]="editHeadOfficeEmail()"
                          (ngModelChange)="editHeadOfficeEmail.set($event)"
                          class="block w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm shadow-sm focus:border-brand-600 focus:ring-brand-600"
                          placeholder="Email address"
                        />
                      </dd>
                    } @else {
                      <dd class="mt-0.5">
                        <a [href]="'mailto:' + company()!.headOfficeEmail" class="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-800">
                          {{ company()!.headOfficeEmail }}
                        </a>
                      </dd>
                    }
                  </div>
                }
                @if (editing() || company()!.website) {
                  <div>
                    <dt class="text-gray-500 dark:text-muted">Website</dt>
                    @if (editing()) {
                      <dd class="mt-0.5">
                        <input
                          type="url"
                          [ngModel]="editWebsite()"
                          (ngModelChange)="editWebsite.set($event)"
                          class="block w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm shadow-sm focus:border-brand-600 focus:ring-brand-600"
                          placeholder="https://example.com"
                        />
                      </dd>
                    } @else {
                      <dd class="mt-0.5">
                        <a [href]="websiteUrl()" target="_blank" rel="noopener noreferrer" class="font-medium text-brand-600 dark:text-brand-400 hover:text-brand-800">
                          {{ company()!.website }}
                        </a>
                      </dd>
                    }
                  </div>
                }
                @if (enrichment()?.headOffice?.faxNumbers?.length) {
                  <div>
                    <dt class="text-gray-500 dark:text-muted">Fax</dt>
                    <dd class="mt-0.5 font-medium text-gray-900 dark:text-ink">{{ formatPhone(enrichment()!.headOffice!.faxNumbers!) }}</dd>
                  </div>
                }
              </dl>
            }
            @if (enrichment()?.headOffice?.personnel?.length) {
              <div class="border-t border-gray-100 dark:border-line px-5 py-4">
                <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted mb-3">Contact Persons</h3>
                <div class="space-y-2">
                  @for (c of enrichment()!.headOffice!.personnel!; track c.name) {
                    <div class="flex items-center gap-3">
                      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-3 text-xs font-semibold text-gray-600 dark:text-ink-dim">
                        {{ c.name.charAt(0) }}
                      </div>
                      <div>
                        <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ c.name }}</span>
                        @if (c.jobTitle) {
                          <span class="ml-1.5 text-xs text-gray-500 dark:text-muted">{{ c.jobTitle }}</span>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
            @if (
              !company()!.headOfficeAddress &&
              !company()!.headOfficePhone &&
              !company()!.headOfficeEmail &&
              !company()!.website &&
              !enrichment()?.headOffice?.faxNumbers?.length &&
              !enrichment()?.headOffice?.personnel?.length
            ) {
              <div class="text-xs text-gray-500 dark:text-muted text-center">Head office data unavailable</div>
            }
          </div>
        } @else if (companyInfoTab() === 'offices') {
          @if (showAddOffice()) {
            <div class="-mx-5 -mt-4 border-b border-gray-100 dark:border-line px-5 py-4 bg-gray-50/50 dark:bg-surface-2">
              <div class="space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">City *</label>
                    <input
                      [ngModel]="officeForm().city"
                      (ngModelChange)="officeForm.set({ ...officeForm(), city: $event })"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      placeholder="e.g. Monaco"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Country</label>
                    <input
                      [ngModel]="officeForm().country"
                      (ngModelChange)="officeForm.set({ ...officeForm(), country: $event })"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      placeholder="e.g. Monaco"
                    />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Address</label>
                  <input
                    [ngModel]="officeForm().address"
                    (ngModelChange)="officeForm.set({ ...officeForm(), address: $event })"
                    class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                    placeholder="Street address"
                  />
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Phone</label>
                    <input
                      [ngModel]="officeForm().phone"
                      (ngModelChange)="officeForm.set({ ...officeForm(), phone: $event })"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      placeholder="+377 ..."
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Email</label>
                    <input
                      [ngModel]="officeForm().email"
                      (ngModelChange)="officeForm.set({ ...officeForm(), email: $event })"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      placeholder="office&#64;example.com"
                    />
                  </div>
                </div>
                <div class="flex items-center justify-end gap-2 pt-1">
                  <button (click)="cancelOfficeForm()"
                    class="rounded-md px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-100 dark:hover:bg-surface-tint-strong">
                    Cancel
                  </button>
                  <button
                    [disabled]="savingOffice() || !officeForm().city.trim()"
                    (click)="onSaveOffice()"
                    class="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
                    {{ editingOfficeId() ? 'Update' : 'Add' }}
                  </button>
                </div>
              </div>
            </div>
          } @else if (!companyOffices().length && !showAddOffice()) {
            <div class="flex flex-col items-center justify-center py-8">
              <p class="text-xs text-gray-500 dark:text-muted mb-2">No offices on file</p>
              <button (click)="openAddOffice()" class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">+ Add office</button>
            </div>
          }
          @if (companyOffices().length) {
            <div class="divide-y divide-gray-50 -mx-5" [class.-mt-4]="!showAddOffice()">
              @for (office of companyOffices(); track office.id) {
                <div class="group px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors dark:hover:bg-surface-tint">
                  <div class="flex items-start justify-between">
                    <div>
                      <span class="font-medium text-gray-900 dark:text-ink">{{ office.city }}</span>
                      @if (office.country) {
                        <span class="text-gray-400 dark:text-muted ml-1">{{ office.country }}</span>
                      }
                      @if (office.address) {
                        <p class="text-xs text-gray-500 dark:text-muted mt-0.5">{{ office.address }}</p>
                      }
                      @if (office.phone || office.email) {
                        <div class="flex items-center gap-3 mt-1 text-xs text-gray-400 dark:text-muted">
                          @if (office.phone) { <span>{{ office.phone }}</span> }
                          @if (office.email) { <span>{{ office.email }}</span> }
                        </div>
                      }
                    </div>
                    <div class="hidden group-hover:flex items-center gap-1 shrink-0 ml-2">
                      <button (click)="openEditOffice(office)"
                        class="rounded p-1 text-gray-400 dark:text-muted hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-tint-strong"
                        title="Edit office">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                        </svg>
                      </button>
                      <button (click)="onDeleteOffice(office.id)"
                        class="rounded p-1 text-gray-400 dark:text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
                        title="Delete office">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              }
            </div>
            @if (!showAddOffice()) {
              <div class="px-5 py-2 border-t border-gray-100 dark:border-line -mx-5">
                <button (click)="openAddOffice()" class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">+ Add office</button>
              </div>
            }
          }
        } @else if (companyInfoTab() === 'terms') {
          <div class="space-y-4">
            <div>
              <dt class="text-gray-500 dark:text-muted">Special Customer Terms</dt>
              <dd class="mt-0.5">
                @if (editing()) {
                  <textarea
                    [ngModel]="editSpecialCustomerTerms()"
                    (ngModelChange)="editSpecialCustomerTerms.set($event)"
                    rows="8"
                    class="block w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-sm shadow-sm focus:border-brand-600 focus:ring-brand-600"
                    placeholder="Terms that apply when this company is the customer on an order. Takes precedence over the invoicing company's default customer terms."
                  ></textarea>
                } @else {
                  <div class="whitespace-pre-line text-sm text-gray-900 dark:text-ink">
                    @if (company()!.specialCustomerTerms) {
                      {{ company()!.specialCustomerTerms }}
                    } @else {
                      <span class="text-gray-400 dark:text-muted italic">No special customer terms set. The invoicing company's default terms will be used.</span>
                    }
                  </div>
                }
              </dd>
            </div>
            <div class="rounded-md bg-blue-50 dark:bg-blue-500/15 p-3 text-xs text-blue-700 dark:text-blue-400">
              <p class="font-medium mb-1">How this works:</p>
              <ul class="list-disc list-inside space-y-0.5">
                <li>These terms appear on Offer/Confirmation documents when this company is the customer.</li>
                <li>They override the invoicing company's default customer terms.</li>
                <li>Per-order terms (set on the order itself) still take highest precedence.</li>
              </ul>
            </div>
          </div>
        } @else if (companyInfoTab() === 'emails') {
          @if (showAddEmail()) {
            <div class="-mx-5 -mt-4 border-b border-gray-100 dark:border-line px-5 py-4 bg-gray-50/50 dark:bg-surface-2">
              <div class="space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Type</label>
                    <select
                      [ngModel]="emailForm().emailType"
                      (ngModelChange)="emailForm.set({ ...emailForm(), emailType: $event })"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                      @for (type of emailTypeOptions; track type) {
                        <option [ngValue]="type">{{ formatEmailType(type) }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Label (optional)</label>
                    <input
                      [ngModel]="emailForm().label"
                      (ngModelChange)="emailForm.set({ ...emailForm(), label: $event })"
                      placeholder="e.g. Main office"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                    />
                  </div>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Email Address</label>
                  <input
                    type="email"
                    [ngModel]="emailForm().email"
                    (ngModelChange)="emailForm.set({ ...emailForm(), email: $event })"
                    placeholder="email@example.com"
                    class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  />
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [ngModel]="emailForm().isPrimary"
                    (ngModelChange)="emailForm.set({ ...emailForm(), isPrimary: $event })"
                    class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600"
                  />
                  <span class="text-xs text-gray-600 dark:text-ink-dim">Set as primary for this type</span>
                </label>
                <div class="flex justify-end gap-2">
                  <button (click)="cancelEmailForm()"
                    class="rounded-md border border-gray-200 dark:border-line px-3 py-1 text-xs text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">
                    Cancel
                  </button>
                  <button (click)="onSaveEmail()"
                    [disabled]="savingEmail() || !emailForm().email.trim()"
                    class="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors">
                    {{ editingEmailId() ? 'Update' : 'Add' }}
                  </button>
                </div>
              </div>
            </div>
          }
          @if (emailsLoading()) {
            <div class="flex items-center justify-center py-6">
              <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else if (!companyEmails().length && !showAddEmail()) {
            <div class="text-center text-gray-400 dark:text-muted">
              No emails added yet.
              <button (click)="openAddEmail()" class="text-brand-600 dark:text-brand-400 hover:text-brand-700 font-medium">Add one</button>
            </div>
          } @else {
            <div class="divide-y divide-gray-50 -mx-5">
              @for (e of companyEmails(); track e.id) {
                <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group dark:hover:bg-surface-tint">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                        [class]="emailTypeBadgeClass(e.emailType)">
                        {{ formatEmailType(e.emailType) }}
                      </span>
                      <a [href]="'mailto:' + e.email" class="font-medium text-brand-700 dark:text-brand-400 hover:text-brand-900 hover:underline">{{ e.email }}</a>
                      @if (e.isPrimary) {
                        <span class="inline-flex items-center rounded-full bg-green-50 dark:bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">Primary</span>
                      }
                    </div>
                    <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button (click)="openEditEmail(e)"
                        class="rounded p-1 text-gray-400 dark:text-muted hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </button>
                      <button (click)="onDeleteEmail(e.id)"
                        class="rounded p-1 text-gray-400 dark:text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  @if (e.label) {
                    <p class="text-xs text-gray-500 dark:text-muted mt-0.5">{{ e.label }}</p>
                  }
                  <p class="text-[10px] text-gray-400 dark:text-muted mt-1">
                    Added by {{ e.addedByName ?? 'Unknown' }} · {{ e.createdAt | dateLabel }}
                  </p>
                </div>
              }
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class CompanyInfoCardComponent {
  // ─── Inputs ─────────────────────────────────────────────────────────
  readonly company = input.required<CounterpartyDto>();
  readonly enrichment = input<CompanyEnrichment | null>(null);
  readonly syncConflicts = input<{ field: string; localValue: any; seasearcherValue: any; dismissed: boolean }[]>([]);
  readonly ownCompanies = input<OwnCompanyDto[]>([]);
  readonly allTypes = input<string[]>(['CLIENT', 'SUPPLIER', 'BROKER', 'AGENT']);
  readonly companyTypes = input<string[]>([]);
  readonly companyOffices = input<CompanyOfficeDto[]>([]);
  readonly companyEmails = input<CompanyEmailDto[]>([]);
  readonly emailsLoading = input<boolean>(false);

  // ─── Outputs ────────────────────────────────────────────────────────
  readonly companyChange = output<Record<string, any>>();
  readonly typeToggle = output<string>();
  readonly conflictAccept = output<string>();
  readonly conflictDismiss = output<{ field: string; seasearcherValue: any }>();
  readonly officeSave = output<{ city: string; country: string; address: string; phone: string; email: string; editId?: string }>();
  readonly officeDelete = output<string>();
  readonly emailSave = output<{ emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean; editId?: string }>();
  readonly emailDelete = output<string>();
  readonly requestCredit = output<void>();

  // ─── State ──────────────────────────────────────────────────────────
  readonly companyInfoTab = signal<'info' | 'headOffice' | 'offices' | 'emails' | 'terms'>('info');
  readonly editing = signal(false);
  readonly editSaving = signal(false);
  readonly typeSaving = signal(false);
  readonly editName = signal('');
  readonly editCountry = signal('');
  readonly editCountryIso = signal('');
  readonly editYearFormed = signal<number | null>(null);
  readonly editFleetSize = signal<number | null>(null);
  readonly editCreditLimit = signal('');
  readonly editCompanyImo = signal('');
  readonly editHeadOfficeAddress = signal('');
  readonly editHeadOfficePhone = signal('');
  readonly editHeadOfficeEmail = signal('');
  readonly editWebsite = signal('');
  readonly editSpecialCustomerTerms = signal('');
  readonly editPreferredInvoicingCompanyId = signal<string | null>(null);

  readonly countrySearchQuery = signal('');
  readonly showCountryDropdown = signal(false);
  readonly filteredCountries = computed(() => {
    const q = this.countrySearchQuery().toLowerCase().trim();
    if (!q) return COUNTRIES.slice(0, 20);
    return COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
    ).slice(0, 20);
  });

  readonly showDismissedConflicts = signal(false);
  readonly activeConflicts = computed(() => this.syncConflicts().filter(c => !c.dismissed));
  readonly dismissedConflictsCount = computed(() => this.syncConflicts().filter(c => c.dismissed).length);
  readonly dismissedConflictsList = computed(() => this.syncConflicts().filter(c => c.dismissed));

  readonly showAddOffice = signal(false);
  readonly officeForm = signal<{ city: string; country: string; address: string; phone: string; email: string }>({ city: '', country: '', address: '', phone: '', email: '' });
  readonly editingOfficeId = signal<string | null>(null);
  readonly savingOffice = signal(false);

  readonly showAddEmail = signal(false);
  readonly emailForm = signal<{ emailType: CompanyEmailType; email: string; label: string; isPrimary: boolean }>({ emailType: 'general', email: '', label: '', isPrimary: false });
  readonly editingEmailId = signal<string | null>(null);
  readonly savingEmail = signal(false);
  readonly emailTypeOptions: CompanyEmailType[] = ['sales', 'invoice', 'inquiry', 'general'];

  readonly FIELD_LABELS: Record<string, string> = {
    name: 'Company Name',
    country: 'Country',
    countryIso: 'Country Code',
    yearFormed: 'Year Formed',
    fleetSize: 'Fleet Size',
    headOfficeAddress: 'Address',
    headOfficePhone: 'Phone',
    headOfficeEmail: 'Email',
    website: 'Website',
    companyImo: 'Company IMO',
    companyRoles: 'Company Roles',
  };

  constructor() {
    effect(() => {
      // Reset editing state when the parent updates the company after a save
      const c = this.company();
      if (this.editSaving() && c) {
        this.editSaving.set(false);
        this.editing.set(false);
      }
    });

    effect(() => {
      this.companyTypes();
      if (this.typeSaving()) {
        this.typeSaving.set(false);
      }
    });

    effect(() => {
      this.companyOffices();
      if (this.savingOffice()) {
        this.savingOffice.set(false);
        this.showAddOffice.set(false);
        this.editingOfficeId.set(null);
      }
    });

    effect(() => {
      this.companyEmails();
      if (this.savingEmail()) {
        this.savingEmail.set(false);
        this.showAddEmail.set(false);
        this.editingEmailId.set(null);
      }
    });
  }

  // ─── Inline editing ─────────────────────────────────────────────────
  startEditing(): void {
    const c = this.company();
    this.editName.set(c.name);
    this.editCountry.set(c.country ?? '');
    this.editCountryIso.set(c.countryIso ?? '');
    this.editYearFormed.set(c.yearFormed ?? null);
    this.editFleetSize.set(c.fleetSize ?? null);
    this.editCreditLimit.set(c.creditLimit ?? '0');
    this.editCompanyImo.set(c.companyImo ?? '');
    this.editHeadOfficeAddress.set(c.headOfficeAddress ?? '');
    this.editHeadOfficePhone.set(c.headOfficePhone ?? '');
    this.editHeadOfficeEmail.set(c.headOfficeEmail ?? '');
    this.editWebsite.set(c.website ?? '');
    this.editSpecialCustomerTerms.set(c.specialCustomerTerms ?? '');
    this.editPreferredInvoicingCompanyId.set(c.preferredInvoicingCompanyId ?? null);
    this.countrySearchQuery.set(c.country ?? '');
    this.showCountryDropdown.set(false);
    this.editing.set(true);
  }

  cancelEditing(): void {
    this.editing.set(false);
    this.showCountryDropdown.set(false);
  }

  private buildCompanyPatch(): Record<string, any> {
    const c = this.company();
    const body: Record<string, any> = {};
    if (this.editName() !== c.name) body['name'] = this.editName();
    if (this.editCountry() !== (c.country ?? '')) body['country'] = this.editCountry() || null;
    if (this.editCountryIso() !== (c.countryIso ?? '')) body['countryIso'] = this.editCountryIso() || null;
    if (this.editCreditLimit() !== (c.creditLimit ?? '0')) body['creditLimit'] = this.editCreditLimit() || null;
    if (this.editYearFormed() !== c.yearFormed) body['yearFormed'] = this.editYearFormed();
    if (this.editFleetSize() !== c.fleetSize) body['fleetSize'] = this.editFleetSize();
    if (this.editCompanyImo() !== (c.companyImo ?? '')) body['companyImo'] = this.editCompanyImo() || null;
    if (this.editHeadOfficeAddress() !== (c.headOfficeAddress ?? '')) body['headOfficeAddress'] = this.editHeadOfficeAddress() || null;
    if (this.editHeadOfficePhone() !== (c.headOfficePhone ?? '')) body['headOfficePhone'] = this.editHeadOfficePhone() || null;
    if (this.editHeadOfficeEmail() !== (c.headOfficeEmail ?? '')) body['headOfficeEmail'] = this.editHeadOfficeEmail() || null;
    if (this.editWebsite() !== (c.website ?? '')) body['website'] = this.editWebsite() || null;
    if (this.editSpecialCustomerTerms() !== (c.specialCustomerTerms ?? '')) body['specialCustomerTerms'] = this.editSpecialCustomerTerms() || null;
    if (this.editPreferredInvoicingCompanyId() !== (c.preferredInvoicingCompanyId ?? null)) body['preferredInvoicingCompanyId'] = this.editPreferredInvoicingCompanyId();
    return body;
  }

  onSaveEditing(): void {
    const patch = this.buildCompanyPatch();
    if (Object.keys(patch).length === 0) {
      this.editing.set(false);
      return;
    }
    this.editSaving.set(true);
    this.companyChange.emit(patch);
  }

  // ─── Type toggles ───────────────────────────────────────────────────
  onTypeToggle(type: string): void {
    if (this.typeSaving()) return;
    this.typeSaving.set(true);
    this.typeToggle.emit(type);
  }

  typeLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'CLIENT': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'SUPPLIER': return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'BROKER': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-400';
      case 'AGENT': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-400';
      default: return 'bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400';
    }
  }

  // ─── Country picker ─────────────────────────────────────────────────
  countryFlag(iso3: string | null | undefined): string {
    return countryFlagByIso3(iso3 ?? null);
  }

  onCountrySearch(value: string): void {
    this.countrySearchQuery.set(value);
    this.showCountryDropdown.set(true);
  }

  selectCountry(country: Country): void {
    this.editCountry.set(country.name);
    this.editCountryIso.set(country.code);
    this.countrySearchQuery.set(country.name);
    this.showCountryDropdown.set(false);
  }

  // ─── Conflict resolution ────────────────────────────────────────────
  onAcceptConflict(field: string): void {
    this.conflictAccept.emit(field);
  }

  onDismissConflict(field: string, seasearcherValue: any): void {
    this.conflictDismiss.emit({ field, seasearcherValue });
  }

  onDismissAllConflicts(): void {
    for (const conflict of this.activeConflicts()) {
      this.onDismissConflict(conflict.field, conflict.seasearcherValue);
    }
  }

  // ─── Offices ────────────────────────────────────────────────────────
  openAddOffice(): void {
    this.officeForm.set({ city: '', country: '', address: '', phone: '', email: '' });
    this.editingOfficeId.set(null);
    this.showAddOffice.set(true);
  }

  openEditOffice(o: CompanyOfficeDto): void {
    this.officeForm.set({ city: o.city, country: o.country ?? '', address: o.address ?? '', phone: o.phone ?? '', email: o.email ?? '' });
    this.editingOfficeId.set(o.id);
    this.showAddOffice.set(true);
  }

  cancelOfficeForm(): void {
    this.showAddOffice.set(false);
    this.editingOfficeId.set(null);
  }

  onSaveOffice(): void {
    const form = this.officeForm();
    if (!form.city.trim()) return;
    this.savingOffice.set(true);
    this.officeSave.emit({ ...form, editId: this.editingOfficeId() ?? undefined });
  }

  onDeleteOffice(officeId: string): void {
    this.officeDelete.emit(officeId);
  }

  // ─── Emails ─────────────────────────────────────────────────────────
  openAddEmail(): void {
    this.emailForm.set({ emailType: 'general', email: '', label: '', isPrimary: false });
    this.editingEmailId.set(null);
    this.showAddEmail.set(true);
  }

  openEditEmail(e: CompanyEmailDto): void {
    this.emailForm.set({ emailType: e.emailType, email: e.email, label: e.label ?? '', isPrimary: e.isPrimary });
    this.editingEmailId.set(e.id);
    this.showAddEmail.set(true);
  }

  cancelEmailForm(): void {
    this.showAddEmail.set(false);
    this.editingEmailId.set(null);
  }

  formatEmailType(type: CompanyEmailType): string {
    switch (type) {
      case 'sales': return 'Sales';
      case 'invoice': return 'Invoice';
      case 'inquiry': return 'Inquiry';
      case 'general': return 'General';
      default: return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }

  emailTypeBadgeClass(type: CompanyEmailType): string {
    switch (type) {
      case 'sales': return 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400';
      case 'invoice': return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400';
      case 'inquiry': return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400';
      case 'general': return 'bg-gray-100 text-gray-600 dark:bg-gray-500/15 dark:text-gray-400';
      default: return 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400';
    }
  }

  onSaveEmail(): void {
    const form = this.emailForm();
    if (!form.email.trim()) return;
    this.savingEmail.set(true);
    this.emailSave.emit({ ...form, editId: this.editingEmailId() ?? undefined });
  }

  onDeleteEmail(emailId: string): void {
    this.emailDelete.emit(emailId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  websiteUrl(): string {
    const w = this.company().website;
    if (!w) return '#';
    return w.startsWith('http') ? w : `https://${w}`;
  }

  formatPhone(nums: Array<{ countryDialingCode: string; areaDialingCode: string; number: string }>): string {
    return nums.map(t => `+${t.countryDialingCode} ${t.areaDialingCode} ${t.number}`.trim()).join(', ');
  }
}
