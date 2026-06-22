import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  PortDocumentAssetDto,
  PortGateListPersonnelDto,
} from '@fueld/types';
import { API } from '@app/core/config/api';

interface PlaceOptionDto {
  id: string;
  name: string;
}

@Component({
  selector: 'app-port-documentation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Port Documentation</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Manage gate list personnel and review static port-document assets for enabled deployments.
          </p>
        </div>
        <button (click)="openCreateModal()" class="app-button-add">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Person
        </button>
      </div>

      @if (toast()) {
        <div class="mb-4 rounded-lg border px-4 py-3 text-sm"
          [class]="toast()!.type === 'success' ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 text-green-800 dark:text-green-300' : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300'">
          {{ toast()!.message }}
        </div>
      }

      <div class="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <div class="app-panel min-w-0">
          <div class="app-panel-header app-panel-header--teal">
            <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--teal">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-teal-600 dark:text-teal-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5ZM6.88 20.548a7.5 7.5 0 0 1 10.24 0 .75.75 0 0 0 1.024-1.096 9 9 0 0 0-12.288 0 .75.75 0 1 0 1.024 1.096Z" />
              </svg>
            </div>
            <div>
              <h2 class="text-base font-semibold text-gray-900 dark:text-ink">Gate List Personnel</h2>
              <p class="mt-1 text-sm text-gray-600 dark:text-ink-dim">The current active list is exported into port-facing gate list documents.</p>
            </div>
          </div>

          <div class="app-panel-body space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <input
                type="text"
                [ngModel]="search()"
                (ngModelChange)="search.set($event)"
                placeholder="Search name, role, or company"
                class="app-input w-full sm:max-w-sm"
              />
              <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-ink-dim">
                <input
                  type="checkbox"
                  [checked]="showInactive()"
                  (change)="showInactive.set($any($event.target).checked)"
                  class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600"
                />
                Show inactive
              </label>
            </div>

            @if (loading()) {
              <div class="py-10 text-sm text-gray-400 dark:text-muted">Loading gate list personnel…</div>
            } @else {
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80">
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Name</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Role</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Company</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">DL</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">TWIC</th>
                      <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">Status</th>
                      <th class="px-4 py-3 w-24"></th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100 dark:divide-line">
                    @for (person of filteredPersonnel(); track person.id) {
                      <tr class="hover:bg-gray-50/50 transition-colors">
                        <td class="px-4 py-3">
                          <div class="font-medium text-gray-900 dark:text-ink">{{ person.fullName }}</div>
                          @if (person.notes) {
                            <div class="mt-1 text-xs text-gray-500 dark:text-muted">{{ person.notes }}</div>
                          }
                        </td>
                        <td class="px-4 py-3 text-gray-700 dark:text-ink-dim">{{ person.roleTitle }}</td>
                        <td class="px-4 py-3 text-gray-700 dark:text-ink-dim">{{ person.company }}</td>
                        <td class="px-4 py-3 text-gray-700 dark:text-ink-dim">{{ formatDriverLicense(person) }}</td>
                        <td class="px-4 py-3 text-gray-700 dark:text-ink-dim">{{ person.twicHolder ? 'Yes' : 'No' }}</td>
                        <td class="px-4 py-3">
                          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                            [class]="person.active ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-surface-3 text-gray-600 dark:text-ink-dim'">
                            {{ person.active ? 'Active' : 'Inactive' }}
                          </span>
                        </td>
                        <td class="px-4 py-3">
                          <div class="flex items-center gap-1">
                            <button (click)="openEditModal(person)" class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-brand-600 transition-colors" title="Edit">
                              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                                <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="7" class="px-4 py-8 text-center text-gray-400 dark:text-muted">No gate list personnel found.</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>

        <div class="space-y-6">
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--sky">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--sky">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-600 dark:text-sky-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4.5 5.25A2.25 2.25 0 0 1 6.75 3h7.19a2.25 2.25 0 0 1 1.59.66l3.81 3.81a2.25 2.25 0 0 1 .66 1.59v8.19a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 17.25V5.25Z" />
                </svg>
              </div>
              <div>
                <h2 class="text-base font-semibold text-gray-900 dark:text-ink">Static Assets</h2>
                <p class="mt-1 text-sm text-gray-600 dark:text-ink-dim">Upload and version the shared Flange Worksheet used during order packaging.</p>
              </div>
            </div>
            <div class="app-panel-body space-y-3">
              <div class="rounded-lg border border-dashed border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div class="text-sm font-semibold text-gray-900 dark:text-ink">Flange Worksheet</div>
                    <div class="mt-1 text-xs text-gray-500 dark:text-muted">Accepted formats: XLSX, XLS, or PDF. Max size 10 MB.</div>
                  </div>
                  <label
                    class="inline-flex cursor-pointer items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-800"
                    [class.pointer-events-none]="uploadingAsset()"
                    [class.opacity-50]="uploadingAsset()"
                  >
                    <input
                      type="file"
                      accept=".xlsx,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/pdf"
                      class="hidden"
                      (change)="onFlangeWorksheetSelected($event)"
                    />
                    @if (uploadingAsset()) {
                      Uploading…
                    } @else {
                      Upload Flange Worksheet
                    }
                  </label>
                </div>
              </div>

              @if (assetsLoading()) {
                <div class="text-sm text-gray-400 dark:text-muted">Loading assets…</div>
              } @else if (assets().length === 0) {
                <div class="rounded-lg border border-dashed border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4 text-sm text-gray-500 dark:text-muted">
                  No Port Documentation assets uploaded yet.
                </div>
              } @else {
                @for (asset of assets(); track asset.id) {
                  <div class="rounded-lg border border-gray-200 dark:border-line p-4">
                    <div class="flex items-start justify-between gap-3">
                      <div>
                        <div class="text-sm font-semibold text-gray-900 dark:text-ink">{{ asset.displayName }}</div>
                        <div class="mt-1 text-xs text-gray-500 dark:text-muted">{{ asset.originalFileName }}</div>
                      </div>
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        [class]="asset.isCurrent ? 'bg-brand-100 dark:bg-brand-700/15 text-brand-700 dark:text-brand-400' : 'bg-gray-100 dark:bg-surface-3 text-gray-600 dark:text-ink-dim'">
                        {{ asset.isCurrent ? 'Current' : 'Historical' }}
                      </span>
                    </div>
                    <div class="mt-3 text-xs text-gray-500 dark:text-muted">
                      {{ asset.documentKind }} · v{{ asset.versionNumber }} · {{ formatFileSize(asset.fileSize) }}
                    </div>
                    <div class="mt-3 flex justify-end">
                      <button
                        type="button"
                        (click)="downloadAsset(asset)"
                        [disabled]="downloadingAssetId() === asset.id"
                        class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-ink-dim transition hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50"
                      >
                        @if (downloadingAssetId() === asset.id) {
                          Downloading…
                        } @else {
                          Download
                        }
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          </div>
        </div>
      </div>

      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div class="w-full max-w-xl rounded-xl bg-white dark:bg-surface p-6 shadow-xl mx-4" (click)="$event.stopPropagation()">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">{{ editingId() ? 'Edit' : 'Add' }} Gate List Person</h3>
            @if (formError()) {
              <div class="mt-3 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 p-3 text-sm text-red-700 dark:text-red-400">{{ formError() }}</div>
            }
            <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Full name *</label>
                <input type="text" [ngModel]="formFullName()" (ngModelChange)="formFullName.set($event)" class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Role / job title *</label>
                <input type="text" [ngModel]="formRoleTitle()" (ngModelChange)="formRoleTitle.set($event)" class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Company *</label>
                <input type="text" [ngModel]="formCompany()" (ngModelChange)="formCompany.set($event)" class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Driver license state</label>
                <input type="text" [ngModel]="formDriverLicenseState()" (ngModelChange)="formDriverLicenseState.set($event)" maxlength="8" class="app-input mt-1 w-full uppercase" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Driver license #</label>
                <input type="text" [ngModel]="formDriverLicenseNumber()" (ngModelChange)="formDriverLicenseNumber.set($event)" class="app-input mt-1 w-full" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Port (optional)</label>
                <select [ngModel]="formPlaceId()" (ngModelChange)="formPlaceId.set($event)" class="app-input mt-1 w-full">
                  <option value="">All ports</option>
                  @for (place of places(); track place.id) {
                    <option [value]="place.id">{{ place.name }}</option>
                  }
                </select>
              </div>
              <div class="flex flex-col gap-3 pt-2 sm:pt-7">
                <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-ink-dim">
                  <input type="checkbox" [checked]="formTwicHolder()" (change)="formTwicHolder.set($any($event.target).checked)" class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                  TWIC holder
                </label>
                <input type="checkbox" [checked]="formActive()" (change)="formActive.set($any($event.target).checked)" class="h-4 w-4 rounded border-gray-300 dark:border-line-strong text-brand-600 dark:text-brand-400 focus:ring-brand-600" />
                <label class="text-sm text-gray-700 dark:text-ink-dim">Active for future exports</label>
              </div>
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim">Notes</label>
                <textarea [ngModel]="formNotes()" (ngModelChange)="formNotes.set($event)" rows="3" class="app-input mt-1 w-full"></textarea>
              </div>
            </div>
            <div class="mt-5 flex justify-end gap-2">
              <button (click)="closeModal()" class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">Cancel</button>
              <button (click)="savePerson()" [disabled]="saving()" class="app-button-primary disabled:opacity-50">
                @if (saving()) { Saving… } @else { {{ editingId() ? 'Update' : 'Create' }} }
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class PortDocumentationPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly assetsLoading = signal(true);
  readonly saving = signal(false);
  readonly uploadingAsset = signal(false);
  readonly downloadingAssetId = signal<string | null>(null);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  readonly personnel = signal<PortGateListPersonnelDto[]>([]);
  readonly assets = signal<PortDocumentAssetDto[]>([]);
  readonly places = signal<PlaceOptionDto[]>([]);

  readonly search = signal('');
  readonly showInactive = signal(false);

  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly formFullName = signal('');
  readonly formRoleTitle = signal('');
  readonly formCompany = signal('');
  readonly formDriverLicenseState = signal('');
  readonly formDriverLicenseNumber = signal('');
  readonly formTwicHolder = signal(false);
  readonly formPlaceId = signal('');
  readonly formActive = signal(true);
  readonly formNotes = signal('');
  readonly formError = signal('');

  readonly filteredPersonnel = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.personnel().filter((person) => {
      if (!this.showInactive() && !person.active) return false;
      if (!search) return true;
      return [person.fullName, person.roleTitle, person.company, person.driverLicenseState ?? '', person.driverLicenseNumber ?? '', person.notes ?? '']
        .some((value) => value.toLowerCase().includes(search));
    });
  });

  ngOnInit(): void {
    void this.loadAll();
  }

  private async loadAll(): Promise<void> {
    await Promise.all([
      this.loadPersonnel(),
      this.loadAssets(),
      this.loadPlaces(),
    ]);
  }

  private async loadPersonnel(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortGateListPersonnelDto[]>>(`${API}/admin/port-documentation/gate-list/personnel`),
      );
      if (res.success) {
        this.personnel.set(res.data);
      } else {
        this.showToast('error', res.message ?? 'Failed to load gate list personnel.');
      }
    } catch {
      this.showToast('error', 'Failed to load gate list personnel.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAssets(): Promise<void> {
    this.assetsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortDocumentAssetDto[]>>(`${API}/admin/port-documentation/assets`),
      );
      if (res.success) {
        this.assets.set(res.data);
      }
    } catch {
      this.showToast('error', 'Failed to load Port Documentation assets.');
    } finally {
      this.assetsLoading.set(false);
    }
  }

  private async loadPlaces(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PlaceOptionDto[]>>(`${API}/admin/port-documentation/places`),
      );
      if (res.success) this.places.set(res.data);
    } catch {
      this.places.set([]);
    }
  }

  openCreateModal(): void {
    this.editingId.set(null);
    this.formFullName.set('');
    this.formRoleTitle.set('');
    this.formCompany.set('');
    this.formDriverLicenseState.set('');
    this.formDriverLicenseNumber.set('');
    this.formTwicHolder.set(false);
    this.formPlaceId.set('');
    this.formActive.set(true);
    this.formNotes.set('');
    this.formError.set('');
    this.showModal.set(true);
  }

  openEditModal(person: PortGateListPersonnelDto): void {
    this.editingId.set(person.id);
    this.formFullName.set(person.fullName);
    this.formRoleTitle.set(person.roleTitle);
    this.formCompany.set(person.company);
    this.formDriverLicenseState.set(person.driverLicenseState ?? '');
    this.formDriverLicenseNumber.set(person.driverLicenseNumber ?? '');
    this.formTwicHolder.set(person.twicHolder);
    this.formPlaceId.set(person.placeId ?? '');
    this.formActive.set(person.active);
    this.formNotes.set(person.notes ?? '');
    this.formError.set('');
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.formError.set('');
  }

  async savePerson(): Promise<void> {
    if (!this.formFullName().trim() || !this.formRoleTitle().trim() || !this.formCompany().trim()) {
      this.formError.set('Full name, role, and company are required.');
      return;
    }

    this.saving.set(true);
    this.formError.set('');

    const payload = {
      fullName: this.formFullName().trim(),
      roleTitle: this.formRoleTitle().trim(),
      company: this.formCompany().trim(),
      driverLicenseState: this.formDriverLicenseState().trim() || null,
      driverLicenseNumber: this.formDriverLicenseNumber().trim() || null,
      twicHolder: this.formTwicHolder(),
      placeId: this.formPlaceId().trim() || null,
      active: this.formActive(),
      notes: this.formNotes().trim() || null,
    };

    try {
      const response = this.editingId()
        ? await firstValueFrom(this.http.patch<ApiResponse<PortGateListPersonnelDto>>(`${API}/admin/port-documentation/gate-list/personnel/${this.editingId()}`, payload))
        : await firstValueFrom(this.http.post<ApiResponse<PortGateListPersonnelDto>>(`${API}/admin/port-documentation/gate-list/personnel`, payload));

      if (!response.success) {
        this.formError.set(response.message ?? 'Failed to save gate list person.');
        return;
      }

      await this.loadPersonnel();
      this.closeModal();
      this.showToast('success', this.editingId() ? 'Gate list person updated.' : 'Gate list person created.');
    } catch {
      this.formError.set('Failed to save gate list person.');
    } finally {
      this.saving.set(false);
    }
  }

  formatFileSize(size: number): string {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, idx);
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  async onFlangeWorksheetSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.uploadingAsset.set(true);
    try {
      const formData = new FormData();
      formData.set('file', file);
      const res = await firstValueFrom(
        this.http.post<ApiResponse<PortDocumentAssetDto>>(`${API}/admin/port-documentation/assets/flange-worksheet`, formData),
      );
      if (!res.success) {
        this.showToast('error', res.message ?? 'Failed to upload Flange Worksheet.');
        return;
      }

      await this.loadAssets();
      this.showToast('success', 'Flange Worksheet uploaded.');
    } catch {
      this.showToast('error', 'Failed to upload Flange Worksheet.');
    } finally {
      this.uploadingAsset.set(false);
    }
  }

  formatDriverLicense(person: PortGateListPersonnelDto): string {
    const state = person.driverLicenseState?.trim() ?? '';
    const number = person.driverLicenseNumber?.trim() ?? '';
    if (state && number) return `${state} / ${number}`;
    return state || number || '—';
  }

  async downloadAsset(asset: PortDocumentAssetDto): Promise<void> {
    this.downloadingAssetId.set(asset.id);
    try {
      const response = await firstValueFrom(
        this.http.get(`${API}/admin/port-documentation/assets/${asset.id}/download`, {
          responseType: 'blob',
          observe: 'response',
        }),
      );
      this.downloadBlobResponse(response, asset.originalFileName);
    } catch {
      this.showToast('error', 'Failed to download asset.');
    } finally {
      this.downloadingAssetId.set(null);
    }
  }

  private downloadBlobResponse(response: HttpResponse<Blob>, fallbackFileName: string): void {
    const blob = response.body;
    if (!blob) throw new Error('Missing file body');

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = this.extractFilename(response.headers.get('Content-Disposition')) ?? fallbackFileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  private extractFilename(header: string | null): string | null {
    const match = header?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? null;
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }
}