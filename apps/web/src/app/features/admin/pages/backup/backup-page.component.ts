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
import { AppHealthService } from '@app/core/runtime/app-health.service';

@Component({
  selector: 'app-backup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="space-y-6 p-6">
      <div class="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Backup & Restore</h1>
          <p class="text-sm text-gray-500 dark:text-muted">
            Full-instance encrypted export and destructive restore for VPS migration.
          </p>
        </div>
        <button
          (click)="refresh()"
          [disabled]="loading()"
          class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50"
        >
          {{ loading() ? 'Refreshing…' : 'Refresh Status' }}
        </button>
      </div>

      @if (error()) {
        <div class="rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {{ error() }}
        </div>
      }

      <div class="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <section class="rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-gray-900 dark:text-ink">Server Status</h2>
              <p class="text-sm text-gray-500 dark:text-muted">Runtime restore state, versioning, and command prerequisites.</p>
            </div>
            @if (status()?.restoreInProgress) {
              <span class="rounded-full bg-amber-100 dark:bg-amber-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                Restore In Progress
              </span>
            } @else {
              <span class="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                Ready
              </span>
            }
          </div>

          @if (capabilities(); as caps) {
            <div class="mt-6 grid gap-4 md:grid-cols-2">
              <div class="rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Versions</p>
                <dl class="mt-3 space-y-2 text-sm">
                  <div class="flex justify-between gap-4"><dt class="text-gray-500 dark:text-muted">App</dt><dd class="font-mono text-gray-900 dark:text-ink">{{ caps.current.appVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500 dark:text-muted">Deploy</dt><dd class="font-mono text-gray-900 dark:text-ink">{{ caps.current.deployVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500 dark:text-muted">Schema</dt><dd class="font-mono text-gray-900 dark:text-ink">{{ caps.current.schemaVersion }}</dd></div>
                  <div class="flex justify-between gap-4"><dt class="text-gray-500 dark:text-muted">Format</dt><dd class="font-mono text-gray-900 dark:text-ink">v{{ caps.current.backupFormatVersion }}</dd></div>
                </dl>
              </div>

              <div class="rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4">
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Prerequisites</p>
                <div class="mt-3 space-y-2 text-sm">
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500 dark:text-muted">pg_dump</span><strong [class]="caps.commands.pgDump ? okClass : badClass">{{ yesNo(caps.commands.pgDump) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500 dark:text-muted">psql</span><strong [class]="caps.commands.psql ? okClass : badClass">{{ yesNo(caps.commands.psql) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500 dark:text-muted">tar</span><strong [class]="caps.commands.tar ? okClass : badClass">{{ yesNo(caps.commands.tar) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500 dark:text-muted">Database URL</span><strong [class]="caps.prerequisites.databaseUrlConfigured ? okClass : badClass">{{ yesNo(caps.prerequisites.databaseUrlConfigured) }}</strong></div>
                  <div class="flex items-center justify-between gap-4"><span class="text-gray-500 dark:text-muted">Credential encryption</span><strong [class]="caps.prerequisites.credentialEncryptionAvailable ? okClass : badClass">{{ credentialEncryptionLabel(caps) }}</strong></div>
                </div>
                <p class="mt-3 text-xs text-gray-500 dark:text-muted">
                  {{ caps.runtime.mode === 'production'
                    ? 'Production requires an explicit CREDENTIALS_ENCRYPTION_KEY.'
                    : 'Local development can fall back to DATABASE_URL, but an explicit key is recommended for portable restores.' }}
                </p>
              </div>

              @if (appHealth(); as health) {
                <div class="rounded-xl border border-gray-200 dark:border-line bg-gray-50 dark:bg-bg-2 p-4 md:col-span-2">
                  <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-muted">Build Info</p>
                  <dl class="mt-3 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <dt class="text-gray-500 dark:text-muted">Build time</dt>
                      <dd class="mt-1 text-gray-900 dark:text-ink">{{ health.buildTime | date:'medium' }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500 dark:text-muted">Git SHA</dt>
                      <dd class="mt-1 font-mono text-gray-900 dark:text-ink" [title]="health.gitSha">{{ shortSha(health.gitSha) }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500 dark:text-muted">Schema version</dt>
                      <dd class="mt-1 font-mono text-gray-900 dark:text-ink">{{ caps.current.schemaVersion }}</dd>
                    </div>
                    <div>
                      <dt class="text-gray-500 dark:text-muted">Deploy version</dt>
                      <dd class="mt-1 font-mono text-gray-900 dark:text-ink" [title]="health.deployVersion">{{ health.deployVersion }}</dd>
                    </div>
                  </dl>
                </div>
              }
            </div>

            <div class="mt-4 rounded-xl border border-dashed border-gray-300 dark:border-line-strong p-4 text-sm text-gray-600 dark:text-ink-dim">
              <p><strong class="text-gray-900 dark:text-ink">Managed paths</strong></p>
              <p class="mt-2 font-mono text-xs text-gray-500 dark:text-muted">{{ caps.paths.uploadsRoot }}</p>
              <p class="font-mono text-xs text-gray-500 dark:text-muted">{{ caps.paths.promptsDir }}</p>
            </div>
          }

          @if (status(); as restoreStatus) {
            <div class="mt-4 rounded-xl border border-gray-200 dark:border-line p-4 text-sm text-gray-600 dark:text-ink-dim">
              <p><strong class="text-gray-900 dark:text-ink">Restore confirmation phrase</strong></p>
              <p class="mt-2 font-mono text-sm text-gray-700 dark:text-ink-dim">{{ restoreStatus.confirmationPhrase }}</p>
              @if (restoreStatus.startedAt) {
                <p class="mt-2 text-xs text-gray-500 dark:text-muted">Started {{ restoreStatus.startedAt | date:'medium' }}</p>
              }
            </div>
          }
        </section>

        <section class="space-y-6">
          <div class="rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-ink">Create Backup</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">Exports database, uploads, and prompt markdown files into an encrypted archive.</p>

            <label class="mt-4 block text-sm font-medium text-gray-700 dark:text-ink-dim">Archive password</label>
            <input
              type="password"
              [(ngModel)]="exportPassword"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
              placeholder="Minimum 8 characters"
            />

            <button
              (click)="exportBackup()"
              [disabled]="exporting() || !canExport()"
              class="mt-4 w-full rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
            >
              {{ exporting() ? 'Building Backup…' : 'Download Encrypted Backup' }}
            </button>
          </div>

          <div class="rounded-2xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-ink">Validate Archive</h2>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">Checks format, schema compatibility, and restore prerequisites before you replace live data.</p>

            <label class="mt-4 block text-sm font-medium text-gray-700 dark:text-ink-dim">Backup file</label>
            <div class="mt-1 flex items-center gap-3">
              <label class="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">
                <input type="file" class="sr-only" (change)="onFileChange($event)" />
                Choose Backup File
              </label>
              <span class="min-w-0 truncate text-sm text-gray-500 dark:text-muted">
                {{ selectedFile()?.name ?? 'No file chosen' }}
              </span>
            </div>
            @if (selectedFile()) {
              <p class="mt-2 text-xs text-gray-500 dark:text-muted">{{ selectedFile()?.name }} • {{ formatBytes(selectedFile()?.size ?? 0) }}</p>
            }

            <label class="mt-4 block text-sm font-medium text-gray-700 dark:text-ink-dim">Archive password</label>
            <input
              type="password"
              [(ngModel)]="importPassword"
              autocomplete="new-password"
              autocapitalize="off"
              spellcheck="false"
              class="mt-1 w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600"
            />

            <div class="mt-4 flex gap-3">
              <button
                (click)="validateArchive()"
                [disabled]="validating() || !canValidate()"
                class="flex-1 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint disabled:opacity-50"
              >
                {{ validating() ? 'Validating…' : 'Validate Backup' }}
              </button>
              <button
                (click)="clearValidation()"
                class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint"
              >
                Clear
              </button>
            </div>

            @if (validation(); as result) {
              <div class="mt-5 space-y-4 rounded-xl border p-4"
                [class]="result.compatible ? 'border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/15' : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15'">
                <div class="flex items-center justify-between gap-4">
                  <strong [class]="result.compatible ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'">
                    {{ result.compatible ? 'Backup is compatible' : 'Backup is not compatible' }}
                  </strong>
                  @if (result.manifest) {
                    <span class="font-mono text-xs text-gray-600 dark:text-ink-dim">{{ result.manifest.schemaVersion }}</span>
                  }
                </div>

                @if (result.issues.length) {
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Issues</p>
                    <ul class="mt-2 space-y-1 text-sm text-red-700 dark:text-red-400">
                      @for (issue of result.issues; track issue) {
                        <li>• {{ issue }}</li>
                      }
                    </ul>
                  </div>
                }

                @if (result.warnings.length) {
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Warnings</p>
                    <ul class="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-400">
                      @for (warning of result.warnings; track warning) {
                        <li>• {{ warning }}</li>
                      }
                    </ul>
                  </div>
                }

                @if (result.manifest) {
                  <div class="grid gap-3 rounded-lg border border-white/60 bg-white/70 p-3 text-sm text-gray-700 dark:text-ink-dim md:grid-cols-2">
                    <div><span class="text-gray-500 dark:text-muted">App version</span><p class="font-mono">{{ result.manifest.appVersion }}</p></div>
                    <div><span class="text-gray-500 dark:text-muted">Created</span><p>{{ result.manifest.createdAt | date:'medium' }}</p></div>
                    <div><span class="text-gray-500 dark:text-muted">Uploads</span><p>{{ result.manifest.contents.uploadFileCount ?? 0 }} files</p></div>
                    <div><span class="text-gray-500 dark:text-muted">Prompts</span><p>{{ result.manifest.contents.promptFileCount ?? 0 }} files</p></div>
                  </div>
                }
              </div>
            }
          </div>

          <div class="rounded-2xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-red-900 dark:text-red-300">Restore Backup</h2>
            <p class="mt-1 text-sm text-red-800 dark:text-red-300">
              This fully replaces the current database, deletes target-only uploads and prompts, and cannot be undone by the app.
            </p>

            <label class="mt-4 block text-sm font-medium text-red-900 dark:text-red-300">Confirmation phrase</label>
            <input
              type="text"
              [(ngModel)]="restoreConfirmation"
              class="mt-1 w-full rounded-lg border border-red-300 bg-white dark:bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
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
  private readonly appHealthService = inject(AppHealthService);

  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly validating = signal(false);
  protected readonly restoring = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly capabilities = signal<BackupCapabilitiesDto | null>(null);
  protected readonly status = signal<BackupStatusDto | null>(null);
  protected readonly validation = signal<BackupValidationDto | null>(null);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly appHealth = this.appHealthService.health;

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

  protected shortSha(gitSha: string): string {
    return gitSha.length > 12 ? gitSha.slice(0, 12) : gitSha;
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
        this.appHealthService.refresh(true),
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