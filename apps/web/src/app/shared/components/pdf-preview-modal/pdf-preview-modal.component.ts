import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  computed,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';

// ═══════════════════════════════════════════════════════════════════════
//  PDF Preview Modal
//
//  Shows a PDF in an iframe overlay with a download button.
//  Usage:
//    @ViewChild(PdfPreviewModalComponent) pdfModal!: PdfPreviewModalComponent;
//    pdfModal.show(blobUrl, title, fileName);
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-pdf-preview-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        (click)="close()"
      >
        <!-- Modal panel -->
        <div
          class="relative flex h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">{{ title() }}</h2>
            <div class="flex items-center gap-3">
              <!-- Download button -->
              <a
                [href]="rawBlobUrl()"
                [download]="fileName()"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                       text-white shadow-sm transition-colors hover:bg-brand-700
                       focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                  <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                </svg>
                Download
              </a>
              <!-- Close button -->
              <button
                (click)="close()"
                class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600
                       focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>
          </div>

          <!-- PDF iframe -->
          <div class="flex-1 overflow-hidden rounded-b-2xl bg-gray-100 p-2">
            @if (loading()) {
              <div class="flex h-full items-center justify-center">
                <div class="flex flex-col items-center gap-3">
                  <svg class="h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <span class="text-sm text-gray-500">Generating PDF…</span>
                </div>
              </div>
            } @else {
              <iframe
                [src]="safeBlobUrl()"
                class="h-full w-full rounded-lg border-0"
                title="PDF Preview"
              ></iframe>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class PdfPreviewModalComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly visible = signal(false);
  readonly loading = signal(false);
  readonly rawBlobUrl = signal<string>('');
  readonly safeBlobUrl = computed<SafeResourceUrl>(() => {
    const url = this.rawBlobUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : '';
  });
  readonly title = signal('');
  readonly fileName = signal('');

  private currentBlobUrl: string | null = null;

  /** Open the modal in loading state while fetching the PDF */
  showLoading(title: string): void {
    this.revokePreviousUrl();
    this.title.set(title);
    this.fileName.set('');
    this.rawBlobUrl.set('');
    this.loading.set(true);
    this.visible.set(true);
  }

  /** Set the loaded PDF blob and display it */
  setBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    this.currentBlobUrl = url;
    this.rawBlobUrl.set(url);
    this.fileName.set(fileName);
    this.loading.set(false);
  }

  /** Show an error and close the loading state */
  showError(): void {
    this.visible.set(false);
    this.loading.set(false);
    this.revokePreviousUrl();
  }

  /** Close the modal */
  close(): void {
    this.visible.set(false);
    this.loading.set(false);
    this.revokePreviousUrl();
  }

  private revokePreviousUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }
}
