import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  computed,
  output,
  input,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
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
  imports: [FormsModule],
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

              @if (verifyUrl()) {
                <button
                  (click)="copyVerifyUrl()"
                  class="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold
                         text-gray-700 shadow-sm transition-colors hover:bg-gray-50
                         focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                  title="Copy verification URL"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M8 2a2 2 0 0 0-2 2v1H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7.414a2 2 0 0 0-.586-1.414l-3.414-3.414A2 2 0 0 0 10.586 2H8Zm3 3a1 1 0 0 0 1 1h2v6a1 1 0 0 1-1 1h-1V7a2 2 0 0 0-2-2H7V4a1 1 0 0 1 1-1h2.586L11 3.414V5Z" />
                  </svg>
                  {{ verifyCopied() ? 'Copied' : 'Copy Verify URL' }}
                </button>
              }

              <!-- WhatsApp send button -->
              @if (!loading()) {
                @if (!waLinked()) {
                  <!-- Not linked – show WA button that reveals a helpful message -->
                  @if (waNotLinkedMsg()) {
                    <div class="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                      </svg>
                      <span><a href="/account/security" class="font-medium text-amber-900 underline hover:text-amber-950">Link WhatsApp</a> in Settings first</span>
                      <button (click)="waNotLinkedMsg.set(false)" class="ml-1 text-amber-400 hover:text-amber-600">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                        </svg>
                      </button>
                    </div>
                  } @else {
                    <button
                      (click)="waNotLinkedMsg.set(true)"
                      class="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold
                             text-white shadow-sm transition-colors hover:bg-green-700"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                      WhatsApp
                    </button>
                  }
                } @else if (waFormOpen()) {
                  <div class="flex items-center gap-2">
                    <input
                      type="tel"
                      [(ngModel)]="waPhone"
                      placeholder="+45 12345678"
                      class="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                             placeholder:text-gray-400 focus:border-green-500 focus:outline-none
                             focus:ring-2 focus:ring-green-500/20"
                    />
                    <button
                      (click)="sendViaWhatsApp()"
                      [disabled]="waSending() || !waPhone"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold
                             text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      @if (waSending()) {
                        <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                      Send
                    </button>
                    <button
                      (click)="waFormOpen.set(false)"
                      class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                      </svg>
                    </button>
                  </div>
                } @else {
                  <button
                    (click)="openWaForm()"
                    class="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold
                           text-white shadow-sm transition-colors hover:bg-green-700
                           focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                    title="Send via WhatsApp"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    WhatsApp
                  </button>
                }
              }

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

  /** Whether the current user has linked WhatsApp in Settings */
  readonly waLinked = input(false);
  /** Pre-fill phone number from the contact person */
  readonly defaultPhone = input<string | null>(null);

  readonly visible = signal(false);
  readonly loading = signal(false);
  readonly rawBlobUrl = signal<string>('');
  readonly safeBlobUrl = computed<SafeResourceUrl>(() => {
    const url = this.rawBlobUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : '';
  });
  readonly title = signal('');
  readonly fileName = signal('');
  readonly verifyUrl = signal('');
  readonly verifyCopied = signal(false);

  // WhatsApp send
  readonly sendWhatsApp = output<{ phone: string; blob: Blob; fileName: string }>();
  readonly waFormOpen = signal(false);
  readonly waSending = signal(false);
  readonly waNotLinkedMsg = signal(false);
  waPhone = '';

  private currentBlobUrl: string | null = null;
  private currentBlob: Blob | null = null;

  /** Open the modal in loading state while fetching the PDF */
  showLoading(title: string): void {
    this.revokePreviousUrl();
    this.title.set(title);
    this.fileName.set('');
    this.verifyUrl.set('');
    this.verifyCopied.set(false);
    this.rawBlobUrl.set('');
    this.loading.set(true);
    this.visible.set(true);
  }

  /** Set the loaded PDF blob and display it */
  setBlob(blob: Blob, fileName: string, verifyUrl?: string | null): void {
    const url = URL.createObjectURL(blob);
    this.currentBlobUrl = url;
    this.currentBlob = blob;
    this.rawBlobUrl.set(url);
    this.fileName.set(fileName);
    this.verifyUrl.set((verifyUrl ?? '').trim());
    this.verifyCopied.set(false);
    this.loading.set(false);
  }

  async copyVerifyUrl(): Promise<void> {
    const url = this.verifyUrl();
    if (!url) return;

    try {
      await navigator.clipboard.writeText(url);
      this.verifyCopied.set(true);
      setTimeout(() => this.verifyCopied.set(false), 1400);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.verifyCopied.set(true);
      setTimeout(() => this.verifyCopied.set(false), 1400);
    }
  }

  /** Show an error and close the loading state */
  showError(): void {
    this.visible.set(false);
    this.loading.set(false);
    this.revokePreviousUrl();
  }

  /** Open the WhatsApp phone form, pre-filling from contact if available */
  openWaForm(): void {
    this.waPhone = this.defaultPhone() ?? '';
    this.waFormOpen.set(true);
  }

  /** Close the modal */
  close(): void {
    this.visible.set(false);
    this.loading.set(false);
    this.waFormOpen.set(false);
    this.waSending.set(false);
    this.waNotLinkedMsg.set(false);
    this.verifyUrl.set('');
    this.verifyCopied.set(false);
    this.waPhone = '';
    this.revokePreviousUrl();
  }

  /** Emit WhatsApp send with the current blob */
  sendViaWhatsApp(): void {
    if (!this.waPhone || !this.currentBlob) return;
    this.waSending.set(true);
    this.sendWhatsApp.emit({
      phone: this.waPhone,
      blob: this.currentBlob,
      fileName: this.fileName(),
    });
  }

  /** Called by parent after WhatsApp send completes */
  waDone(): void {
    this.waSending.set(false);
    this.waFormOpen.set(false);
    this.waPhone = '';
  }

  private revokePreviousUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
      this.currentBlob = null;
    }
  }
}
