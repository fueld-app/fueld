import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, PublicSupplierNominationDto, SubmitSupplierNominationResponseDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-public-supplier-nomination-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="min-h-screen bg-slate-100 px-4 py-10">
      <div class="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-xl">
        <div class="border-b border-slate-200 px-8 py-6">
          <h1 class="text-2xl font-semibold text-slate-900">Supplier Delivery Confirmation</h1>
          <p class="mt-1 text-sm text-slate-500">Confirm delivery completion, submit the exact delivery time, and upload BDRs without logging in.</p>
        </div>

        @if (loading()) {
          <div class="px-8 py-14 text-center text-sm text-slate-400">Loading delivery confirmation...</div>
        } @else if (loadError()) {
          <div class="px-8 py-14 text-center">
            <p class="text-sm font-medium text-red-600">{{ loadError() }}</p>
          </div>
        } @else if (nomination()) {
          <div class="space-y-6 px-8 py-6">
            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div class="grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                <div>
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Supplier</div>
                  <div class="mt-1 font-medium text-slate-900">{{ nomination()!.supplierName }}</div>
                  @if (nomination()!.contactName) {
                    <div class="mt-1 text-xs text-slate-500">Attention {{ nomination()!.contactName }}</div>
                  }
                </div>
                <div>
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Voyage</div>
                  <div class="mt-1 font-medium text-slate-900">{{ nomination()!.vesselName }} · {{ nomination()!.portName }}</div>
                  @if (nomination()!.eta) {
                    <div class="mt-1 text-xs text-slate-500">ETA {{ formatDate(nomination()!.eta!) }}</div>
                  }
                </div>
              </div>
            </div>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Products</div>
              <div class="mt-3 space-y-2">
                @for (item of nomination()!.items; track item.orderItemId) {
                  <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <div class="font-semibold text-slate-900">{{ item.productType }}</div>
                    <div class="mt-1 text-xs text-slate-500">{{ item.quantity }} {{ item.unit }}@if (item.description) { · {{ item.description }} }</div>
                  </div>
                }
              </div>
            </div>

            <div>
              <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Delivery completed</div>
              <div class="mt-3 flex gap-3">
                <button
                  type="button"
                  (click)="deliveryCompletedConfirmed.set(true)"
                  class="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  [class.bg-emerald-600]="deliveryCompletedConfirmed()"
                  [class.text-white]="deliveryCompletedConfirmed()"
                  [class.bg-slate-100]="!deliveryCompletedConfirmed()"
                  [class.text-slate-600]="!deliveryCompletedConfirmed()"
                >Confirm delivery completed</button>
                <button
                  type="button"
                  (click)="deliveryCompletedConfirmed.set(false)"
                  class="rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  [class.bg-slate-900]="!deliveryCompletedConfirmed()"
                  [class.text-white]="!deliveryCompletedConfirmed()"
                  [class.bg-slate-100]="deliveryCompletedConfirmed()"
                  [class.text-slate-600]="deliveryCompletedConfirmed()"
                >Not ready yet</button>
              </div>
            </div>

            @if (deliveryCompletedConfirmed()) {
              <div class="grid gap-4 md:grid-cols-2">
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Exact delivery time</label>
                  <input
                    type="datetime-local"
                    [ngModel]="deliveryCompletedAt()"
                    (ngModelChange)="deliveryCompletedAt.set($event)"
                    class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Supplier reference</label>
                  <input
                    type="text"
                    [ngModel]="supplierReference()"
                    (ngModelChange)="supplierReference.set($event)"
                    class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Delivery receipt or supplier reference"
                  />
                </div>
                <div class="md:col-span-2">
                  <label class="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Comment</label>
                  <textarea
                    rows="3"
                    [ngModel]="supplierComment()"
                    (ngModelChange)="supplierComment.set($event)"
                    class="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Optional delivery comment"
                  ></textarea>
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">BDR uploads</div>
                    <div class="mt-1 text-sm text-slate-600">Upload one or more BDR files. You can resubmit until the nomination link expires.</div>
                  </div>
                  <label class="inline-flex cursor-pointer items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-300 hover:text-brand-700">
                    <input type="file" multiple accept=".pdf,image/*" class="hidden" (change)="onFilesSelected($event)" />
                    Choose files
                  </label>
                </div>

                @if (selectedFiles().length > 0) {
                  <div class="mt-4 space-y-2">
                    @for (file of selectedFiles(); track file.name + '-' + file.size) {
                      <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{{ file.name }} <span class="text-xs text-slate-400">({{ formatFileSize(file.size) }})</span></div>
                    }
                  </div>
                  <div class="mt-4 flex justify-end">
                    <button
                      type="button"
                      (click)="uploadSelectedFiles()"
                      [disabled]="uploadingFiles()"
                      class="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >{{ uploadingFiles() ? 'Uploading...' : 'Upload selected files' }}</button>
                  </div>
                }

                @if (uploadError()) {
                  <div class="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ uploadError() }}</div>
                }

                <div class="mt-4">
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Uploaded BDRs</div>
                  @if (nomination()!.attachments.length === 0) {
                    <div class="mt-2 text-sm text-slate-400">No BDRs uploaded yet.</div>
                  } @else {
                    <div class="mt-2 space-y-2">
                      @for (attachment of nomination()!.attachments; track attachment.id) {
                        <div class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <div class="font-medium text-slate-900">{{ attachment.fileName }}</div>
                          <div class="mt-1 text-xs text-slate-500">{{ formatDateTime(attachment.createdAt) }} · {{ formatFileSize(attachment.fileSize) }}</div>
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }

            @if (submitError()) {
              <div class="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ submitError() }}</div>
            }
            @if (submitSuccess()) {
              <div class="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">Delivery confirmation submitted successfully.</div>
            }

            <div class="flex justify-end">
              <button
                type="button"
                (click)="submit()"
                [disabled]="submitting() || !canSubmit()"
                class="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >{{ submitting() ? 'Submitting...' : 'Submit delivery confirmation' }}</button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class PublicSupplierNominationPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly token = signal(this.route.snapshot.paramMap.get('token') ?? '');
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly nomination = signal<PublicSupplierNominationDto | null>(null);
  readonly deliveryCompletedConfirmed = signal(false);
  readonly deliveryCompletedAt = signal('');
  readonly supplierReference = signal('');
  readonly supplierComment = signal('');
  readonly selectedFiles = signal<File[]>([]);
  readonly uploadingFiles = signal(false);
  readonly uploadError = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal('');
  readonly submitSuccess = signal(false);
  readonly canSubmit = computed(() =>
    this.deliveryCompletedConfirmed() && this.deliveryCompletedAt().trim().length > 0,
  );

  constructor() {
    void this.load();
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatDateTime(value: string): string {
    return new Date(value).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatFileSize(size: number): string {
    if (!size) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, index);
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.selectedFiles.set(input?.files ? Array.from(input.files) : []);
    this.uploadError.set('');
  }

  async uploadSelectedFiles(): Promise<void> {
    const token = this.token();
    const files = this.selectedFiles();
    if (!token || files.length === 0) return;

    this.uploadingFiles.set(true);
    this.uploadError.set('');
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        const res = await firstValueFrom(
          this.http.post<ApiResponse<unknown>>(`${API}/supplier-nominations/${token}/attachments`, form),
        );
        if (!res.success) {
          throw new Error(res.message ?? `Failed to upload ${file.name}`);
        }
      }
      this.selectedFiles.set([]);
      await this.load();
    } catch (error: any) {
      this.uploadError.set(error?.message ?? 'Failed to upload attachments');
    } finally {
      this.uploadingFiles.set(false);
    }
  }

  async submit(): Promise<void> {
    const token = this.token();
    if (!token) return;

    this.submitting.set(true);
    this.submitError.set('');
    this.submitSuccess.set(false);

    const payload: SubmitSupplierNominationResponseDto = {
      deliveryCompletedConfirmed: this.deliveryCompletedConfirmed(),
      deliveryCompletedAt: this.toIsoFromDateTimeLocal(this.deliveryCompletedAt()) ?? '',
      supplierReference: this.supplierReference().trim() || null,
      supplierComment: this.supplierComment().trim() || null,
    };

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ submitted: boolean }>>(`${API}/supplier-nominations/${token}/respond`, payload),
      );
      if (res.success) {
        this.submitSuccess.set(true);
        await this.load();
      } else {
        this.submitError.set(res.message ?? 'Failed to submit delivery confirmation');
      }
    } catch {
      this.submitError.set('Failed to submit delivery confirmation');
    } finally {
      this.submitting.set(false);
    }
  }

  private async load(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.loading.set(false);
      this.loadError.set('Supplier nomination link is missing');
      return;
    }

    this.loading.set(true);
    this.loadError.set('');
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PublicSupplierNominationDto>>(`${API}/supplier-nominations/${token}`),
      );
      if (res.success && res.data) {
        this.nomination.set(res.data);
        this.deliveryCompletedConfirmed.set(res.data.deliveryCompletedConfirmed);
        this.deliveryCompletedAt.set(this.toDateTimeLocal(res.data.deliveryCompletedAt ?? ''));
        this.supplierReference.set(res.data.supplierReference ?? '');
        this.supplierComment.set(res.data.supplierComment ?? '');
      } else {
        this.loadError.set(res.message ?? 'Supplier nomination link is invalid or expired');
      }
    } catch {
      this.loadError.set('Supplier nomination link is invalid or expired');
    } finally {
      this.loading.set(false);
    }
  }

  private toDateTimeLocal(value: string): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoFromDateTimeLocal(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}