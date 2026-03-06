import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  BackupCapabilitiesDto,
  BackupStatusDto,
  BackupValidationDto,
} from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-backup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="space-y-6 p-6">
      <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Backup & Restore</h1>
          <p class="text-sm text-gray-500">
            Full-instance encrypted export and destructive restore for VPS migration.
          </p>
        </div>
        <button
          (click)="refresh()"
          [disabled]="loading()"
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {{ loading() ? 'Refreshing…' : 'Refresh Status' }}
        </button>
      </div>

      @if (error()) {
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ error() }}
        </div>
      }

      <div class="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Server Status</h2>
              <p class="text-sm text-gray-500">Runtime restore state, versioning, and command prerequisites.</p>
            </div>
            @if (status()?.restoreInProgress) {
              <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
                Restore In Progress
              </span>
            } @else {
              <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Ready
              </span>
            }
          </div>

          @if (capabilities(); as caps) {
            <div class="mt-6 grid gap-4 md:grid-cols-2">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Versions</p>
                <dl class="mt-3 space-y-2 text-sm">
                  <div class="flex justify-between gap-4"><dt class="text-gray-500">App</dt><dd class="font-mono text-gray-900">{{ caps.current.appVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500">Deploy</dt><dd class="font-mono text-gray-900">{{ caps.current.deployVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500">Schema</dt><dd class="font-mono text-gray-900">{{ caps.current.schemaVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500">Format</dt><dd class="font-mono text-gray-900">v{{ caps.current.backupFormatVersion }}</dd></div>
                </dl>
              </div>

              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">Prerequisites</p>
                <div class="mt-3 space-y-2 text-sm">
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500">pg_dump</span><strong [class]="caps.commands.pgDump ? okClass : badClass">{{ yesNo(caps.commands.pgDump) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500">psql</span><strong [class]="caps.commands.psql ? okClass : badClass">{{ yesNo(caps.commands.psql) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500">tar</span><strong [class]="caps.commands.tar ? okClass : badClass">{{ yesNo(caps.commands.tar) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500">Database URL</span><strong [class]="caps.prerequisites.databaseUrlConfigured ? okClass : badClass">{{ yesNo(caps.prerequisites.databaseUrlConfigured) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500">Credential encryption</span><strong [class]="caps.prerequisites.credentialEncryptionAvailable ? okClass : badClass">{{ credentialEncryptionLabel(caps) }}</strong></div>
                </div>
                <p class="mt-3 text-xs text-gray-500">
                  {{ caps.runtime.mode === 'production'
                    ? 'Production requires an explicit CREDENTIALS_ENCRYPTION_KEY.'
                    : 'Local development can fall back to DATABASE_URL, but an explicit key is recommended for portable restores.' }}
                </p>
              </div>
            </div>

            <div class="mt-4 rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-600">
              <p><strong class="text-gray-900">Managed paths</strong></p>
              <p class="mt-2 font-mono text-xs text-gray-500">{{ caps.paths.uploadsRoot }}</p>
              <p class="font-mono text-xs text-gray-500">{{ caps.paths.promptsDir }}</p>
            </div>
          }

          @if (status(); as restoreStatus) {
            <div class="mt-4 rounded-xl border border-gray-200 p-4 text-sm text-gray-600">
              <p><strong class="text-gray-900">Restore confirmation phrase</strong></p>
              <p class="mt-2 font-mono text-sm text-gray-700">{{ restoreStatus.confirmationPhrase }}</p>
              @if (restoreStatus.startedAt) {
                <p class="mt-2 text-xs text-gray-500">Started {{ restoreStatus.startedAt | date:'medium' }}</p>
              }
            </div>
          }
        </section>

        <section class="space-y-6">
          <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900">Create Backup</h2>
            <p class="mt-1 text-sm text-gray-500">Exports database, uploads, and prompt markdown files into an encrypted archive.</p>

            <label class="mt-4 block text-sm font-medium text-gray-700">Archive password</label>
            <input
              type="password"
              [(ngModel)]="exportPassword"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              placeholder="Minimum 8 characters"
            />

            <button
              (click)="exportBackup()"
              [disabled]="exporting() || !canExport()"
              class="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {{ exporting() ? 'Building Backup…' : 'Download Encrypted Backup' }}
            </button>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900">Validate Archive</h2>
            <p class="mt-1 text-sm text-gray-500">Checks format, schema compatibility, and restore prerequisites before you replace live data.</p>

            <label class="mt-4 block text-sm font-medium text-gray-700">Backup file</label>
            <div class="mt-1 flex items-center gap-3">
              <label class="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <input type="file" class="sr-only" (change)="onFileChange($event)" />
                Choose Backup File
              </label>
              <span class="min-w-0 truncate text-sm text-gray-500">
                {{ selectedFile()?.name ?? 'No file chosen' }}
              </span>
            </div>
            @if (selectedFile()) {
              <p class="mt-2 text-xs text-gray-500">{{ selectedFile()?.name }} • {{ formatBytes(selectedFile()?.size ?? 0) }}</p>
            }

            <label class="mt-4 block text-sm font-medium text-gray-700">Archive password</label>
            <input
              type="password"
              [(ngModel)]="importPassword"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />

            <div class="mt-4 flex gap-3">
              <button
                (click)="validateArchive()"
                [disabled]="validating() || !canValidate()"
                class="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {{ validating() ? 'Validating…' : 'Validate Backup' }}
              </button>
              <button
                (click)="clearValidation()"
                class="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Clear
              </button>
            </div>

            @if (validation(); as result) {
              <div class="mt-5 space-y-4 rounded-xl border p-4"
                [class]="result.compatible ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'">
                <div class="flex items-center justify-between gap-4">
                  <strong [class]="result.compatible ? 'text-emerald-800' : 'text-red-800'">
                    {{ result.compatible ? 'Backup is compatible' : 'Backup is not compatible' }}
                  </strong>
                  @if (result.manifest) {
                    <span class="font-mono text-xs text-gray-600">{{ result.manifest.schemaVersion }}</span>
                  }
                </div>

                @if (result.issues.length) {
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-red-700">Issues</p>
                    <ul class="mt-2 space-y-1 text-sm text-red-700">
                      @for (issue of result.issues; track issue) {
                        <li>• {{ issue }}</li>
                      }
                    </ul>
                  </div>
                }

                @if (result.warnings.length) {
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-amber-700">Warnings</p>
                    <ul class="mt-2 space-y-1 text-sm text-amber-700">
                      @for (warning of result.warnings; track warning) {
                        <li>• {{ warning }}</li>
                      }
                    </ul>
                  </div>
                }

                @if (result.manifest) {
                  <div class="grid gap-3 rounded-lg border border-white/60 bg-white/70 p-3 text-sm text-gray-700 md:grid-cols-2">
                    <div><span class="text-gray-500">App version</span><p class="font-mono">{{ result.manifest.appVersion }}</p></div>
                    <div><span class="text-gray-500">Created</span><p>{{ result.manifest.createdAt | date:'medium' }}</p></div>
                    <div><span class="text-gray-500">Uploads</span><p>{{ result.manifest.contents.uploadFileCount ?? 0 }} files</p></div>
                    <div><span class="text-gray-500">Prompts</span><p>{{ result.manifest.contents.promptFileCount ?? 0 }} files</p></div>
                  </div>
                }
              </div>
            }
          </div>

          <div class="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-red-900">Restore Backup</h2>
            <p class="mt-1 text-sm text-red-800">
              This fully replaces the current database, deletes target-only uploads and prompts, and cannot be undone by the app.
            </p>

            <label class="mt-4 block text-sm font-medium text-red-900">Confirmation phrase</label>
            <input
              type="text"
              [(ngModel)]="restoreConfirmation"
              class="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              [placeholder]="status()?.confirmationPhrase ?? 'RESTORE ALL DATA'"
            />

            <button
              (click)="restoreArchive()"
              [disabled]="restoring() || !canRestore()"
              class="mt-4 w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {{ restoring() ? 'Restoring…' : 'Start Destructive Restore' }}
            </button>
          </div>
        </section>
      </div>
    </div>
  `,
})
export class BackupPageComponent implements OnInit {
  protected readonly okClass = 'text-emerald-700';
  protected readonly badClass = 'text-red-700';

  private readonly http = inject(HttpClient);

  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly validating = signal(false);
  protected readonly restoring = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly capabilities = signal<BackupCapabilitiesDto | null>(null);
  protected readonly status = signal<BackupStatusDto | null>(null);
  protected readonly validation = signal<BackupValidationDto | null>(null);
  protected readonly selectedFile = signal<File | null>(null);

  protected exportPassword = '';
  protected importPassword = '';
  protected restoreConfirmation = '';

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  protected yesNo(value: boolean): string {
    return value ? 'Ready' : 'Missing';
  }

  protected credentialEncryptionLabel(caps: BackupCapabilitiesDto): string {
    if (caps.prerequisites.credentialsEncryptionKeyConfigured) {
      return caps.prerequisites.credentialsEncryptionKeyRequired ? 'Ready' : 'Explicit key set';
    }

    if (caps.prerequisites.credentialEncryptionAvailable && !caps.prerequisites.credentialsEncryptionKeyRequired) {
      return 'Fallback active';
    }

    return 'Missing';
  }

  protected formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  protected canExport(): boolean {
    return (this.exportPassword ?? '').trim().length >= 8 && this.capabilities()?.ready === true;
  }

  protected canValidate(): boolean {
    return Boolean(this.selectedFile()) && (this.importPassword ?? '').trim().length >= 8;
  }

  protected canRestore(): boolean {
    return this.canValidate()
      && this.validation()?.compatible === true
      && this.restoreConfirmation.trim() === (this.status()?.confirmationPhrase ?? 'RESTORE ALL DATA');
  }

  protected onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile.set(input.files?.[0] ?? null);
  }

  protected clearValidation(): void {
    this.validation.set(null);
    this.restoreConfirmation = '';
  }

  protected async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [statusRes, capsRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<BackupStatusDto>>(`${API}/admin/backup/status`)),
        firstValueFrom(this.http.get<ApiResponse<BackupCapabilitiesDto>>(`${API}/admin/backup/capabilities`)),
      ]);

      if (!statusRes.success) throw new Error(statusRes.message ?? 'Failed to load backup status');
      if (!capsRes.success) throw new Error(capsRes.message ?? 'Failed to load backup capabilities');

      this.status.set(statusRes.data);
      this.capabilities.set(capsRes.data);
    } catch (err) {
      this.error.set(this.describeError(err, 'Failed to load backup status'));
    } finally {
      this.loading.set(false);
    }
  }

  protected async exportBackup(): Promise<void> {
    this.exporting.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post(`${API}/admin/backup/export`, { password: this.exportPassword }, {
          responseType: 'blob',
          observe: 'response',
        }),
      );

      const body = response.body;
      if (!body) throw new Error('Backup response was empty');

      const fileName = this.extractFilename(response.headers.get('content-disposition'));
      this.downloadBlob(body, fileName);
    } catch (err) {
      this.error.set(this.describeError(err, 'Failed to export backup'));
    } finally {
      this.exporting.set(false);
    }
  }

  protected async validateArchive(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.validating.set(true);
    this.error.set(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('password', this.importPassword);

      const response = await firstValueFrom(
        this.http.post<ApiResponse<BackupValidationDto>>(`${API}/admin/backup/validate`, formData),
      );

      if (!response.success) throw new Error(response.message ?? 'Backup validation failed');
      this.validation.set(response.data);
    } catch (err) {
      this.error.set(this.describeError(err, 'Backup validation failed'));
    } finally {
      this.validating.set(false);
    }
  }

  protected async restoreArchive(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.restoring.set(true);
    this.error.set(null);
    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('password', this.importPassword);
      formData.set('confirmation', this.restoreConfirmation);

      const response = await firstValueFrom(
        this.http.post<ApiResponse<BackupValidationDto>>(`${API}/admin/backup/restore`, formData),
      );

      if (!response.success) throw new Error(response.message ?? 'Backup restore failed');
      this.validation.set(response.data);
      await this.refresh();
    } catch (err) {
      this.error.set(this.describeError(err, 'Backup restore failed'));
    } finally {
      this.restoring.set(false);
    }
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  private extractFilename(header: string | null): string {
    const match = header?.match(/filename="?([^";]+)"?/i);
    return match?.[1] ?? 'fueld-backup.fueldbak';
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const apiMessage = error.error?.message;
      if (typeof apiMessage === 'string' && apiMessage.trim()) {
        return apiMessage;
      }
      return error.message || fallback;
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return fallback;
  }
}