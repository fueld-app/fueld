import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal, viewChild } from '@angular/core';
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
    <div class="space-y-6 pb-2 min-w-0">
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
        <div class="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">Loading report…</div>
      }

      @if (report(); as currentReport) {
        <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.status }}</div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Canonical</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.isCanonical ? 'Yes' : 'No' }}</div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Uploaded By</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.uploadedByName || 'Unknown' }}</div>
          </div>
          <div class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="text-xs font-semibold uppercase tracking-wide text-gray-500">Parsed At</div>
            <div class="mt-2 text-lg font-semibold text-gray-900">{{ currentReport.parsedAt ? (currentReport.parsedAt | date:'medium') : 'Pending' }}</div>
          </div>
        </section>

        <section class="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 class="text-lg font-semibold text-gray-900">Commentary</h2>
            @if (currentReport.commentary.length === 0) {
              <p class="mt-3 text-sm text-gray-500">No commentary was extracted.</p>
            }
            <div class="mt-4 max-h-[30rem] space-y-3 overflow-y-auto pr-2">
              @for (paragraph of currentReport.commentary; track paragraph) {
                <p class="text-sm leading-6 text-gray-700">{{ paragraph }}</p>
              }
            </div>
          </div>

          <div class="min-w-0 space-y-6">
            <section class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
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

            <section class="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
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
          @for (section of getVisibleSections(currentReport); track section.id) {
            <div class="max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div class="border-b border-gray-200 px-5 py-4">
                <h2 class="text-lg font-semibold text-gray-900">{{ section.heading }}</h2>
                <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ section.type }}</p>
              </div>

              <div class="overflow-x-auto">
                @if (getSectionDisplayMode(section) === 'assessment') {
                  <div class="space-y-3 p-4 md:hidden">
                    @for (entry of getVisibleAssessmentEntries(section); track entry.id) {
                      @if (getAssessmentMetadata(entry); as assessment) {
                        <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <h3 class="text-sm font-semibold text-gray-900">{{ assessment.product || '—' }}</h3>
                              <p class="mt-1 text-xs text-gray-500">{{ assessment.basisHeader || entry.marketBasis || '—' }}</p>
                            </div>
                            <span class="shrink-0 rounded-full bg-white px-2 py-1 font-mono text-[11px] text-gray-600 ring-1 ring-gray-200">{{ assessment.code || '—' }}</span>
                          </div>
                          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Range</dt>
                              <dd class="mt-1 text-gray-700">{{ assessment.rangeText || '—' }}</dd>
                            </div>
                            <div>
                              <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mid</dt>
                              <dd class="mt-1 text-gray-700">{{ assessment.mid || '—' }}</dd>
                            </div>
                            <div class="col-span-2">
                              <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Change</dt>
                              <dd class="mt-1 text-gray-700">{{ assessment.change || '—' }}</dd>
                            </div>
                          </dl>
                        </article>
                      }
                    }
                  </div>
                  <table class="hidden min-w-full divide-y divide-gray-200 text-sm md:table">
                    <thead class="bg-gray-50">
                      <tr>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Product</th>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Basis</th>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Code</th>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Range</th>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Mid</th>
                        <th class="px-4 py-3 text-left font-semibold text-gray-600">Change</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                      @for (entry of getVisibleAssessmentEntries(section); track entry.id) {
                        @if (getAssessmentMetadata(entry); as assessment) {
                          <tr>
                            <td class="px-4 py-3 text-gray-700">{{ assessment.product || '—' }}</td>
                            <td class="px-4 py-3 text-gray-700">{{ assessment.basisHeader || entry.marketBasis || '—' }}</td>
                            <td class="px-4 py-3 font-mono text-gray-700">{{ assessment.code || '—' }}</td>
                            <td class="px-4 py-3 text-gray-700">{{ assessment.rangeText || '—' }}</td>
                            <td class="px-4 py-3 text-gray-700">{{ assessment.mid || '—' }}</td>
                            <td class="px-4 py-3 text-gray-700">{{ assessment.change || '—' }}</td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                } @else if (getSectionDisplayMode(section) === 'delivery-basis') {
                  <div class="space-y-3 p-4 md:hidden">
                    @for (entry of getVisibleDeliveryBasisEntries(section); track entry.id) {
                      @if (getDeliveryBasisMetadata(entry); as deliveryBasis) {
                        <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                          <div class="flex items-start justify-between gap-3">
                            <div class="min-w-0">
                              <h3 class="text-sm font-semibold text-gray-900">{{ deliveryBasis.product || '—' }}</h3>
                              <p class="mt-1 break-words text-sm text-gray-700">{{ deliveryBasis.deliveryBasis || '—' }}</p>
                            </div>
                            <span class="shrink-0 rounded-full bg-white px-2 py-1 font-mono text-[11px] text-gray-600 ring-1 ring-gray-200">{{ deliveryBasis.code || '—' }}</span>
                          </div>
                        </article>
                      }
                    }
                  </div>
                  <table class="hidden min-w-full divide-y divide-gray-200 text-sm md:table">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Product</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Code</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Delivery Basis</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (entry of getVisibleDeliveryBasisEntries(section); track entry.id) {
                      @if (getDeliveryBasisMetadata(entry); as deliveryBasis) {
                        <tr>
                          <td class="px-4 py-3 text-gray-700">{{ deliveryBasis.product || '—' }}</td>
                          <td class="px-4 py-3 font-mono text-gray-700">{{ deliveryBasis.code || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ deliveryBasis.deliveryBasis || '—' }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
                } @else if (getSectionDisplayMode(section) === 'market-data') {
                <div class="space-y-3 p-4 md:hidden">
                  @for (entry of getVisibleMarketDataEntries(section); track entry.id) {
                    @if (getMarketDataMetadata(entry); as marketData) {
                      <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <h3 class="text-sm font-semibold text-gray-900">{{ marketData.marketContext || entry.instrument || entry.windowLabel || entry.marketBasis || '—' }}</h3>
                            <p class="mt-1 text-xs text-gray-500">{{ entry.company || '—' }} · {{ entry.action || '—' }}</p>
                          </div>
                          <span class="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">{{ marketData.statusText || '—' }}</span>
                        </div>
                        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Counterparty</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.counterparty || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Time</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.timestampText || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Price</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.priceRaw || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quantity</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.quantityRaw || '—' }}</dd>
                          </div>
                        </dl>
                      </article>
                    }
                  }
                </div>
                <table class="hidden min-w-full divide-y divide-gray-200 text-sm md:table">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Context</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Participant</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Action</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Counterparty</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Price</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Quantity</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (entry of getVisibleMarketDataEntries(section); track entry.id) {
                      @if (getMarketDataMetadata(entry); as marketData) {
                        <tr>
                          <td class="px-4 py-3 text-gray-700">{{ marketData.marketContext || entry.instrument || entry.windowLabel || entry.marketBasis || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.company || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.action || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.counterparty || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.priceRaw || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.quantityRaw || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.timestampText || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ marketData.statusText || '—' }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
                } @else if (getSectionDisplayMode(section) === 'moc') {
                <div class="space-y-3 p-4 md:hidden">
                  @for (entry of getVisibleMocEntries(section); track entry.id) {
                    @if (getMocMetadata(entry); as moc) {
                      <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div class="flex items-start justify-between gap-3">
                          <div class="min-w-0">
                            <h3 class="text-sm font-semibold text-gray-900">{{ entry.marketBasis || entry.marketRegion || '—' }}</h3>
                            <p class="mt-1 text-xs text-gray-500">{{ entry.company || '—' }} · {{ entry.action || '—' }}</p>
                          </div>
                          <span class="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">{{ moc.statusText || '—' }}</span>
                        </div>
                        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Counterparty</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.counterparty || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Time</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.timestampText || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Price</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.priceRaw || '—' }}</dd>
                          </div>
                          <div>
                            <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quantity</dt>
                            <dd class="mt-1 text-gray-700">{{ entry.quantityRaw || '—' }}</dd>
                          </div>
                        </dl>
                      </article>
                    }
                  }
                </div>
                <table class="hidden min-w-full divide-y divide-gray-200 text-sm md:table">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Basis</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Participant</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Action</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Counterparty</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Price</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Quantity</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (entry of getVisibleMocEntries(section); track entry.id) {
                      @if (getMocMetadata(entry); as moc) {
                        <tr>
                          <td class="px-4 py-3 text-gray-700">{{ entry.marketBasis || entry.marketRegion || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.company || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.action || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.counterparty || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.priceRaw || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.quantityRaw || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ entry.timestampText || '—' }}</td>
                          <td class="px-4 py-3 text-gray-700">{{ moc.statusText || '—' }}</td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
                } @else {
                <div class="space-y-3 p-4 md:hidden">
                  @for (entry of getVisibleStructuredEntries(section); track entry.id) {
                    <article class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <h3 class="text-sm font-semibold text-gray-900">{{ entry.company || '—' }}</h3>
                          <p class="mt-1 text-xs text-gray-500">{{ entry.action || '—' }} · {{ entry.marketRegion || entry.marketBasis || '—' }}</p>
                        </div>
                        <span class="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-600 ring-1 ring-gray-200">{{ getEntryStatus(entry) || '—' }}</span>
                      </div>
                      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Counterparty</dt>
                          <dd class="mt-1 text-gray-700">{{ entry.counterparty || '—' }}</dd>
                        </div>
                        <div>
                          <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Time</dt>
                          <dd class="mt-1 text-gray-700">{{ entry.timestampText || '—' }}</dd>
                        </div>
                        <div>
                          <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Price</dt>
                          <dd class="mt-1 text-gray-700">{{ entry.priceRaw || '—' }}</dd>
                        </div>
                        <div>
                          <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Quantity</dt>
                          <dd class="mt-1 text-gray-700">{{ entry.quantityRaw || '—' }}</dd>
                        </div>
                        <div class="col-span-2">
                          <dt class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Instrument</dt>
                          <dd class="mt-1 text-gray-700">{{ entry.instrument || entry.windowLabel || '—' }}</dd>
                        </div>
                      </dl>
                    </article>
                  }
                </div>
                <table class="hidden min-w-full divide-y divide-gray-200 text-sm md:table">
                  <thead class="bg-gray-50">
                    <tr>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Company</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Action</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Counterparty</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Price</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Quantity</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Market</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Instrument</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Time</th>
                      <th class="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-100">
                    @for (entry of getVisibleStructuredEntries(section); track entry.id) {
                      <tr>
                        <td class="px-4 py-3 text-gray-700">{{ entry.company || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.action || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.counterparty || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.priceRaw || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.quantityRaw || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.marketRegion || entry.marketBasis || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.instrument || entry.windowLabel || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ entry.timestampText || '—' }}</td>
                        <td class="px-4 py-3 text-gray-700">{{ getEntryStatus(entry) || '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
                }
              </div>
            </div>
          }
        </section>
      }
    </div>

    <app-pdf-preview-modal />
  `,
})
export class PlattsReportDetailPageComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly pdfModal = viewChild(PdfPreviewModalComponent);
  private pollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly pollIntervalMs = 3000;

  protected readonly loading = signal(false);
  protected readonly report = signal<PlattsReportDetailDto | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected getSectionDisplayMode(section: PlattsReportDetailDto['sections'][number]): 'assessment' | 'delivery-basis' | 'market-data' | 'moc' | 'structured' {
    if (section.entries.some((entry) => this.getAssessmentMetadata(entry) !== null)) return 'assessment';
    if (section.entries.some((entry) => this.getDeliveryBasisMetadata(entry) !== null)) return 'delivery-basis';
    if (section.entries.some((entry) => this.getMarketDataMetadata(entry) !== null)) return 'market-data';
    if (section.entries.some((entry) => this.getMocMetadata(entry) !== null)) return 'moc';
    return 'structured';
  }

  protected getVisibleSections(report: PlattsReportDetailDto): PlattsReportDetailDto['sections'] {
    return report.sections.filter((section) => this.hasVisibleSectionContent(section));
  }

  protected getVisibleAssessmentEntries(section: PlattsReportDetailDto['sections'][number]): PlattsReportDetailDto['sections'][number]['entries'] {
    return section.entries.filter((entry) => this.getAssessmentMetadata(entry) !== null);
  }

  protected getVisibleDeliveryBasisEntries(section: PlattsReportDetailDto['sections'][number]): PlattsReportDetailDto['sections'][number]['entries'] {
    return section.entries.filter((entry) => this.getDeliveryBasisMetadata(entry) !== null);
  }

  protected getVisibleMarketDataEntries(section: PlattsReportDetailDto['sections'][number]): PlattsReportDetailDto['sections'][number]['entries'] {
    return section.entries.filter((entry) => this.isActionableMarketDataEntry(entry));
  }

  protected getVisibleMocEntries(section: PlattsReportDetailDto['sections'][number]): PlattsReportDetailDto['sections'][number]['entries'] {
    return section.entries.filter((entry) => this.isActionableMocEntry(entry));
  }

  protected getVisibleStructuredEntries(section: PlattsReportDetailDto['sections'][number]): PlattsReportDetailDto['sections'][number]['entries'] {
    return section.entries.filter((entry) => this.isActionableStructuredEntry(entry));
  }

  protected getAssessmentMetadata(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): AssessmentMetadata | null {
    const metadata = entry.metadata;
    if (!metadata || metadata['rowKind'] !== 'assessment') return null;

    return {
      product: typeof metadata['product'] === 'string' ? metadata['product'] : null,
      code: typeof metadata['code'] === 'string' ? metadata['code'] : null,
      rangeText: typeof metadata['rangeText'] === 'string' ? metadata['rangeText'] : null,
      mid: typeof metadata['mid'] === 'string' ? metadata['mid'] : null,
      change: typeof metadata['change'] === 'string' ? metadata['change'] : null,
      basisHeader: typeof metadata['basisHeader'] === 'string' ? metadata['basisHeader'] : null,
    };
  }

  protected getDeliveryBasisMetadata(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): DeliveryBasisMetadata | null {
    const metadata = entry.metadata;
    if (!metadata || metadata['rowKind'] !== 'delivery-basis') return null;

    return {
      product: typeof metadata['product'] === 'string' ? metadata['product'] : entry.product,
      code: typeof metadata['code'] === 'string' ? metadata['code'] : null,
      deliveryBasis: typeof metadata['deliveryBasis'] === 'string' ? metadata['deliveryBasis'] : null,
    };
  }

  protected getMarketDataMetadata(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): MarketDataMetadata | null {
    const metadata = entry.metadata;
    if (!metadata || metadata['rowKind'] !== 'market-data') return null;

    return {
      marketContext: typeof metadata['marketContext'] === 'string' ? metadata['marketContext'] : null,
      statusText: typeof metadata['statusText'] === 'string' ? metadata['statusText'] : null,
    };
  }

  protected getMocMetadata(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): MocMetadata | null {
    const metadata = entry.metadata;
    if (!metadata || metadata['rowKind'] !== 'moc') return null;

    return {
      statusText: typeof metadata['statusText'] === 'string' ? metadata['statusText'] : null,
    };
  }

  protected getEntryStatus(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): string | null {
    if (/^NO\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+REPORTED$/i.test(entry.rawText)) {
      return entry.rawText;
    }
    if (!entry.company && !entry.action && !entry.counterparty && !entry.priceRaw && !entry.quantityRaw) {
      return entry.rawText;
    }
    return null;
  }

  private hasVisibleSectionContent(section: PlattsReportDetailDto['sections'][number]): boolean {
    const mode = this.getSectionDisplayMode(section);

    if (mode === 'assessment') {
      return section.entries.some((entry) => this.getAssessmentMetadata(entry) !== null);
    }

    if (mode === 'delivery-basis') {
      return section.entries.some((entry) => this.getDeliveryBasisMetadata(entry) !== null);
    }

    if (mode === 'market-data') {
      return section.entries.some((entry) => this.isActionableMarketDataEntry(entry));
    }

    if (mode === 'moc') {
      return section.entries.some((entry) => this.isActionableMocEntry(entry));
    }

    return section.entries.some((entry) => this.isActionableStructuredEntry(entry));
  }

  private isActionableMarketDataEntry(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): boolean {
    return this.getMarketDataMetadata(entry) !== null
      && Boolean(entry.company || entry.action || entry.counterparty || entry.priceRaw || entry.quantityRaw || entry.timestampText);
  }

  private isActionableMocEntry(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): boolean {
    return this.getMocMetadata(entry) !== null
      && Boolean(entry.company || entry.action || entry.counterparty || entry.priceRaw || entry.quantityRaw || entry.timestampText);
  }

  private isActionableStructuredEntry(entry: PlattsReportDetailDto['sections'][number]['entries'][number]): boolean {
    return Boolean(
      entry.company
      || entry.action
      || entry.counterparty
      || entry.priceRaw
      || entry.quantityRaw
      || entry.marketRegion
      || entry.marketBasis
      || entry.instrument
      || entry.windowLabel
      || entry.timestampText,
    );
  }

  async ngOnInit(): Promise<void> {
    await this.loadReport();
  }

  ngOnDestroy(): void {
    this.stopPolling();
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
      if (!response.success) throw new Error(response.message ?? 'Failed to request reparse');
      this.notice.set('Reparse requested. Parsing runs in the background.');
      await this.loadReport({ showLoading: false });
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to request reparse'));
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

  private async loadReport(options: { showLoading?: boolean; isPolling?: boolean } = {}): Promise<void> {
    const reportId = this.route.snapshot.paramMap.get('id');
    if (!reportId) {
      this.error.set('Missing report id');
      return;
    }

    const showLoading = options.showLoading ?? true;
    const previousStatus = this.report()?.status ?? null;

    if (showLoading) this.loading.set(true);
    if (!options.isPolling) this.error.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<PlattsReportDetailDto>>(`${API}/platts/reports/${reportId}`),
      );
      if (!response.success || !response.data) {
        throw new Error(response.message ?? 'Failed to load report');
      }

      this.report.set(response.data);
      this.syncPollingState(previousStatus, response.data);
    } catch (error) {
      if (!options.isPolling) {
        this.error.set(this.describeError(error, 'Failed to load report'));
      } else {
        this.schedulePolling();
      }
    } finally {
      if (showLoading) this.loading.set(false);
    }
  }

  private syncPollingState(previousStatus: string | null, report: PlattsReportDetailDto): void {
    if (this.isParsingStatus(report.status)) {
      this.schedulePolling();
      return;
    }

    this.stopPolling();

    if (previousStatus && this.isParsingStatus(previousStatus) && report.status === 'READY') {
      this.notice.set('Parsing finished. Report updated automatically.');
    }

    if (previousStatus && this.isParsingStatus(previousStatus) && report.status === 'FAILED') {
      this.error.set(report.parseError || 'Parsing failed.');
    }
  }

  private schedulePolling(): void {
    if (this.pollTimeoutId != null) return;

    this.pollTimeoutId = setTimeout(() => {
      this.pollTimeoutId = null;
      void this.loadReport({ showLoading: false, isPolling: true });
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

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
  }
}

interface AssessmentMetadata {
  product: string | null;
  code: string | null;
  rangeText: string | null;
  mid: string | null;
  change: string | null;
  basisHeader: string | null;
}

interface DeliveryBasisMetadata {
  product: string | null;
  code: string | null;
  deliveryBasis: string | null;
}

interface MarketDataMetadata {
  marketContext: string | null;
  statusText: string | null;
}

interface MocMetadata {
  statusText: string | null;
}