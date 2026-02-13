import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderNumberSettingsDto, VesselCompanyRoleSettingsDto, VesselCompanyRoleOption } from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">General Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure order numbering and other general settings.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="grid gap-6 grid-cols-1 lg:grid-cols-2">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Order Number Template                                   -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 00-1.5 0v2.546l-.943-1.048a.75.75 0 00-1.114 1.004l2.25 2.5a.75.75 0 001.114 0l2.25-2.5a.75.75 0 10-1.114-1.004l-.943 1.048V8.75z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Order Number Format</h3>
                <p class="text-xs text-gray-500">Configure the format used for external order/inquiry numbers.</p>
              </div>
            </div>

            <div class="p-6 space-y-5">

              <!-- Prefix -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Prefix (optional)</label>
                <input
                  type="text"
                  [ngModel]="prefix()"
                  (ngModelChange)="prefix.set($event)"
                  placeholder="e.g. FU-"
                  class="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Added before the template. Leave empty for no prefix.
                </p>
              </div>

              <!-- Template -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Template</label>
                <input
                  type="text"
                  [ngModel]="template()"
                  (ngModelChange)="template.set($event)"
                  class="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Available tokens:
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}PREFIX{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}YYYY{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}MM{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}DD{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}SEQ:N{{ '}' }}</code> (N = zero-padded digits)
                </p>
              </div>

              <!-- Preview -->
              <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Preview (next number)</p>
                <p class="text-lg font-mono font-semibold text-gray-900">{{ livePreview() }}</p>
                <p class="text-xs text-gray-500 mt-1">
                  Global sequence counter: {{ nextSeq() }}
                </p>
              </div>

              <!-- Save button -->
              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="save()"
                  [disabled]="saving()"
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
                >
                  @if (saving()) {
                    Saving…
                  } @else {
                    Save Changes
                  }
                </button>

                @if (saved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Vessel–Company Role Options                            -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Vessel–Company Roles</h3>
                <p class="text-xs text-gray-500">Configure the available role options when linking companies to vessels.</p>
              </div>
            </div>

            <div class="p-6 space-y-4">
              @if (rolesLoading()) {
                <div class="flex items-center justify-center py-6">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else {
                <div class="space-y-2">
                  @for (role of roles(); track role.key; let i = $index) {
                    <div class="flex items-center gap-3">
                      <div class="flex flex-col gap-0.5">
                        <button
                          (click)="moveRoleUp(i)"
                          [disabled]="i === 0"
                          class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move up"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                        <button
                          (click)="moveRoleDown(i)"
                          [disabled]="i === roles().length - 1"
                          class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move down"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                      <input
                        type="text"
                        [value]="role.key"
                        (input)="updateRoleKey(i, $any($event.target).value)"
                        placeholder="KEY"
                        class="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                      <input
                        type="text"
                        [value]="role.label"
                        (input)="updateRoleLabel(i, $any($event.target).value)"
                        placeholder="Label"
                        class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                      <select
                        [value]="role.group"
                        (change)="updateRoleGroup(i, $any($event.target).value)"
                        class="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      >
                        <option value="Legal & Financial">Legal & Financial</option>
                        <option value="Operational & Commercial">Operational & Commercial</option>
                        <option value="Technical & Safety">Technical & Safety</option>
                        <option value="Other">Other</option>
                      </select>
                      <button
                        (click)="removeRole(i)"
                        [disabled]="roles().length <= 1"
                        class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors"
                        title="Remove role"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>

                <button
                  (click)="addRole()"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  Add Role
                </button>

                <div class="flex items-center gap-3 pt-2">
                  <button
                    (click)="saveRoles()"
                    [disabled]="rolesSaving()"
                    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                           hover:bg-brand-700 disabled:opacity-50 transition-colors"
                  >
                    @if (rolesSaving()) {
                      Saving…
                    } @else {
                      Save Roles
                    }
                  </button>

                  @if (rolesSaved()) {
                    <span class="text-sm text-green-600 flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                      Saved
                    </span>
                  }
                </div>
              }
            </div>
          </div>

        </div>
      }

      <!-- Toast notification -->
      @if (toast()) {
        <div
          class="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity"
          [class]="toast()!.type === 'success'
            ? 'border border-green-200 bg-green-50 text-green-800'
            : 'border border-red-200 bg-red-50 text-red-800'"
        >
          {{ toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class SettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  readonly template = signal('{YYYY}{MM}{DD}-{SEQ:6}');
  readonly prefix = signal('');
  readonly nextSeq = signal(1);

  // Vessel-company roles
  readonly rolesLoading = signal(false);
  readonly rolesSaving = signal(false);
  readonly rolesSaved = signal(false);
  readonly roles = signal<VesselCompanyRoleOption[]>([]);

  readonly livePreview = computed(() => {
    const tmpl = this.template();
    const pfx = this.prefix();
    const seq = this.nextSeq();

    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');

    let result = tmpl
      .replace('{PREFIX}', pfx)
      .replace('{YYYY}', yyyy)
      .replace('{MM}', mm)
      .replace('{DD}', dd);

    result = result.replace(/\{SEQ:(\d+)\}/g, (_match: string, digits: string) => {
      return String(seq).padStart(parseInt(digits, 10), '0');
    });
    result = result.replace('{SEQ}', String(seq).padStart(6, '0'));

    return result;
  });

  ngOnInit(): void {
    this.loadSettings();
    this.loadRoles();
  }

  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
        ),
      );
      if (res.success) {
        this.template.set(res.data.template);
        this.prefix.set(res.data.prefix);
        this.nextSeq.set(res.data.nextSeq);
      }
    } catch {
      this.showToast('error', 'Failed to load order number settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
          {
            template: this.template(),
            prefix: this.prefix(),
          },
        ),
      );
      if (res.success) {
        this.nextSeq.set(res.data.nextSeq);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      } else {
        this.showToast('error', res.message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save order number settings.');
    } finally {
      this.saving.set(false);
    }
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  // ─── Vessel-Company Roles ──────────────────────────────────────────

  private async loadRoles(): Promise<void> {
    this.rolesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselCompanyRoleSettingsDto>>(
          `${API}/admin/settings/vessel-company-roles`,
        ),
      );
      if (res.success) {
        this.roles.set(res.data.roles);
      }
    } catch {
      this.showToast('error', 'Failed to load vessel-company roles.');
    } finally {
      this.rolesLoading.set(false);
    }
  }

  updateRoleKey(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], key: value.toUpperCase().replace(/[^A-Z0-9_]/g, '') };
    this.roles.set(updated);
  }

  updateRoleLabel(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], label: value };
    this.roles.set(updated);
  }

  updateRoleGroup(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], group: value };
    this.roles.set(updated);
  }

  addRole(): void {
    this.roles.set([...this.roles(), { key: '', label: '', group: 'Other' }]);
  }

  removeRole(index: number): void {
    const updated = this.roles().filter((_, i) => i !== index);
    this.roles.set(updated);
  }

  moveRoleUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.roles()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.roles.set(updated);
  }

  moveRoleDown(index: number): void {
    const arr = this.roles();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.roles.set(updated);
  }

  async saveRoles(): Promise<void> {
    const valid = this.roles().filter(r => r.key && r.label);
    if (valid.length === 0) {
      this.showToast('error', 'At least one role is required.');
      return;
    }
    this.rolesSaving.set(true);
    this.rolesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<VesselCompanyRoleSettingsDto>>(
          `${API}/admin/settings/vessel-company-roles`,
          { roles: valid },
        ),
      );
      if (res.success) {
        this.roles.set(res.data.roles);
        this.rolesSaved.set(true);
        setTimeout(() => this.rolesSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save vessel-company roles.');
    } finally {
      this.rolesSaving.set(false);
    }
  }
}
