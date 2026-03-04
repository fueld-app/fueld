import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

// ═══════════════════════════════════════════════════════════════════════
//  Send Email Modal — Compose & send document emails
// ═══════════════════════════════════════════════════════════════════════
//
// Generic compose modal for sending any document type (offer, nomination,
// proforma, invoice). Pre-fills from/to/cc/subject from the parent, and
// lets the user edit before sending.
// ═══════════════════════════════════════════════════════════════════════

export type DocumentEmailType = 'OFFER' | 'NOMINATION' | 'PROFORMA' | 'INVOICE';

export interface SendEmailPayload {
  documentType: DocumentEmailType;
  recipientEmail: string;
  ccEmails: string[];
  subject: string;
  htmlBody: string;
  /** O365 access token for sending via Microsoft Graph (if available). */
  accessToken?: string;
}

const DOC_LABELS: Record<DocumentEmailType, string> = {
  OFFER: 'Offer / Confirmation',
  NOMINATION: 'Nomination',
  PROFORMA: 'Proforma Invoice',
  INVOICE: 'Invoice',
};

@Component({
  selector: 'app-send-email-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <!-- Modal panel -->
        <div
          class="w-full max-w-2xl rounded-2xl bg-white shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div>
              <h2 id="modal-title" class="text-lg font-semibold text-gray-900">
                Send {{ docLabel() }}
              </h2>
              <p class="text-sm text-gray-500 mt-0.5">Compose email with PDF attachment</p>
            </div>
            <button
              (click)="close()"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="space-y-4 px-6 py-5 max-h-[70vh] overflow-y-auto">
            <!-- From (read-only) -->
            <div>
              <label class="block text-sm font-medium text-gray-500">From</label>
              <div class="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10 12a5.99 5.99 0 0 0-4.793 2.39A6.483 6.483 0 0 0 10 16.5a6.483 6.483 0 0 0 4.793-2.11A5.99 5.99 0 0 0 10 12Z" clip-rule="evenodd" />
                </svg>
                <span class="font-medium">{{ senderName() }}</span>
                <span class="text-gray-400">&lt;{{ senderEmail() }}&gt;</span>
              </div>
            </div>

            <!-- To -->
            <div>
              <label for="email-to" class="block text-sm font-medium text-gray-700">To</label>
              <input
                id="email-to"
                type="email"
                [(ngModel)]="recipientEmail"
                placeholder="recipient@company.com"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                       focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <!-- CC -->
            <div>
              <label for="email-cc" class="block text-sm font-medium text-gray-700">
                CC
                <span class="text-gray-400 font-normal text-xs">(comma-separated)</span>
              </label>
              <input
                id="email-cc"
                type="text"
                [(ngModel)]="ccEmailsRaw"
                placeholder="sales@company.com, colleague@company.com"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                       focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <!-- Subject -->
            <div>
              <label for="email-subject" class="block text-sm font-medium text-gray-700">Subject</label>
              <input
                id="email-subject"
                type="text"
                [(ngModel)]="subject"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                       focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <!-- Email body preview -->
            <div>
              <label class="block text-sm font-medium text-gray-700">Email body</label>
              <div
                class="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 max-h-48 overflow-y-auto"
                [innerHTML]="htmlBody"
              ></div>
            </div>

            <!-- Attachment -->
            <div class="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-500 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z" clip-rule="evenodd" />
              </svg>
              <span class="font-medium">{{ pdfFileName() || 'Document.pdf' }}</span>
              <span class="text-gray-400 text-xs">(auto-generated, attached on send)</span>
            </div>

            <!-- WhatsApp phone -->
            @if (waLinked()) {
              <div>
                <label for="wa-phone" class="block text-sm font-medium text-gray-700">WhatsApp number
                  <span class="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="wa-phone"
                  type="tel"
                  [(ngModel)]="waPhoneNumber"
                  placeholder="+45 12345678"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                         placeholder:text-gray-400 focus:border-green-500 focus:outline-none
                         focus:ring-2 focus:ring-green-500/20"
                />
              </div>
            }
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              (click)="close()"
              class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700
                     shadow-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <!-- Send via WhatsApp -->
            @if (waLinked() && waPhoneNumber) {
              <button
                (click)="doSendWa()"
                [disabled]="waSending()"
                class="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold
                       text-white shadow-sm transition-colors hover:bg-green-700 disabled:opacity-50
                       disabled:cursor-not-allowed"
              >
                @if (waSending()) {
                  <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Sending…
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                }
              </button>
            }
            <!-- Send email -->
            <button
              (click)="doSend()"
              [disabled]="sending() || !recipientEmail"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50
                     disabled:cursor-not-allowed"
            >
              @if (sending()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Sending…
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                </svg>
                Send Email
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SendEmailModalComponent {
  // ── Inputs set by parent before calling show() ──
  readonly documentType = input<DocumentEmailType>('INVOICE');
  readonly senderName = input<string>('');
  readonly senderEmail = input<string>('');
  readonly pdfFileName = input<string>('');
  /** Whether the current user has linked WhatsApp in Settings */
  readonly waLinked = input(false);
  /** Pre-fill phone number from the contact person */
  readonly defaultPhone = input<string | null>(null);

  // ── Outputs ──
  readonly sendEmail = output<SendEmailPayload>();
  readonly sendWhatsApp = output<string>();

  // ── Internal state ──
  readonly open = signal(false);
  readonly sending = signal(false);
  readonly waSending = signal(false);
  recipientEmail = '';
  ccEmailsRaw = '';
  subject = '';
  htmlBody = '';
  waPhoneNumber = '';

  // Document type → human-readable label
  readonly docLabel = computed(() => DOC_LABELS[this.documentType()] ?? 'Document');

  /**
   * Show the compose modal. The parent should pre-fill the fields
   * by calling `showWith()` instead of `show()`.
   */
  show(): void {
    this.sending.set(false);
    this.waSending.set(false);
    this.open.set(true);
  }

  /**
   * Open the modal and prime all editable fields.
   */
  showWith(defaults: {
    recipientEmail: string;
    ccEmails: string[];
    subject: string;
    htmlBody: string;
  }): void {
    this.recipientEmail = defaults.recipientEmail;
    this.ccEmailsRaw = defaults.ccEmails.join(', ');
    this.subject = defaults.subject;
    this.htmlBody = defaults.htmlBody;
    this.waPhoneNumber = this.defaultPhone() ?? '';
    this.show();
  }

  close(): void {
    this.open.set(false);
  }

  doSend(): void {
    if (!this.recipientEmail) return;
    this.sending.set(true);
    const ccEmails = this.ccEmailsRaw
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    this.sendEmail.emit({
      documentType: this.documentType(),
      recipientEmail: this.recipientEmail,
      ccEmails,
      subject: this.subject,
      htmlBody: this.htmlBody,
    });
  }

  doSendWa(): void {
    if (!this.waPhoneNumber) return;
    this.waSending.set(true);
    this.sendWhatsApp.emit(this.waPhoneNumber);
  }

  /** Called by parent after the API call completes. */
  done(): void {
    this.sending.set(false);
    this.open.set(false);
  }

  /** Called by parent after the WhatsApp send completes. */
  waDone(): void {
    this.waSending.set(false);
  }
}
