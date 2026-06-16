import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { VesselDetailStore } from '../vessel-detail.store';

@Component({
  selector: 'app-vessel-companies-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700">
          Companies
          @if (store.vesselCompanies().length) {
            <span class="ml-1 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {{ store.vesselCompanies().length }}
            </span>
          }
        </h2>
        <button (click)="store.openAddCompany()"
          class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
          + Add
        </button>
      </div>

      @if (store.showAddCompany()) {
        <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
          <div class="space-y-2">
            @if (!store.editingCompanyId()) {
              <div class="relative">
                @if (store.selectedCompany()) {
                  <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm">
                    <span class="font-medium text-brand-800">{{ store.selectedCompany()!.name }}</span>
                    <button (click)="store.clearSelectedCompany()"
                      class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                } @else {
                  <input
                    [ngModel]="store.companySearch()"
                    (ngModelChange)="store.onCompanySearch($event)"
                    placeholder="Search company..."
                    class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                  @if (store.companySearchResults().length) {
                    <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                      @for (c of store.companySearchResults(); track c.key) {
                        <button (click)="store.selectCompany(c)"
                          class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 transition-colors flex items-center justify-between">
                          <span class="font-medium text-gray-900">{{ c.name }}</span>
                          @if (c.source === 'seasearcher') {
                            <span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Import</span>
                          } @else if (c.country) {
                            <span class="text-xs text-gray-400">{{ c.country }}</span>
                          }
                        </button>
                      }
                    </div>
                  }
                }
              </div>
            }

            <div>
              <label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <select
                [ngModel]="store.companyForm().role"
                (ngModelChange)="store.companyForm.set({ ...store.companyForm(), role: $event })"
                class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                @for (grp of store.roleGroups(); track grp.group) {
                  <optgroup [label]="grp.group">
                    @for (role of grp.roles; track role.key) {
                      <option [ngValue]="role.key">{{ role.label }}</option>
                    }
                  </optgroup>
                }
              </select>
            </div>

            @if (!store.editingCompanyId() && store.selectedCompany() && store.selectedCompanyRoleExists()) {
              <div class="text-[11px] text-amber-600">This role is already assigned to another company on this vessel. Adding will replace it.</div>
            }

            @if (store.selectedCompany() || store.editingCompanyId()) {
              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-xs font-medium text-gray-500">Contact Person</label>
                  @if (!store.addingNewContact()) {
                    <button (click)="store.addingNewContact.set(true)" class="text-[10px] font-medium text-brand-600 hover:text-brand-700 transition-colors">+ New</button>
                  }
                </div>
                @if (store.addingNewContact()) {
                  <div class="space-y-1.5 rounded-md border border-brand-200 bg-brand-50/30 p-2 mb-1">
                    <input
                      [ngModel]="store.newContactName()"
                      (ngModelChange)="store.newContactName.set($event)"
                      placeholder="Contact name *"
                      class="w-full rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <div class="flex gap-1.5">
                      <input
                        [ngModel]="store.newContactRole()"
                        (ngModelChange)="store.newContactRole.set($event)"
                        placeholder="Role (e.g. Bunker Manager)"
                        class="flex-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                      <input
                        [ngModel]="store.newContactEmail()"
                        (ngModelChange)="store.newContactEmail.set($event)"
                        placeholder="Email"
                        class="flex-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                      <input
                        [ngModel]="store.newContactPhone()"
                        (ngModelChange)="store.newContactPhone.set($event)"
                        placeholder="Phone"
                        class="flex-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div class="flex justify-end gap-1.5">
                      <button (click)="store.cancelNewContact()" class="rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100 transition-colors">Cancel</button>
                      <button (click)="store.createNewContact()" [disabled]="!store.newContactName().trim() || store.creatingContact()"
                        class="rounded bg-brand-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                        {{ store.creatingContact() ? 'Adding...' : 'Add Contact' }}
                      </button>
                    </div>
                  </div>
                }
                @if (store.companyContactsLoading()) {
                  <div class="text-xs text-gray-400 py-1">Loading contacts...</div>
                } @else if (store.companyContacts().length) {
                  <select
                    [ngModel]="store.companyForm().contactId"
                    (ngModelChange)="store.companyForm.set({ ...store.companyForm(), contactId: $event || null })"
                    class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                    <option [ngValue]="null">— None —</option>
                    @for (ct of store.companyContacts(); track ct.id) {
                      <option [ngValue]="ct.id">{{ ct.name }}@if (ct.role) { ({{ ct.role }}) }</option>
                    }
                  </select>
                } @else if (!store.addingNewContact()) {
                  <div class="text-xs text-gray-400 py-1">No contacts on file</div>
                }
              </div>
            }

            <textarea
              [ngModel]="store.companyForm().note"
              (ngModelChange)="store.companyForm.set({ ...store.companyForm(), note: $event })"
              placeholder="Notes"
              rows="2"
              class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            ></textarea>
            <div class="flex justify-end gap-2">
              <button (click)="store.cancelCompanyForm()"
                class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button (click)="store.saveVesselCompany()"
                [disabled]="store.savingCompany() || (!store.editingCompanyId() && !store.selectedCompany())"
                class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                {{ store.editingCompanyId() ? 'Update' : 'Add' }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (store.companiesLoading()) {
        <div class="flex items-center justify-center py-6">
          <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (!store.vesselCompanies().length && !store.seasearcherSuggestions().length && !store.showAddCompany()) {
        <div class="px-5 py-10 text-center text-sm text-gray-400">No companies added yet</div>
      } @else {
        <div class="divide-y divide-gray-50">
          @for (vc of store.vesselCompanies(); track vc.id) {
            <div class="px-5 py-3 text-sm hover:bg-gray-50/50 transition-colors group">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 cursor-help"
                      [title]="store.getRoleDescription(vc.role)">{{ store.formatRole(vc.role) }}</span>
                    @if (vc.source === 'seasearcher') {
                      <span class="inline-flex items-center rounded-full bg-blue-50 border border-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">SS</span>
                    }
                  </div>
                  <a [routerLink]="['/companies', vc.companyId]" class="mt-1 block font-medium text-brand-700 hover:text-brand-900 hover:underline leading-snug break-words">
                    {{ vc.companyName }}
                  </a>
                  @if (vc.contactName) {
                    <p class="text-xs text-gray-500 mt-0.5">{{ vc.contactName }}</p>
                  }
                  @if (vc.note) {
                    <button (click)="store.toggleNote(vc.id)" class="mt-1 flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clip-rule="evenodd" />
                      </svg>
                      Note
                    </button>
                    @if (store.expandedNotes().has(vc.id)) {
                      <p class="text-xs text-gray-400 mt-1 italic bg-gray-50 rounded px-2 py-1">{{ vc.note }}</p>
                    }
                  }
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 pt-0.5">
                  <button (click)="store.openEditCompany(vc)"
                    class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                  <button (click)="store.deleteVesselCompany(vc.id, vc.companyName, vc.role)"
                    class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
              <p class="text-[10px] text-gray-400 mt-1">
                Added by {{ vc.addedByName ?? 'Unknown' }} · {{ vc.createdAt | date:'mediumDate' }}
              </p>
            </div>
          }

          @if (store.seasearcherSuggestions().length) {
            <div class="border-t border-gray-100 px-5 py-3">
              <div class="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Seasearcher Ownership</div>
              @for (entry of store.seasearcherSuggestions(); track entry.typeCode + (entry.companyId ?? entry.companyName)) {
                <div class="py-2 text-sm">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <span class="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-medium text-blue-700 whitespace-nowrap cursor-help"
                        [title]="store.getSeasearcherTypeDescription(entry.typeCode)">{{ entry.type }}</span>
                      <div class="mt-1 leading-snug break-words">
                        @if (entry.companyId) {
                          <button (click)="store.navigateToCompanyById(entry.companyId)"
                            [disabled]="store.navigatingCompanyId() === entry.companyId"
                            class="text-left font-medium text-brand-700 hover:text-brand-900 hover:underline transition-colors">
                            {{ entry.companyName }}
                          </button>
                        } @else {
                          <span class="text-gray-700">{{ entry.companyName }}</span>
                        }
                      </div>
                    </div>
                    @if (entry.companyId) {
                      <button (click)="store.linkSeasearcherCompany(entry)"
                        [disabled]="store.navigatingCompanyId() === entry.companyId"
                        class="flex-shrink-0 mt-0.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors">
                        @if (store.navigatingCompanyId() === entry.companyId) {
                          <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Linking…</span>
                        } @else {
                          Link
                        }
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
export class VesselCompaniesTabComponent {
  readonly store = inject(VesselDetailStore);
}