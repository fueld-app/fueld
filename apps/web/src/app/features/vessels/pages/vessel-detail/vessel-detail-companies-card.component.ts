import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import type { VesselCompanyDto, VesselCompanyRole, VesselCompanyRoleOption, CompanyContactDto } from '@fueld/types';
import { flagFromIso3 } from '../../../../shared/utils/flags';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

export interface CompanySearchResultOption {
  key: string;
  source: 'local' | 'seasearcher';
  id?: string;
  seasearcherId?: string;
  name: string;
  country?: string | null;
}

export interface OwnershipEntry {
  type: string;
  typeCode: string;
  companyId: string | null;
  companyName: string;
  from: string;
  to: string | null;
  currentIndicator: boolean;
  country: { code: string | null; name: string | null };
}

@Component({
  selector: 'app-vessel-detail-companies-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, RouterLink, FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm min-[900px]:order-5 min-[900px]:h-[449px] min-[900px]:flex min-[900px]:flex-col overflow-hidden">
      <div class="border-b border-gray-100 dark:border-line px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">
          Companies
          @if (vesselCompanies().length) {
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">
              {{ vesselCompanies().length }}
            </span>
          }
        </h2>
        <button (click)="add.emit()"
          class="rounded-md bg-brand-50 dark:bg-brand-700/15 px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-500/20 transition-colors">
          + Add
        </button>
      </div>

      @if (showAddForm()) {
        <div class="border-b border-gray-100 dark:border-line px-5 py-4 bg-gray-50/50 dark:bg-surface-2">
          <div class="space-y-2">
            @if (!editingCompanyId()) {
              <div class="relative">
                @if (selectedCompany()) {
                  <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 dark:bg-brand-700/15 px-3 py-1.5 text-sm">
                    <span class="font-medium text-brand-800 dark:text-brand-300">{{ selectedCompany()!.name }}</span>
                    <button (click)="clearSelected.emit()"
                      class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                } @else {
                  <input
                    [ngModel]="companySearch()"
                    (ngModelChange)="companySearchChange.emit($event)"
                    placeholder="Search company..."
                    class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                  />
                  @if (searchResults().length) {
                    <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-lg max-h-48 overflow-y-auto">
                      @for (c of searchResults(); track c.key) {
                        <button (click)="selectCompany.emit(c)"
                          class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 dark:hover:bg-brand-500/15 transition-colors flex items-center justify-between">
                          <span class="font-medium text-gray-900 dark:text-ink">{{ c.name }}</span>
                          @if (c.source === 'seasearcher') {
                            <span class="rounded-full border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">Import</span>
                          } @else if (c.country) {
                            <span class="text-xs text-gray-400 dark:text-muted">{{ c.country }}</span>
                          }
                        </button>
                      }
                    </div>
                  }
                }
              </div>
            }

            <div>
              <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Role</label>
              <select
                [ngModel]="companyForm().role"
                (ngModelChange)="onRoleChange($event)"
                class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                @for (grp of roleGroups(); track grp.group) {
                  <optgroup [label]="grp.group">
                    @for (role of grp.roles; track role.key) {
                      <option [ngValue]="role.key">{{ role.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </div>

            @if (!editingCompanyId() && selectedCompany() && roleExists()) {
              <div class="text-[11px] text-amber-600 dark:text-amber-400">This role is already assigned to another company on this vessel. Adding will replace it.</div>
            }

            @if (selectedCompany() || editingCompanyId()) {
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted">Contact Person</label>
                  @if (!addingNewContact()) {
                    <button (click)="addNewContact.emit()" class="text-[10px] font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors">+ New</button>
                  }
                </div>
                @if (addingNewContact()) {
                  <div class="space-y-1.5 rounded-md border border-brand-200 dark:border-brand-500/30 bg-brand-50/30 p-2 mb-1">
                    <input
                      [ngModel]="newContactName()"
                      (ngModelChange)="newContactNameChange.emit($event)"
                      placeholder="Contact name *"
                      class="w-full rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                    />
                    <div class="flex gap-1.5">
                      <input
                        [ngModel]="newContactRole()"
                        (ngModelChange)="newContactRoleChange.emit($event)"
                        placeholder="Role"
                        class="flex-1 rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      />
                      <input
                        [ngModel]="newContactEmail()"
                        (ngModelChange)="newContactEmailChange.emit($event)"
                        placeholder="Email"
                        class="flex-1 rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      />
                      <input
                        [ngModel]="newContactPhone()"
                        (ngModelChange)="newContactPhoneChange.emit($event)"
                        placeholder="Phone"
                        class="flex-1 rounded-md border border-gray-200 dark:border-line px-2.5 py-1 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
                      />
                    </div>
                    <div class="flex justify-end gap-1.5">
                      <button (click)="cancelNewContact.emit()" class="rounded px-2 py-0.5 text-[10px] text-gray-500 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors">Cancel</button>
                      <button (click)="createNewContact.emit()" [disabled]="!newContactName().trim() || creatingContact()"
                        class="rounded bg-brand-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors">
                        {{ creatingContact() ? 'Adding...' : 'Add Contact' }}
                      </button>
                    </div>
                  </div>
                }
                @if (contactsLoading()) {
                  <div class="text-xs text-gray-400 dark:text-muted py-1">Loading contacts...</div>
                } @else if (companyContacts().length) {
                  <select
                    [ngModel]="companyForm().contactId"
                    (ngModelChange)="onContactChange($event)"
                    class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600">
                    <option [ngValue]="null">— None —</option>
                    @for (ct of companyContacts(); track ct.id) {
                      <option [ngValue]="ct.id">{{ ct.name }}@if (ct.role) { ({{ ct.role }}) }</option>
                    }
                  </select>
                } @else if (!addingNewContact()) {
                  <div class="text-xs text-gray-400 dark:text-muted py-1">No contacts on file</div>
                }
              </div>
            }

            <textarea
              [ngModel]="companyForm().note"
              (ngModelChange)="onNoteChange($event)"
              placeholder="Notes"
              rows="2"
              class="w-full rounded-md border border-gray-200 dark:border-line px-3 py-1.5 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            ></textarea>
            <div class="flex justify-end gap-2">
              <button (click)="cancel.emit()"
                class="rounded-md border border-gray-200 dark:border-line px-3 py-1 text-xs text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">
                Cancel
              </button>
              <button (click)="save.emit()"
                [disabled]="saving() || (!editingCompanyId() && !selectedCompany())"
                class="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors">
                {{ editingCompanyId() ? 'Update' : 'Add' }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (loading()) {
        <div class="flex-1 flex items-center justify-center py-6">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (!vesselCompanies().length && !seasearcherSuggestions().length && !showAddForm()) {
        <div class="flex-1 flex items-center justify-center text-sm text-gray-400 dark:text-muted">No companies added yet</div>
      } @else {
        <div class="flex-1 min-h-0 divide-y divide-gray-50 overflow-y-auto">
          @for (vc of vesselCompanies(); track vc.id) {
            <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group dark:hover:bg-surface-tint">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim cursor-help"
                      [title]="getRoleDescription(vc.role)">{{ formatRole(vc.role) }}</span>
                    @if (vc.source === 'seasearcher') {
                      <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/15 border border-blue-100 dark:border-blue-500/25 px-1.5 py-0.5 text-[9px] font-medium text-blue-600 dark:text-blue-400">SS</span>
                    }
                  </div>
                  <a [routerLink]="['/companies', vc.companyId]" class="mt-1 block font-medium text-brand-700 dark:text-brand-400 hover:text-brand-900 hover:underline leading-snug break-words">
                    @if (vc.companyCountryIso) {
                      <span class="mr-1">{{ companyFlag(vc.companyCountryIso) }}</span>
                    }
                    {{ vc.companyName }}
                  </a>
                  @if (vc.contactName) {
                    <p class="text-xs text-gray-500 dark:text-muted mt-0.5">{{ vc.contactName }}</p>
                  }
                  @if (vc.note) {
                    <button (click)="toggleNote(vc.id)" class="mt-1 flex items-center gap-1 text-[10px] text-gray-400 dark:text-muted hover:text-gray-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clip-rule="evenodd" />
                      </svg>
                      Note
                    </button>
                    @if (expandedNotes().has(vc.id)) {
                      <p class="text-xs text-gray-400 dark:text-muted mt-1 italic bg-gray-50 dark:bg-bg-2 rounded px-2 py-1">{{ vc.note }}</p>
                    }
                  }
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
                  <button (click)="edit.emit(vc)"
                    class="rounded p-1 text-gray-400 dark:text-muted hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-surface-tint-strong transition-colors" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button (click)="delete.emit(vc)"
                    class="rounded p-1 text-gray-400 dark:text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15 transition-colors" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
              <p class="text-[10px] text-gray-400 dark:text-muted mt-1">
                Added by {{ vc.addedByName ?? 'Unknown' }} · {{ vc.createdAt | dateLabel }}
              </p>
            </div>
          }

          @if (seasearcherSuggestions().length) {
            <div class="border-t border-gray-100 dark:border-line px-5 py-3">
              <div class="text-[10px] font-semibold text-gray-400 dark:text-muted uppercase tracking-wide mb-2">Seasearcher Ownership</div>
              @for (entry of seasearcherSuggestions(); track entry.typeCode + (entry.companyId ?? entry.companyName)) {
                <div class="py-2 text-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-500/15 border border-blue-200 dark:border-blue-500/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 whitespace-nowrap cursor-help"
                        [title]="getSeasearcherTypeDescription(entry.typeCode)">{{ entry.type }}</span>
                      <div class="mt-1 leading-snug break-words">
                        @if (entry.companyId) {
                          <button (click)="linkSeasearcher.emit(entry)"
                            class="text-left font-medium text-brand-700 dark:text-brand-400 hover:text-brand-900 hover:underline transition-colors">
                            @if (entry.country.code) {
                              <span class="mr-1">{{ ownerFlag(entry) }}</span>
                            }
                            {{ entry.companyName }}
                          </button>
                        } @else {
                          <span class="text-gray-700 dark:text-ink-dim">
                            @if (entry.country.code) {
                              <span class="mr-1">{{ ownerFlag(entry) }}</span>
                            }
                            {{ entry.companyName }}
                          </span>
                        }
                      </div>
                    </div>
                    @if (entry.companyId) {
                      <button (click)="linkSeasearcher.emit(entry)"
                        class="flex-shrink-0 mt-0.5 rounded-md border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors">
                        Link
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class VesselDetailCompaniesCardComponent {
  readonly vesselCompanies = input<VesselCompanyDto[]>([]);
  readonly seasearcherSuggestions = input<OwnershipEntry[]>([]);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly showAddForm = input(false);
  readonly editingCompanyId = input<string | null>(null);
  readonly selectedCompany = input<{ id: string; name: string } | null>(null);
  readonly companySearch = input('');
  readonly searchResults = input<CompanySearchResultOption[]>([]);
  readonly companyForm = input<{ companyId: string; role: VesselCompanyRole; contactId: string | null; note: string }>({ companyId: '', role: 'REGISTERED_OWNER', contactId: null, note: '' });
  readonly companyContacts = input<CompanyContactDto[]>([]);
  readonly contactsLoading = input(false);
  readonly addingNewContact = input(false);
  readonly newContactName = input('');
  readonly newContactRole = input('');
  readonly newContactEmail = input('');
  readonly newContactPhone = input('');
  readonly creatingContact = input(false);
  readonly roleOptions = input<VesselCompanyRoleOption[]>([]);
  readonly roleExists = input(false);
  readonly expandedNotes = input<Set<string>>(new Set());

  readonly add = output<void>();
  readonly edit = output<VesselCompanyDto>();
  readonly delete = output<VesselCompanyDto>();
  readonly save = output<void>();
  readonly cancel = output<void>();
  readonly clearSelected = output<void>();
  readonly selectCompany = output<CompanySearchResultOption>();
  readonly companySearchChange = output<string>();
  readonly linkSeasearcher = output<OwnershipEntry>();
  readonly newContactNameChange = output<string>();
  readonly newContactRoleChange = output<string>();
  readonly newContactEmailChange = output<string>();
  readonly newContactPhoneChange = output<string>();
  readonly cancelNewContact = output<void>();
  readonly createNewContact = output<void>();
  readonly addNewContact = output<void>();

  readonly roleGroups = computed(() => {
    const opts = this.roleOptions();
    const groups = new Map<string, VesselCompanyRoleOption[]>();
    for (const opt of opts) {
      const g = opt.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(opt);
    }
    return [...groups.entries()].map(([group, roles]) => ({ group, roles }));
  });

  onRoleChange(role: string): void {
    // Emit form change via a custom approach — parent handles the full form
  }

  onContactChange(contactId: string | null): void {
    // Parent handles form updates
  }

  onNoteChange(note: string): void {
    // Parent handles form updates
  }

  formatRole(role: string): string {
    const found = this.roleOptions().find(r => r.key === role);
    if (found) return found.label;
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase());
  }

  getRoleDescription(role: string): string {
    const found = this.roleOptions().find(r => r.key === role);
    return found?.description ?? '';
  }

  getSeasearcherTypeDescription(typeCode: string): string {
    const SS_CODE_TO_ROLE: Record<string, string> = {
      RO: 'REGISTERED_OWNER', NO: 'NOMINAL_OWNER', BO: 'BENEFICIAL_OWNER',
      CO: 'COMMERCIAL_OPERATOR', TP: 'THIRD_PARTY_OPERATOR',
      TM: 'TECHNICAL_MANAGER', IM: 'ISM_MANAGER',
    };
    const mappedRole = SS_CODE_TO_ROLE[typeCode];
    if (!mappedRole) return '';
    return this.getRoleDescription(mappedRole);
  }

  companyFlag(iso3: string | null | undefined): string {
    return flagFromIso3(iso3 ?? null);
  }

  ownerFlag(entry: OwnershipEntry): string {
    return flagFromIso3(entry.country.code ?? null);
  }

  toggleNote(id: string): void {
    // Parent handles note expansion
  }
}