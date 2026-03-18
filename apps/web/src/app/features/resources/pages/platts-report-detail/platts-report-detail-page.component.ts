import { ChangeDetectionStrategy, Component, OnInit, inject, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PlattsReportDetailDto, PlattsReportDto } from '@fueld/types';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { PdfPreviewModalComponent } from '@app/shared/components/pdf-preview-modal/pdf-preview-modal.component';

@Component({
  selector: 'app-platts-report-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe, TitleCasePipe, PdfPreviewModalComponent],
  template: `
    <div class="space-y-6 p-6">
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <a routerLink="/resources/platts" class="text-sm font-medium text-brand-700 hover:text-brand-800">← Back to Platts archive</a>
          <h1 class="mt-2 text-2xl font-bold text-gray-900">{{ report()?.title || 'Platts report' }}</h1>
          @if (report(); as currentReport) {
            <p class="text-sm text-gray-500">{{ currentReport.publicationDate | date:'fullDate' }} · {{ currentReport.sourceFileName }}</p>
          }
        </div>
        @if (report(); as currentReport) {
          <div class="flex flex-wrap gap-2">
            <button (click)="previewSource()" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">View Source PDF</button>
            <button (click)="reparse()" class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Reparse</button>
            @if (auth.isAdmin() && !currentReport.isCanonical && currentReport.status === 'READY') {
              <button (click)="makeCanonical()" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Make Canonical</button>
            }
          </div>
        }
      </div>

      @if (error()) {
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ error() }}</div>
      }

      @if (notice()) {
        <div class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{{ notice() }}</div>
      }

      @if (loading()) {
        <div class="rounded-2xl border border-gray-200 bg-white p-8 text-sm text-gray-500 shadow-sm">Loading report…</div>
      }

      @if (report(); as currentReport) {
        <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.status }}</div>
          </div>
          <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Canonical</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.isCanonical ? 'Yes' : 'No' }}</div>
          </div>
          <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded By</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.uploadedByName || 'Unknown' }}</div>
          </div>
          <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Parsed At</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.parsedAt ? (currentReport.parsedAt | date:'medium') : 'Pending' }}</div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900">Commentary</h2>
            @if (currentReport.commentary.length === 0) {
              <p class="mt-3 text-sm text-gray-500">No commentary was extracted.</p>
            }
            <div class="mt-4 space-y-3">
              @for (paragraph of currentReport.commentary; track paragraph) {
                <p class="text-sm leading-6 text-gray-700">{{ paragraph }}</p>
              }
            </div>
          </div>

          <div class="space-y-6">
            <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 class="text-lg font-semibold text-gray-900">Import History</h2>
              <div class="mt-4 space-y-3">
                @for (item of currentReport.imports; track item.id) {
                  <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                    <div class="font-medium text-gray-900">{{ item.importMode | titlecase }}</div>
                    <div class="mt-1 text-xs text-gray-500">{{ item.createdAt | date:'medium' }}</div>
                    <div class="mt-2 break-all font-mono text-xs text-gray-500">{{ item.sha256Hex }}</div>
                  </div>
                }
              </div>
            </section>

            <section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 class="text-lg font-semibold text-gray-900">Source</h2>
              <dl class="mt-4 space-y-2 text-sm text-gray-700">
                <div><dt class="text-gray-500">File</dt><dd>{{ currentReport.sourceFileName }}</dd></div>
                <div><dt class="text-gray-500">Size</dt><dd>{{ currentReport.sourceFileSize | number }} bytes</dd></div>
                <div><dt class="text-gray-500">Parser Version</dt><dd>{{ currentReport.parserVersion || 'N/A' }}</dd></div>
              </dl>
            </section>
          </div>
        </section>

        <section class="space-y-4">
          @for (section of currentReport.sections; track section.id) {
            <div class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-200 px-6 py-4">
                <h2 class="text-lg font-semibold text-gray-900">{{ section.heading }}</h2>
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ section.type }}</p>
              </div>

              <div class="overflow-x-auto">
                <table class="min-w-full divide-y divide-gray-200 text-sm">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Raw Text</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Company</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Action</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Counterparty</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Price</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Quantity</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Market</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (entry of section.entries; track entry.id) {
                      <tr>
                        <td class="px-4 py-3 text-gray-700">{{ entry.rawText }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.company || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.action || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.counterparty || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.priceRaw || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.quantityRaw || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.marketRegion || entry.marketBasis || '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </section>
      }
    </div>

    <app-pdf-preview-modal />
  `,
})
export class PlattsReportDetailPageComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);

  protected readonly loading = signal(false);
  protected readonly report = signal<PlattsReportDetailDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.loadReport();
  }

  protected async previewSource(): Promise<void> {
    const currentReport = this.report();
    const modal = this.pdfModal();
    if (!currentReport || !modal) return;

    modal.showLoading(currentReport.title);
    try {
      const blob = await firstValueFrom(
        this.http.get(`${API}/platts/reports/${currentReport.id}/source`, { responseType: 'blob' }),
      );
      modal.setBlob(blob, currentReport.sourceFileName);
    } catch (error) {
      modal.showError();
      this.error.set(this.describeError(error, 'Failed to load source PDF'));
    }
  }

  protected async reparse(): Promise<void> {
    const currentReport = this.report();
    if (!currentReport) return;
    this.error.set(null);
    this.notice.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<PlattsReportDto>>(`${API}/platts/reports/${currentReport.id}/reparse`, {}),
      );
      if (!response.success) throw new Error(response.message ?? 'Failed to queue reparse');
      this.notice.set('Report queued for reparsing.');
      await this.loadReport();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to queue reparse'));
    }
  }

  protected async makeCanonical(): Promise<void> {
    const currentReport = this.report();
    if (!currentReport) return;
    if (!confirm(`Make ${currentReport.sourceFileName} the canonical report for ${currentReport.publicationDate}?`)) {
      return;
    }

    this.error.set(null);
    this.notice.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<PlattsReportDto>>(`${API}/platts/reports/${currentReport.id}/replace-canonical`, {}),
      );
      if (!response.success) throw new Error(response.message ?? 'Failed to replace canonical report');
      this.notice.set('Canonical report updated.');
      await this.loadReport();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to replace canonical report'));
    }
  }

  private async loadReport(): Promise<void> {
    const reportId = this.route.snapshot.paramMap.get('id');
    if (!reportId) {
      this.error.set('Missing report id');
      return;
    }

    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<PlattsReportDetailDto>>(`${API}/platts/reports/${reportId}`),
      );
      if (!response.success || !response.data) {
        throw new Error(response.message ?? 'Failed to load report');
      }
      this.report.set(response.data);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to load report'));
    } finally {
      this.loading.set(false);
    }
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
  }
}