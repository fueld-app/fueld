import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

// ═══════════════════════════════════════════════════════════════════════
//  Send Email Modal — Preview O365 draft before sending
// ═══════════════════════════════════════════════════════════════════════

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
          class="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 id="modal-title" class="text-lg font-semibold text-gray-900">Send Invoice</h2>
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
          <div class="space-y-4 px-6 py-5">
            <!-- To (email) -->
            <div>
              <label for="email-to" class="block text-sm font-medium text-gray-700">Email address</label>
              <input
                id="email-to"
                type="email"
                [(ngModel)]="recipientEmail"
                placeholder="client@company.com"
                class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                       focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <!-- Subject (preview) -->
            <div>
              <label class="block text-sm font-medium text-gray-700">Subject</label>
              <p class="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600">
                Invoice {{ invoiceNumber() }} — Bunker Delivery ({{ vesselName() }})
              </p>
            </div>

            <!-- Preview body -->
            <div>
              <label class="block text-sm font-medium text-gray-700">Preview</label>
              <div class="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                <p>Dear Customer,</p>
                <p class="mt-2">
                  Please find attached invoice <strong>{{ invoiceNumber() }}</strong>
                  for bunker delivery to <strong>{{ vesselName() }}</strong>
                  at <strong>{{ portName() }}</strong>.
                </p>
                <p class="mt-2 text-gray-400 text-xs">
                  📎 {{ invoiceNumber() }}.pdf will be attached automatically
                </p>
              </div>
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
                  class="mt-1.5 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                         placeholder:text-gray-400 focus:border-green-500 focus:outline-none
                         focus:ring-2 focus:ring-green-500/20"
                />
              </div>
            } @else {
              <p class="text-sm text-gray-400">
                <a href="/account/security" class="text-brand-600 underline hover:text-brand-700">Link WhatsApp in Settings</a>
                to send invoices via WhatsApp.
              </p>
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
                (click)="sendWa()"
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
            <!-- Send via O365 -->
            <button
              (click)="send()"
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
                Sending...
              } @else {
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
                </svg>
                Send via O365
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class SendEmailModalComponent {
  readonly invoiceNumber = input<string>('');
  readonly vesselName = input<string>('');
  readonly portName = input<string>('');
  /** Whether the current user has linked WhatsApp in Settings */
  readonly waLinked = input(false);
  /** Pre-fill phone number from the contact person */
  readonly defaultPhone = input<string | null>(null);
  readonly sendEmail = output<string>();
  readonly sendWhatsApp = output<string>();

  readonly open = signal(false);
  readonly sending = signal(false);
  readonly waSending = signal(false);
  recipientEmail = '';
  waPhoneNumber = '';

  show(): void {
    this.recipientEmail = '';
    this.waPhoneNumber = this.defaultPhone() ?? '';
    this.sending.set(false);
    this.waSending.set(false);
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  send(): void {
    if (!this.recipientEmail) return;
    this.sending.set(true);
    this.sendEmail.emit(this.recipientEmail);
  }

  sendWa(): void {
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
