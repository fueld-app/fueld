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
import type { ApiResponse, TeamDto, OwnCompanyDto, AdminUserDto } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-teams-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Teams</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Organize users into teams. Each team has access to a set of your own companies.
          </p>
        </div>
        <button
          (click)="openCreateModal()"
          class="app-button-add"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Create Team
        </button>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="app-panel">
          <div class="app-panel-header app-panel-header--blue">
            <div class="app-panel-icon-shell app-panel-icon-shell--blue">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h8.5A2.75 2.75 0 0 1 17 6.75v6.5A2.75 2.75 0 0 1 14.25 16h-8.5A2.75 2.75 0 0 1 3 13.25v-6.5Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v.19l5.09 3.18a.75.75 0 0 0 .8 0l5.09-3.18v-.19c0-.69-.56-1.25-1.25-1.25h-8.5Zm9.75 3.2-4.3 2.687a2.25 2.25 0 0 1-2.38 0L4.5 8.7v4.55c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V8.7Z" />
              </svg>
            </div>
            <div>
              <h2 class="text-base font-semibold text-gray-900 dark:text-ink">Team Directory</h2>
              <p class="mt-1 text-sm text-gray-600 dark:text-ink-dim">Review team ownership, company access, and assigned members from one place.</p>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80 dark:bg-surface-2">
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Team Name</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Companies</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600 dark:text-ink-dim">Members</th>
                <th class="px-4 py-3 w-24"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-line">
              @for (team of teams(); track team.id) {
                <tr class="transition-colors hover:bg-gray-50/50 dark:hover:bg-surface-tint">
                  <td class="px-4 py-3 font-medium text-gray-900 dark:text-ink">{{ team.name }}</td>
                  <td class="px-4 py-3">
                    @if (team.companyNames.length) {
                      <div class="flex flex-wrap gap-1">
                        @for (name of team.companyNames; track name) {
                          <span class="inline-flex items-center rounded-full bg-brand-50 dark:bg-brand-700/15 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-400">
                            {{ name }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="text-gray-400 dark:text-muted">All companies</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-center text-gray-600 dark:text-ink-dim">
                    @if (team.memberNames.length) {
                      <div class="flex flex-wrap justify-center gap-1">
                        @for (name of team.memberNames; track name) {
                          <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-xs font-medium text-gray-700 dark:text-ink-dim">
                            {{ name }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="text-gray-400 dark:text-muted">No members</span>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-1">
                      <button (click)="openEditModal(team)" class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-brand-600 transition-colors" title="Edit">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                          <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                        </svg>
                      </button>
                      <button (click)="confirmDelete(team)" class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-red-500 transition-colors" title="Delete">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="px-4 py-8 text-center text-gray-400 dark:text-muted">
                    No teams created yet. Click "Create Team" to get started.
                  </td>
                </tr>
              }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Create / Edit Modal -->
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">{{ editingId() ? 'Edit' : 'Create' }} Team</h3>

            @if (formError()) {
              <div class="mt-3 rounded-lg bg-red-50 dark:bg-red-500/15 border border-red-200 dark:border-red-500/30 p-3 text-sm text-red-700 dark:text-red-400">{{ formError() }}</div>
            }

            <div class="mt-4 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Team Name *</label>
                <input type="text" [ngModel]="formName()" (ngModelChange)="formName.set($event)"
                  class="app-input mt-1 w-full"
                  placeholder="e.g. Europe Desk" />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-2">
                  Accessible Companies
                  <span class="text-xs text-gray-400 dark:text-muted ml-1">(leave empty = all own companies)</span>
                </label>
                @if (ownCompanies().length === 0) {
                  <p class="text-sm text-gray-400 dark:text-muted">No own companies configured. Add companies in "Our Companies" first.</p>
                } @else {
                  <div class="space-y-1.5 max-h-48 overflow-y-auto">
                    @for (co of ownCompanies(); track co.id) {
                      <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-surface-tint cursor-pointer">
                        <input type="checkbox" [checked]="selectedCompanyIds().has(co.id)"
                          (change)="toggleCompany(co.id)"
                          class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                        <span class="text-sm text-gray-900 dark:text-ink">{{ co.name }}</span>
                        @if (co.country) {
                          <span class="text-xs text-gray-500 dark:text-muted">{{ co.country }}</span>
                        }
                      </label>
                    }
                  </div>
                }
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-2">
                  Members
                  <span class="text-xs text-gray-400 dark:text-muted ml-1">(assign users to this team)</span>
                </label>
                @if (allUsers().length === 0) {
                  <p class="text-sm text-gray-400 dark:text-muted">No users found.</p>
                } @else {
                  <div class="space-y-1.5 max-h-48 overflow-y-auto">
                    @for (user of allUsers(); track user.id) {
                      <label class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-surface-tint cursor-pointer">
                        <input type="checkbox" [checked]="selectedMemberIds().has(user.id)"
                          (change)="toggleMember(user.id)"
                          class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                        <span class="text-sm text-gray-900 dark:text-ink">{{ user.name }}</span>
                        <span class="text-xs text-gray-500 dark:text-muted">{{ user.email }}</span>
                      </label>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="mt-5 flex justify-end gap-2">
              <button (click)="showModal.set(false)"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
              <button (click)="saveForm()" [disabled]="saving()"
                class="app-button-primary disabled:opacity-50">
                @if (saving()) { Saving… } @else { {{ editingId() ? 'Update' : 'Create' }} }
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete confirmation -->
      @if (deleteTarget()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
          <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Delete team?</h3>
            <p class="mt-2 text-sm text-gray-500 dark:text-muted">
              Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?
              {{ deleteTarget()!.memberCount }} user(s) will be unassigned.
            </p>
            <div class="mt-4 flex justify-end gap-2">
              <button (click)="deleteTarget.set(null)"
                class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
              <button (click)="executeDelete()"
                class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class TeamsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly teams = signal<TeamDto[]>([]);
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly allUsers = signal<AdminUserDto[]>([]);
  readonly loading = signal(true);

  // Modal
  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formName = signal('');
  readonly selectedCompanyIds = signal<Set<string>>(new Set());
  readonly selectedMemberIds = signal<Set<string>>(new Set());
  readonly saving = signal(false);
  readonly formError = signal('');

  // Delete
  readonly deleteTarget = signal<TeamDto | null>(null);

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [teamsRes, companiesRes, usersRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<TeamDto[]>>(`${API}/admin/settings/teams`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/admin/settings/own-companies`)),
        firstValueFrom(this.http.get<ApiResponse<AdminUserDto[]>>(`${API}/admin/users`)),
      ]);
      if (teamsRes.success) this.teams.set(teamsRes.data);
      if (companiesRes.success) this.ownCompanies.set(companiesRes.data);
      if (usersRes.success) this.allUsers.set(usersRes.data.filter(u => u.isActive));
    } catch (err) {
      console.error('Failed to load teams:', err);
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal(): void {
    this.editingId.set(null);
    this.formName.set('');
    this.selectedCompanyIds.set(new Set());
    this.selectedMemberIds.set(new Set());
    this.formError.set('');
    this.showModal.set(true);
  }

  openEditModal(team: TeamDto): void {
    this.editingId.set(team.id);
    this.formName.set(team.name);
    this.selectedCompanyIds.set(new Set(team.companyIds));
    this.selectedMemberIds.set(new Set(team.memberIds));
    this.formError.set('');
    this.showModal.set(true);
  }

  toggleCompany(companyId: string): void {
    this.selectedCompanyIds.update((s) => {
      const next = new Set(s);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  }

  toggleMember(userId: string): void {
    this.selectedMemberIds.update((s) => {
      const next = new Set(s);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  async saveForm(): Promise<void> {
    const name = this.formName().trim();
    if (!name) {
      this.formError.set('Team name is required.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    try {
      const companyIds = Array.from(this.selectedCompanyIds());
      let teamId: string | null = null;

      if (this.editingId()) {
        await firstValueFrom(
          this.http.patch<ApiResponse<TeamDto>>(`${API}/admin/settings/teams/${this.editingId()}`, {
            name,
            companyIds,
          }),
        );
        teamId = this.editingId();
      } else {
        const createRes = await firstValueFrom(
          this.http.post<ApiResponse<TeamDto>>(`${API}/admin/settings/teams`, {
            name,
            companyIds,
          }),
        );
        teamId = createRes.data?.id ?? null;
      }

      this.showModal.set(false);

      // Sync members via single bulk PUT call
      if (teamId) {
        await this.syncMembers(teamId);
      }

      await this.loadData();
    } catch (err) {
      this.formError.set('Failed to save team.');
      console.error(err);
    } finally {
      this.saving.set(false);
    }
  }

  private async syncMembers(teamId: string): Promise<void> {
    const memberIds = Array.from(this.selectedMemberIds());
    await firstValueFrom(
      this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/teams/${teamId}/members`, { memberIds }),
    );
  }

  confirmDelete(team: TeamDto): void {
    this.deleteTarget.set(team);
  }

  async executeDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<unknown>>(`${API}/admin/settings/teams/${target.id}`),
      );
      this.deleteTarget.set(null);
      await this.loadData();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }
}
