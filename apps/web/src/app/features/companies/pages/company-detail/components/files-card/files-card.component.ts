import {
  Component, ChangeDetectionStrategy, input, signal, inject, ElementRef, viewChild, OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CompanyAttachmentDto } from '@fueld/types';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-files-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-[10]">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-gray-700">Files</h2>
          <p class="mt-0.5 text-xs text-gray-400">Upload PDFs and spreadsheets with operational notes or supplier documentation.</p>
        </div>
      </div>
      <div class="px-5 py-4 space-y-4">
        <div class="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-4">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div class="min-w-0">
              <input
                #fileInput
                type="file"
                (change)="onFileSelected($event)"
                accept=".pdf,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.gif,.webp,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,image/*"
                class="w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-100"
              />
              <p class="mt-2 text-xs text-gray-400">Accepted: PDF, XLS, XLSX, CSV or image files. Max 10 MB.</p>
              @if (selectedFile) { <p class="mt-1 text-xs text-gray-500">Ready to upload: {{ selectedFile!.name }}</p> }
            </div>
            <button type="button"
              (click)="upload()"
              [disabled]="uploading() || !selectedFile"
              class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50">
              {{ uploading() ? 'Uploading...' : 'Upload file' }}
            </button>
          </div>
        </div>

        @if (loading()) {
          <div class="flex items-center justify-center py-6">
            <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (!attachments().length) {
          <div class="rounded-lg border border-gray-100 bg-white px-4 py-6 text-center text-sm text-gray-400">No files uploaded yet</div>
        } @else {
          <div class="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-100 bg-white">
            @for (a of attachments(); track a.id) {
              <div class="flex items-start justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50/70 transition-colors">
                <div class="min-w-0 flex-1">
                  <button type="button" (click)="open(a)"
                    class="truncate max-w-full text-left font-medium text-brand-700 hover:text-brand-900 hover:underline">{{ a.fileName }}</button>
                  <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                    <span>{{ formatFileSize(a.fileSize) }}</span>
                    <span>{{ a.createdAt | date:'mediumDate' }}</span>
                    @if (a.mimeType) { <span>{{ a.mimeType }}</span> }
                  </div>
                </div>
                <button type="button" (click)="confirmDelete(a)"
                  class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete file">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            }
          </div>
        }
      </div>
    </div>

    @if (deleteTarget()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
        <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">Delete file?</h3>
          <p class="mt-2 text-sm text-gray-500">Remove <strong>{{ deleteTarget()!.fileName }}</strong> from this company?</p>
          <div class="mt-4 flex justify-end gap-2">
            <button (click)="deleteTarget.set(null)"
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button (click)="executeDelete()"
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class FilesCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fileInputEl = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly companyId = input.required<string>();

  readonly attachments = signal<CompanyAttachmentDto[]>([]);
  readonly loading = signal(false);
  readonly uploading = signal(false);
  readonly deleteTarget = signal<CompanyAttachmentDto | null>(null);
  selectedFile: File | null = null;

  ngOnInit(): void { this.load(); }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<CompanyAttachmentDto[]>>(`${API}/companies/local/${this.companyId()}/attachments`));
      if (res.success && res.data) this.attachments.set(res.data);
    } catch { /* ignore */ } finally { this.loading.set(false); }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedFile = input.files?.[0] ?? null;
  }

  async upload(): Promise<void> {
    if (!this.selectedFile) return;
    this.uploading.set(true);
    try {
      const fd = new FormData();
      fd.append('file', this.selectedFile);
      const res = await firstValueFrom(this.http.post<ApiResponse<CompanyAttachmentDto>>(`${API}/companies/local/${this.companyId()}/attachments`, fd));
      if (res.success && res.data) {
        this.attachments.update(a => [...a, res.data!]);
        this.selectedFile = null;
        const el = this.fileInputEl();
        if (el) el.nativeElement.value = '';
      }
    } catch (err: any) {
      console.error('Failed to upload file:', err);
    } finally { this.uploading.set(false); }
  }

  open(a: CompanyAttachmentDto): void {
    window.open(`${API}/companies/local/${this.companyId()}/attachments/${a.id}`, '_blank');
  }

  confirmDelete(a: CompanyAttachmentDto): void { this.deleteTarget.set(a); }

  async executeDelete(): Promise<void> {
    const t = this.deleteTarget();
    if (!t) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/companies/local/${this.companyId()}/attachments/${t.id}`));
      this.attachments.update(a => a.filter(x => x.id !== t.id));
      this.deleteTarget.set(null);
    } catch { /* ignore */ }
  }

  formatFileSize(bytes: number): string {
    if (!bytes) return '0 B';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }
}
