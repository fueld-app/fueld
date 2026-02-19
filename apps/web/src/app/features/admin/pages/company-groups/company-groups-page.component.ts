import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CompanyGroupDto, CounterpartyDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-company-groups-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Company Groups</h1>
          <p class="mt-1 text-sm text-gray-500">
            Named groups of customer companies for joint credit allocation.
          </p>
        </div>
        <button
          (click)="openCreateModal()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Create Group
        </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50/80">
                <th class="px-4 py-3 text-left font-medium text-gray-600">Group Name</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Companies</th>
                <th class="px-4 py-3 w-24"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (group of groups(); track group.id) {
                <tr class="transition-colors hover:bg-gray-50/50">
                  <td class="px-4 py-3 font-medium text-gray-900">{{ group.name }}</td>
                  <td class="px-4 py-3">
                    @if (group.companyNames.length) {
                      <div class="flex flex-wrap gap-1">
                        @for (name of group.companyNames; track name) {
                          <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            {{ name }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="text-gray-400">No companies</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-1">
                      <button (click)="openEditModal(group)" class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                          <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                        </svg>
                      </button>
                      <button (click)="confirmDelete(group)" class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="3" class="px-4 py-8 text-center text-gray-400">
                    No company groups created yet. Click "Create Group" to get started.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <!-- Create / Edit Modal -->
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">{{ editingId() ? 'Edit' : 'Create' }} Company Group</h3>

            @if (formError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{{ formError() }}</div>
            }

            <div class="mt-4 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700">Group Name *</label>
                <input type="text" [ngModel]="formName()" (ngModelChange)="formName.set($event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="e.g. Acme Corp Group" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">Company Search</label>
                <input type="text" [ngModel]="searchQuery()" (ngModelChange)="onSearchChange($event)"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="Search companies to add…" />

                @if (searchResults().length) {
                  <div class="mt-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
                    @for (co of searchResults(); track co.id) {
                      <button (click)="addCompany(co)"
                        class="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                        </svg>
                        <span class="text-gray-900">{{ co.name }}</span>
                        @if (co.country) {
                          <span class="text-xs text-gray-500">{{ co.country }}</span>
                        }
                      </button>
                    }
                  </div>
                }
              </div>

              <!-- Selected companies -->
              @if (selectedCompanies().length) {
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Selected Companies</label>
                  <div class="flex flex-wrap gap-1.5">
                    @for (co of selectedCompanies(); track co.id) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        {{ co.name }}
                        <button (click)="removeCompany(co.id)" class="text-amber-400 hover:text-amber-700">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                          </svg>
                        </button>
                      </span>
                    }
                  </div>
                </div>
              }
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <button (click)="showModal.set(false)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="saveForm()" [disabled]="saving()"
                class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                @if (saving()) { Saving… } @else { {{ editingId() ? 'Update' : 'Create' }} }
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete confirmation -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
          <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900">Delete group?</h3>
            <p class="mt-2 text-sm text-gray-500">
              Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?
              Credit lines referencing this group will be unlinked.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="deleteTarget.set(null)"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button (click)="executeDelete()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class CompanyGroupsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly groups = signal<CompanyGroupDto[]>([]);
  readonly loading = signal(true);

  // Modal
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formName = signal('');
  readonly selectedCompanies = signal<{ id: string; name: string }[]>([]);
  readonly saving = signal(false);
  readonly formError = signal('');

  // Search
  readonly searchQuery = signal('');
  readonly searchResults = signal<CounterpartyDto[]>([]);
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  // Delete
  readonly deleteTarget = signal<CompanyGroupDto | null>(null);

  ngOnInit(): void {
    this.loadGroups();
  }

  async loadGroups(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyGroupDto[]>>(`${API}/admin/settings/company-groups`),
      );
      if (res.success) this.groups.set(res.data);
    } catch (err) {
      console.error('Failed to load company groups:', err);
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal(): void {
    this.editingId.set(null);
    this.formName.set('');
    this.selectedCompanies.set([]);
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.formError.set('');
    this.showModal.set(true);
  }

  openEditModal(group: CompanyGroupDto): void {
    this.editingId.set(group.id);
    this.formName.set(group.name);
    this.selectedCompanies.set(
      group.companyIds.map((id, i) => ({ id, name: group.companyNames[i] || id })),
    );
    this.searchQuery.set('');
    this.searchResults.set([]);
    this.formError.set('');
    this.showModal.set(true);
  }

  onSearchChange(query: string): void {
    this.searchQuery.set(query);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    if (query.trim().length < 2) {
      this.searchResults.set([]);
      return;
    }
    this.searchTimeout = setTimeout(() => this.doSearch(query), 300);
  }

  private async doSearch(query: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API}/companies/local`, {
          params: { search: query, limit: '10' },
        }),
      );
      if (res.success) {
        const selected = new Set(this.selectedCompanies().map((c) => c.id));
        this.searchResults.set(res.data.companies.filter((c) => !selected.has(c.id)));
      }
    } catch {
      this.searchResults.set([]);
    }
  }

  addCompany(co: CounterpartyDto): void {
    this.selectedCompanies.update((list) => [...list, { id: co.id, name: co.name }]);
    this.searchResults.update((results) => results.filter((r) => r.id !== co.id));
  }

  removeCompany(id: string): void {
    this.selectedCompanies.update((list) => list.filter((c) => c.id !== id));
  }

  async saveForm(): Promise<void> {
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Group name is required.');
      return;
    }
    if (!this.selectedCompanies().length) {
      this.formError.set('Please add at least one company.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    try {
      const companyIds = this.selectedCompanies().map((c) => c.id);
      if (this.editingId()) {
        await firstValueFrom(
          this.http.patch<ApiResponse<CompanyGroupDto>>(
            `${API}/admin/settings/company-groups/${this.editingId()}`,
            { name, companyIds },
          ),
        );
      } else {
        await firstValueFrom(
          this.http.post<ApiResponse<CompanyGroupDto>>(`${API}/admin/settings/company-groups`, {
            name,
            companyIds,
          }),
        );
      }
      this.showModal.set(false);
      await this.loadGroups();
    } catch (err) {
      this.formError.set('Failed to save company group.');
      console.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  confirmDelete(group: CompanyGroupDto): void {
    this.deleteTarget.set(group);
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`${API}/admin/settings/company-groups/${target.id}`),
      );
      this.deleteTarget.set(null);
      await this.loadGroups();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }
}
