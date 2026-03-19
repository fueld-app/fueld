import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PlattsReportStatus } from '@fueld/types';
import type {
  ApiResponse,
  CreatePlattsReportResponseDto,
  PaginatedResponse,
  PlattsReportDto,
} from '@fueld/types';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { PdfPreviewModalComponent } from '@app/shared/components/pdf-preview-modal/pdf-preview-modal.component';

@Component({
  selector: 'app-platts-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink, PdfPreviewModalComponent],
  template: `
    <div class="space-y-6 pb-2 min-w-0">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Platts</h1>
          <p class="text-sm text-gray-500">Historic and current Platts reports for the whole team, with canonical daily selection and source PDF access.</p>
        </div>
        <div class="flex flex-wrap gap-3">
          <label class="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <input type="file" accept="application/pdf" class="sr-only" (change)="onSingleFileChange($event)" />
            Choose PDF
          </label>
          <button
            (click)="uploadSingle()"
            [disabled]="uploading() || !selectedSingleFile()"
            class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {{ uploading() ? 'Uploading…' : 'Upload Report' }}
          </button>
          @if (auth.isAdmin()) {
            <label class="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <input type="file" accept="application/pdf" multiple class="sr-only" (change)="onBulkFilesChange($event)" />
              Choose Historic PDFs
            </label>
            <button
              (click)="uploadBulk()"
              [disabled]="bulkUploading() || bulkFiles().length === 0"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {{ bulkUploading() ? 'Importing…' : 'Bulk Import History' }}
            </button>
          }
        </div>
      </div>

      @if (error()) {
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error() }}</div>
      }

      @if (notice()) {
        <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{{ notice() }}</div>
      }

      <section class="max-w-full rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div class="xl:col-span-2">
            <label class="text-xs font-semibold uppercase tracking-wide text-gray-500">Search</label>
            <input [(ngModel)]="search" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Title or file name" />
          </div>
          <div>
            <label class="text-xs font-semibold uppercase tracking-wide text-gray-500">From</label>
            <input [(ngModel)]="fromDate" type="date" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold uppercase tracking-wide text-gray-500">To</label>
            <input [(ngModel)]="toDate" type="date" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
            <select [(ngModel)]="statusFilter" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">All</option>
              <option value="UPLOADED">Uploaded</option>
              <option value="PARSING">Parsing</option>
              <option value="READY">Ready</option>
              <option value="FAILED">Failed</option>
              <option value="SUPERSEDED">Superseded</option>
            </select>
          </div>
          <div class="flex items-end gap-3">
            <label class="flex items-center gap-2 text-sm text-gray-600">
              <input [(ngModel)]="canonicalOnly" type="checkbox" class="rounded border-gray-300" />
              Canonical only
            </label>
            <button (click)="reloadFromStart()" [disabled]="loading()" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {{ loading() ? 'Loading…' : 'Apply' }}
            </button>
          </div>
        </div>
      </section>

      <section class="max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        @if (reports().length === 0 && !loading()) {
          <div class="px-4 py-10 text-center text-sm text-gray-500">No Platts reports found for the current filters.</div>
        } @else {
          <div class="space-y-3 p-4 md:hidden">
            @for (report of reports(); track report.id) {
              <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ report.publicationDate | date:'mediumDate' }}</div>
                    <h2 class="mt-1 text-sm font-semibold text-gray-900">{{ report.title }}</h2>
                    <p class="mt-1 break-words text-xs text-gray-500">{{ report.sourceFileName }}</p>
                  </div>
                  <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" [class]="statusClass(report.status)">
                    {{ report.status }}
                  </span>
                </div>

                <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Canonical</dt>
                    <dd class="mt-1 text-gray-700">{{ report.isCanonical ? 'Yes' : 'No' }}</dd>
                  </div>
                  <div>
                    <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Uploaded By</dt>
                    <dd class="mt-1 text-gray-700">{{ report.uploadedByName || 'Unknown' }}</dd>
                  </div>
                  <div class="col-span-2">
                    <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Created</dt>
                    <dd class="mt-1 text-gray-700">{{ report.createdAt | date:'medium' }}</dd>
                  </div>
                </dl>

                @if (report.parseError) {
                  <div class="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{{ report.parseError }}</div>
                }

                <div class="mt-4 flex flex-wrap gap-2">
                  <a [routerLink]="['/resources/platts', report.id]" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Open</a>
                  <button (click)="previewSource(report)" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">PDF</button>
                  <button (click)="reparse(report)" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Reparse</button>
                  @if (auth.isAdmin() && !report.isCanonical && report.status === 'READY') {
                    <button (click)="makeCanonical(report)" class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">Make Canonical</button>
                  }
                </div>
              </article>
            }
          </div>

          <div class="hidden overflow-x-auto md:block">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Publication Date</th>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Title</th>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Canonical</th>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Uploaded By</th>
                <th class="px-4 py-3 text-left font-semibold text-gray-600">Created</th>
                <th class="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (report of reports(); track report.id) {
                <tr class="align-top">
                  <td class="px-4 py-3 text-gray-900">{{ report.publicationDate | date:'mediumDate' }}</td>
                  <td class="px-4 py-3">
                    <div class="font-medium text-gray-900">{{ report.title }}</div>
                    <div class="text-xs text-gray-500">{{ report.sourceFileName }}</div>
                  </td>
                  <td class="px-4 py-3">
                    <span class="rounded-full px-2.5 py-1 text-xs font-semibold"
                      [class]="statusClass(report.status)">
                      {{ report.status }}
                    </span>
                    @if (report.parseError) {
                      <div class="mt-2 max-w-xs text-xs text-red-600">{{ report.parseError }}</div>
                    }
                  </td>
                  <td class="px-4 py-3">
                    @if (report.isCanonical) {
                      <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">Canonical</span>
                    } @else {
                      <span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600">Historical</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-gray-600">{{ report.uploadedByName || 'Unknown' }}</td>
                  <td class="px-4 py-3 text-gray-600">{{ report.createdAt | date:'medium' }}</td>
                  <td class="px-4 py-3 text-right">
                    <div class="flex flex-wrap justify-end gap-2">
                      <a [routerLink]="['/resources/platts', report.id]" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Open</a>
                      <button (click)="previewSource(report)" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">PDF</button>
                      <button (click)="reparse(report)" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Reparse</button>
                      @if (auth.isAdmin() && !report.isCanonical && report.status === 'READY') {
                        <button (click)="makeCanonical(report)" class="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">Make Canonical</button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
            </table>
          </div>
        }

        <div class="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between">
          <div>{{ total() }} report(s)</div>
          <div class="flex items-center justify-between gap-3 sm:justify-start">
            <button (click)="previousPage()" [disabled]="page() <= 1 || loading()" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">Previous</button>
            <span>Page {{ page() }}</span>
            <button (click)="nextPage()" [disabled]="page() * pageSize >= total() || loading()" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">Next</button>
          </div>
        </div>
      </section>
    </div>

    <app-pdf-preview-modal />
  `,
})
export class PlattsReportsPageComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly pollIntervalMs = 3000;

  protected readonly loading = signal(false);
  protected readonly uploading = signal(false);
  protected readonly bulkUploading = signal(false);
  protected readonly reports = signal<PlattsReportDto[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly selectedSingleFile = signal<File | null>(null);
  protected readonly bulkFiles = signal<File[]>([]);

  protected readonly pageSize = 20;
  protected search = '';
  protected fromDate = '';
  protected toDate = '';
  protected statusFilter = '';
  protected canonicalOnly = true;

  async ngOnInit(): Promise<void> {
    await this.loadReports();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected onSingleFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedSingleFile.set(input.files?.[0] ?? null);
  }

  protected onBulkFilesChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.bulkFiles.set(input.files ? Array.from(input.files) : []);
  }

  protected async uploadSingle(): Promise<void> {
    const file = this.selectedSingleFile();
    if (!file) return;

    this.uploading.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('family', 'EUROPEAN_MARKETSCAN');
      const response = await firstValueFrom(
        this.http.post<ApiResponse<CreatePlattsReportResponseDto>>(`${API}/platts/reports`, form),
      );
      if (!response.success || !response.data) {
        throw new Error(response.message ?? 'Upload failed');
      }

      const warningText = response.data.warnings.length > 0 ? ` ${response.data.warnings.join(' ')}` : '';
      this.notice.set(`Uploaded ${file.name}. Parsing has started asynchronously.${warningText}`);
      this.selectedSingleFile.set(null);
      this.page.set(1);
      this.upsertReport(response.data.report);
      this.schedulePolling();
      await this.loadReports();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to upload report'));
    } finally {
      this.uploading.set(false);
    }
  }

  protected async uploadBulk(): Promise<void> {
    const files = this.bulkFiles();
    if (files.length === 0) return;

    this.bulkUploading.set(true);
    this.error.set(null);
    this.notice.set(null);
    const batchId = crypto.randomUUID();
    let successCount = 0;
    let failureCount = 0;

    for (const file of files) {
      try {
        const form = new FormData();
        form.set('file', file);
        form.set('family', 'EUROPEAN_MARKETSCAN');
        form.set('importMode', 'bulk');
        form.set('importBatchId', batchId);
        const response = await firstValueFrom(
          this.http.post<ApiResponse<CreatePlattsReportResponseDto>>(`${API}/platts/reports`, form),
        );
        if (!response.success) throw new Error(response.message ?? 'Bulk import failed');
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    this.notice.set(`Bulk import finished. ${successCount} uploaded, ${failureCount} failed. Parsing continues in the background.`);
    this.bulkFiles.set([]);
    this.page.set(1);
    if (successCount > 0) this.schedulePolling();
    await this.loadReports();
    this.bulkUploading.set(false);
  }

  protected async reloadFromStart(): Promise<void> {
    this.page.set(1);
    await this.loadReports();
  }

  protected async previousPage(): Promise<void> {
    if (this.page() <= 1) return;
    this.page.update((value) => value - 1);
    await this.loadReports();
  }

  protected async nextPage(): Promise<void> {
    if (this.page() * this.pageSize >= this.total()) return;
    this.page.update((value) => value + 1);
    await this.loadReports();
  }

  protected async reparse(report: PlattsReportDto): Promise<void> {
    this.error.set(null);
    this.notice.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<PlattsReportDto>>(`${API}/platts/reports/${report.id}/reparse`, {}),
      );
      if (!response.success) throw new Error(response.message ?? 'Failed to request reparse');
      this.notice.set(`Reparse requested for ${report.sourceFileName}. Parsing runs in the background.`);
      this.markReportStatus(report.id, PlattsReportStatus.Parsing);
      this.schedulePolling();
      await this.loadReports({ showLoading: false });
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to request reparse'));
    }
  }

  protected async makeCanonical(report: PlattsReportDto): Promise<void> {
    if (!confirm(`Make ${report.sourceFileName} the canonical report for ${report.publicationDate}?`)) {
      return;
    }

    this.error.set(null);
    this.notice.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<PlattsReportDto>>(`${API}/platts/reports/${report.id}/replace-canonical`, {}),
      );
      if (!response.success) throw new Error(response.message ?? 'Failed to update canonical report');
      this.notice.set(`Canonical report updated for ${report.publicationDate}.`);
      await this.loadReports();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to update canonical report'));
    }
  }

  protected async previewSource(report: PlattsReportDto): Promise<void> {
    const modal = this.pdfModal();
    if (!modal) return;

    modal.showLoading(report.title);
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API}/platts/reports/${report.id}/source`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, report.sourceFileName);
    } catch (error) {
      modal.showError();
      this.error.set(this.describeError(error, 'Failed to load source PDF'));
    }
  }

  protected statusClass(status: string): string {
    switch (status) {
      case 'READY':
        return 'bg-emerald-100 text-emerald-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'PARSING':
        return 'bg-amber-100 text-amber-700';
      case 'SUPERSEDED':
        return 'bg-gray-200 text-gray-700';
      default:
        return 'bg-blue-100 text-blue-700';
    }
  }

  private async loadReports(options: { showLoading?: boolean; isPolling?: boolean } = {}): Promise<void> {
    const showLoading = options.showLoading ?? true;
    const previousStatuses = new Map(this.reports().map((report) => [report.id, report.status]));

    if (showLoading) this.loading.set(true);
    if (!options.isPolling) this.error.set(null);
    try {
      let params = new HttpParams()
        .set('page', String(this.page()))
        .set('pageSize', String(this.pageSize))
        .set('canonicalOnly', String(this.canonicalOnly));

      if (this.search.trim()) params = params.set('search', this.search.trim());
      if (this.fromDate) params = params.set('from', this.fromDate);
      if (this.toDate) params = params.set('to', this.toDate);
      if (this.statusFilter) params = params.set('status', this.statusFilter);

      const response = await firstValueFrom(
        this.http.get<ApiResponse<PaginatedResponse<PlattsReportDto>>>(`${API}/platts/reports`, { params }),
      );
      if (!response.success || !response.data) {
        throw new Error(response.message ?? 'Failed to load reports');
      }

      this.reports.set(response.data.items);
      this.total.set(response.data.total);
      this.syncPollingState(previousStatuses, response.data.items);
    } catch (error) {
      if (!options.isPolling) {
        this.error.set(this.describeError(error, 'Failed to load reports'));
      } else {
        this.schedulePolling();
      }
    } finally {
      if (showLoading) this.loading.set(false);
    }
  }

  private syncPollingState(previousStatuses: Map<string, string>, reports: PlattsReportDto[]): void {
    const hasParsingReports = reports.some((report) => this.isParsingStatus(report.status));
    if (hasParsingReports) {
      this.schedulePolling();
      return;
    }

    this.stopPolling();

    const completedReport = reports.find((report) => {
      const previousStatus = previousStatuses.get(report.id);
      return previousStatus && this.isParsingStatus(previousStatus) && report.status === 'READY';
    });
    if (completedReport) {
      this.notice.set(`Parsing finished for ${completedReport.sourceFileName}.`);
    }

    const failedReport = reports.find((report) => {
      const previousStatus = previousStatuses.get(report.id);
      return previousStatus && this.isParsingStatus(previousStatus) && report.status === 'FAILED';
    });
    if (failedReport?.parseError) {
      this.error.set(failedReport.parseError);
    }
  }

  private schedulePolling(): void {
    if (this.pollTimeoutId != null) return;

    this.pollTimeoutId = setTimeout(() => {
      this.pollTimeoutId = null;
      void this.loadReports({ showLoading: false, isPolling: true });
    }, this.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimeoutId == null) return;
    clearTimeout(this.pollTimeoutId);
    this.pollTimeoutId = null;
  }

  private isParsingStatus(status: string | null | undefined): boolean {
    return status === 'UPLOADED' || status === 'PARSING';
  }

  private markReportStatus(reportId: string, status: PlattsReportStatus): void {
    this.reports.update((reports) => reports.map((report) => (
      report.id === reportId ? { ...report, status } : report
    )));
  }

  private upsertReport(nextReport: PlattsReportDto): void {
    this.reports.update((reports) => {
      const existingIndex = reports.findIndex((report) => report.id === nextReport.id);
      if (existingIndex >= 0) {
        const copy = [...reports];
        copy[existingIndex] = nextReport;
        return copy;
      }
      return [nextReport, ...reports];
    });
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
  }
}