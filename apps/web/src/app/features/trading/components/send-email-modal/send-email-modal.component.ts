import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  viewChild,
  inject,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import {
  EmailTagInputComponent,
  type EmailTag,
} from '../../../../shared/components/email-tag-input/email-tag-input.component';
import { API_URL } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  Send Email Modal — Compose & send document emails
// ═══════════════════════════════════════════════════════════════════════
//
// Features:
//  - Tag-style email inputs with typeahead contact search
//  - BCC field (toggle to show)
//  - Locked tags for admin-configured default CC/BCC
//  - Rich-text body editor (native contenteditable)
//  - PDF preview in modal
//  - WhatsApp send option
// ═══════════════════════════════════════════════════════════════════════

export type DocumentEmailType = 'OFFER' | 'CONFIRMATION' | 'NOMINATION' | 'PROFORMA' | 'INVOICE';

export interface SendEmailAttachmentOption {
  id: string;
  fileName: string;
  label?: string;
}

export interface SendEmailPayload {
  documentType: DocumentEmailType;
  orderSupplierId?: string | null;
  recipientEmail: string;
  ccEmails: string[];
  bccEmails: string[];
  subject: string;
  htmlBody: string;
  attachmentIds: string[];
}

export interface SendWhatsAppPayload {
  phone: string;
  documentType: DocumentEmailType;
  bodyText: string;
}

const DOC_LABELS: Record<DocumentEmailType, string> = {
  OFFER: 'Offer',
  CONFIRMATION: 'Confirmation',
  NOMINATION: 'Nomination',
  PROFORMA: 'Proforma Invoice',
  INVOICE: 'Invoice',
};

@Component({
  selector: 'app-send-email-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmailTagInputComponent],
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      >
        <!-- Modal panel -->
        <div
          class="w-full max-w-3xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between border-b border-gray-200 px-6 py-4 shrink-0"
          >
            <div>
              <h2 id="modal-title" class="text-lg font-semibold text-gray-900">
                Send {{ docLabel() }}
              </h2>
              <p class="text-sm text-gray-500 mt-0.5">
                Compose email with PDF attachment
              </p>
            </div>
            <button
              (click)="close()"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
                />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="space-y-4 px-6 py-5 overflow-y-auto flex-1">
            <!-- From (read-only) -->
            <div>
              <label class="block text-sm font-medium text-gray-500">From</label>
              <div
                class="mt-1 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-700"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 text-gray-400 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5.5-2.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM10 12a5.99 5.99 0 0 0-4.793 2.39A6.483 6.483 0 0 0 10 16.5a6.483 6.483 0 0 0 4.793-2.11A5.99 5.99 0 0 0 10 12Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span class="font-medium">{{ senderName() }}</span>
                <span class="text-gray-400"
                  >&lt;{{ senderEmail() }}&gt;</span
                >
              </div>
            </div>

            <!-- To -->
            <div>
              <label class="block text-sm font-medium text-gray-700">To</label>
              <div class="mt-1">
                <app-email-tag-input
                  #toInput
                  [orderId]="orderId()"
                  [recipientScope]="recipientScope()"
                  [orderSupplierId]="nominationOrderSupplierId() ?? ''"
                  placeholder="Add recipient..."
                />
              </div>
            </div>

            <!-- CC -->
            <div>
              <div class="flex items-center justify-between">
                <label class="block text-sm font-medium text-gray-700"
                  >CC</label
                >
                @if (!showBcc()) {
                  <button
                    type="button"
                    (click)="showBcc.set(true)"
                    class="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    + BCC
                  </button>
                }
              </div>
              <div class="mt-1">
                <app-email-tag-input
                  #ccInput
                  [orderId]="orderId()"
                  [recipientScope]="recipientScope()"
                  [orderSupplierId]="nominationOrderSupplierId() ?? ''"
                  placeholder="Add CC..."
                />
              </div>
            </div>

            <!-- BCC (toggleable) -->
            @if (showBcc()) {
              <div>
                <div class="flex items-center justify-between">
                  <label class="block text-sm font-medium text-gray-700"
                    >BCC</label
                  >
                  <button
                    type="button"
                    (click)="showBcc.set(false)"
                    class="text-xs text-gray-400 hover:text-gray-600"
                  >
                    Hide
                  </button>
                </div>
                <div class="mt-1">
                  <app-email-tag-input
                    #bccInput
                    [orderId]="orderId()"
                    [recipientScope]="recipientScope()"
                    [orderSupplierId]="nominationOrderSupplierId() ?? ''"
                    placeholder="Add BCC..."
                  />
                </div>
              </div>
            }

            <!-- Subject -->
            <div>
              <label
                for="email-subject"
                class="block text-sm font-medium text-gray-700"
                >Subject</label
              >
              <input
                id="email-subject"
                type="text"
                [(ngModel)]="subject"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm shadow-sm
                       placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                       focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <!-- Rich text editor -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-sm font-medium text-gray-700"
                  >Email body</label
                >
              </div>

              <!-- Mini toolbar -->
              <div
                class="flex items-center gap-0.5 rounded-t-lg border border-b-0 border-gray-300 bg-gray-50 px-2 py-1.5"
              >
                <button
                  type="button"
                  (click)="execCmd('bold')"
                  title="Bold"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fill-rule="evenodd"
                      d="M5.25 3A.75.75 0 0 1 6 2.25h4.5a3.75 3.75 0 0 1 2.583 6.475A3.75 3.75 0 0 1 11.5 17.75H6a.75.75 0 0 1-.75-.75V3Zm1.5.75v5h3.75a2.25 2.25 0 0 0 0-4.5H6.75v-.5Zm0 7v4.5h4.75a2.25 2.25 0 0 0 0-4.5H6.75Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  (click)="execCmd('italic')"
                  title="Italic"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fill-rule="evenodd"
                      d="M8 2.75A.75.75 0 0 1 8.75 2h6.5a.75.75 0 0 1 0 1.5h-2.664l-3.172 13h2.836a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.664l3.172-13H8.75A.75.75 0 0 1 8 2.75Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  (click)="execCmd('underline')"
                  title="Underline"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fill-rule="evenodd"
                      d="M5.25 2.25a.75.75 0 0 1 .75.75v6.5a4 4 0 0 0 8 0V3a.75.75 0 0 1 1.5 0v6.5a5.5 5.5 0 0 1-11 0V3a.75.75 0 0 1 .75-.75ZM4 16.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H4.75a.75.75 0 0 1-.75-.75Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                <div class="mx-1 h-5 w-px bg-gray-300"></div>
                <button
                  type="button"
                  (click)="execCmd('insertUnorderedList')"
                  title="Bullet list"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fill-rule="evenodd"
                      d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  (click)="insertLink()"
                  title="Insert link"
                  class="rounded p-1.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                >
                  <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z"
                    />
                    <path
                      d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z"
                    />
                  </svg>
                </button>
              </div>

              <!-- Editable body -->
              <div
                #bodyEditor
                contenteditable="true"
                class="rounded-b-lg border border-gray-300 bg-white p-4 text-sm text-gray-700 min-h-[200px] max-h-[350px] overflow-y-auto focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                (input)="onBodyInput()"
              ></div>
            </div>

            <!-- Attachment + PDF Preview -->
            <div class="flex items-center gap-3">
              <div
                class="flex-1 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 text-red-500 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm2.25 8.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Zm0 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span class="font-medium">{{
                  pdfFileName() || 'Document.pdf'
                }}</span>
                <span class="text-gray-400 text-xs">(auto-generated)</span>
              </div>
              <button
                type="button"
                (click)="previewPdf()"
                [disabled]="loadingPreview()"
                class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                @if (loadingPreview()) {
                  <svg
                    class="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    ></path>
                  </svg>
                } @else {
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
                    />
                    <path
                      fill-rule="evenodd"
                      d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                      clip-rule="evenodd"
                    />
                  </svg>
                }
                Preview
              </button>
            </div>

            @if (showExtraAttachments()) {
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-semibold text-gray-900">Additional attachments</h3>
                    <p class="mt-0.5 text-xs text-gray-500">Select BDR files to include with the invoice email.</p>
                  </div>
                  <span class="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-gray-500 ring-1 ring-gray-200">
                    {{ selectedAttachmentIds().length }} selected
                  </span>
                </div>
                <div class="mt-3 space-y-2">
                  @for (attachment of visibleExtraAttachments(); track attachment.id) {
                    <label class="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                      <input
                        type="checkbox"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        [checked]="isAttachmentSelected(attachment.id)"
                        (change)="toggleAttachmentSelection(attachment.id, $any($event.target).checked)"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="truncate font-medium text-gray-800">{{ attachment.fileName }}</div>
                        @if (attachment.label) {
                          <div class="truncate text-xs text-gray-500">{{ attachment.label }}</div>
                        }
                      </div>
                    </label>
                  }
                </div>
              </div>
            }

            <!-- PDF Preview iframe -->
            @if (pdfPreviewUrl()) {
              <div class="rounded-lg border border-gray-200 overflow-hidden">
                <div
                  class="flex items-center justify-between bg-gray-50 px-4 py-2 border-b border-gray-200"
                >
                  <span class="text-sm font-medium text-gray-700"
                    >PDF Preview</span
                  >
                  <button
                    type="button"
                    (click)="closePdfPreview()"
                    class="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                  >
                    <svg
                      class="h-4 w-4"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
                      />
                    </svg>
                  </button>
                </div>
                <iframe
                  [src]="pdfPreviewUrl()"
                  class="w-full h-[400px]"
                  title="PDF Preview"
                ></iframe>
              </div>
            }

            <!-- WhatsApp phone -->
            @if (waLinked()) {
              <div>
                <label
                  for="wa-phone"
                  class="block text-sm font-medium text-gray-700"
                  >WhatsApp number
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
          <div
            class="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 shrink-0"
          >
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
                  <svg
                    class="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    ></path>
                  </svg>
                  Sending&hellip;
                } @else {
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"
                    />
                  </svg>
                  WhatsApp
                }
              </button>
            }
            <!-- Send email -->
            <button
              (click)="doSend()"
              [disabled]="sending() || !hasRecipient()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50
                     disabled:cursor-not-allowed"
            >
              @if (sending()) {
                <svg
                  class="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  ></path>
                </svg>
                Sending&hellip;
              } @else {
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.154.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z"
                  />
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
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);

  // ── Inputs set by parent before calling show() ──
  readonly documentType = input<DocumentEmailType>('INVOICE');
  readonly senderName = input<string>('');
  readonly senderEmail = input<string>('');
  readonly pdfFileName = input<string>('');
  readonly orderId = input<string>('');
  readonly nominationOrderSupplierId = input<string | null>(null);
  readonly extraAttachments = input<SendEmailAttachmentOption[]>([]);
  /** Whether the current user has linked WhatsApp in Settings */
  readonly waLinked = input(false);
  /** Pre-fill phone number from the contact person */
  readonly defaultPhone = input<string | null>(null);

  // ── Outputs ──
  readonly sendEmail = output<SendEmailPayload>();
  readonly sendWhatsApp = output<SendWhatsAppPayload>();

  // ── ViewChildren ──
  private readonly toInput = viewChild<EmailTagInputComponent>('toInput');
  private readonly ccInput = viewChild<EmailTagInputComponent>('ccInput');
  private readonly bccInput = viewChild<EmailTagInputComponent>('bccInput');
  private readonly bodyEditor =
    viewChild<ElementRef<HTMLDivElement>>('bodyEditor');

  // ── Internal state ──
  readonly open = signal(false);
  readonly sending = signal(false);
  readonly waSending = signal(false);
  readonly showBcc = signal(false);
  readonly loadingPreview = signal(false);
  readonly pdfPreviewUrl = signal<SafeResourceUrl | null>(null);
  readonly selectedAttachmentIds = signal<string[]>([]);

  subject = '';
  waPhoneNumber = '';

  // Track the current HTML body from contenteditable
  private htmlBody = '';

  // Document type -> human-readable label
  readonly docLabel = computed(
    () => DOC_LABELS[this.documentType()] ?? 'Document',
  );
  readonly recipientScope = computed<'customer' | 'supplier'>(() =>
    this.documentType() === 'NOMINATION' ? 'supplier' : 'customer',
  );
  readonly visibleExtraAttachments = computed(() =>
    this.documentType() === 'INVOICE' ? this.extraAttachments() : [],
  );
  readonly showExtraAttachments = computed(() => this.visibleExtraAttachments().length > 0);

  hasRecipient(): boolean {
    return (this.toInput()?.getEmails()?.length ?? 0) > 0;
  }

  show(): void {
    this.sending.set(false);
    this.waSending.set(false);
    this.pdfPreviewUrl.set(null);
    this.open.set(true);
  }

  showWith(defaults: {
    recipientEmail: string;
    ccEmails: string[];
    bccEmails?: string[];
    defaultCcEmails?: Array<{ email: string; label: string | null }>;
    defaultBccEmails?: Array<{ email: string; label: string | null }>;
    subject: string;
    htmlBody: string;
  }): void {
    this.subject = defaults.subject;
    this.htmlBody = defaults.htmlBody;
    this.waPhoneNumber = this.defaultPhone() ?? '';
    this.pdfPreviewUrl.set(null);
    const availableAttachmentIds = this.visibleExtraAttachments().map((attachment) => attachment.id);
    this.selectedAttachmentIds.set(
      availableAttachmentIds.length === 1 ? availableAttachmentIds : [],
    );

    if (
      (defaults.bccEmails?.length ?? 0) > 0 ||
      (defaults.defaultBccEmails?.length ?? 0) > 0
    ) {
      this.showBcc.set(true);
    } else {
      this.showBcc.set(false);
    }

    this.show();

    setTimeout(() => {
      // Set To
      if (defaults.recipientEmail) {
        this.toInput()?.setTags([{ email: defaults.recipientEmail }]);
      }

      // Set CC - mark admin defaults as locked
      const ccTags: EmailTag[] = [];
      const defaultCcSet = new Set(
        (defaults.defaultCcEmails ?? []).map((e) => e.email.toLowerCase()),
      );
      for (const email of defaults.ccEmails) {
        const isDefault = defaultCcSet.has(email.toLowerCase());
        const defaultInfo = defaults.defaultCcEmails?.find(
          (d) => d.email.toLowerCase() === email.toLowerCase(),
        );
        ccTags.push({
          email,
          name: defaultInfo?.label ?? undefined,
          locked: isDefault,
        });
      }
      this.ccInput()?.setTags(ccTags);

      // Set BCC
      if (defaults.bccEmails?.length || defaults.defaultBccEmails?.length) {
        const bccTags: EmailTag[] = [];
        const addedBcc = new Set<string>();
        for (const d of defaults.defaultBccEmails ?? []) {
          bccTags.push({
            email: d.email,
            name: d.label ?? undefined,
            locked: true,
          });
          addedBcc.add(d.email.toLowerCase());
        }
        for (const email of defaults.bccEmails ?? []) {
          if (!addedBcc.has(email.toLowerCase())) {
            bccTags.push({ email });
          }
        }
        this.bccInput()?.setTags(bccTags);
      }

      // Set body HTML in contenteditable
      const editor = this.bodyEditor()?.nativeElement;
      if (editor) {
        editor.innerHTML = defaults.htmlBody;
      }
    }, 0);
  }

  close(): void {
    this.open.set(false);
    this.pdfPreviewUrl.set(null);
    if (this._pdfBlobUrl) {
      URL.revokeObjectURL(this._pdfBlobUrl);
      this._pdfBlobUrl = null;
    }
  }

  onBodyInput(): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor) {
      this.htmlBody = editor.innerHTML;
    }
  }

  execCmd(command: string): void {
    document.execCommand(command, false);
    this.onBodyInput();
    this.bodyEditor()?.nativeElement?.focus();
  }

  insertLink(): void {
    const url = prompt('Enter URL:', 'https://');
    if (url) {
      document.execCommand('createLink', false, url);
      this.onBodyInput();
    }
  }

  // ── PDF Preview ──

  private _pdfBlobUrl: string | null = null;

  previewPdf(): void {
    const oid = this.orderId();
    if (!oid) return;

    const docType = this.documentType();
    const pdfEndpoints: Record<DocumentEmailType, string> = {
      OFFER: 'offer',
      CONFIRMATION: 'offer',
      NOMINATION: 'nomination',
      PROFORMA: 'proforma',
      INVOICE: 'invoice',
    };

    this.loadingPreview.set(true);
    const query = docType === 'NOMINATION' && this.nominationOrderSupplierId()
      ? `?orderSupplierId=${encodeURIComponent(this.nominationOrderSupplierId()!)}`
      : '';

    this.http
      .get(`${API_URL}/orders/${oid}/${pdfEndpoints[docType]}/pdf${query}`, {
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => {
          if (this._pdfBlobUrl) {
            URL.revokeObjectURL(this._pdfBlobUrl);
          }
          this._pdfBlobUrl = URL.createObjectURL(blob);
          this.pdfPreviewUrl.set(
            this.sanitizer.bypassSecurityTrustResourceUrl(this._pdfBlobUrl),
          );
          this.loadingPreview.set(false);
        },
        error: () => {
          this.loadingPreview.set(false);
        },
      });
  }

  closePdfPreview(): void {
    this.pdfPreviewUrl.set(null);
    if (this._pdfBlobUrl) {
      URL.revokeObjectURL(this._pdfBlobUrl);
      this._pdfBlobUrl = null;
    }
  }

  // ── Send actions ──

  doSend(): void {
    const toEmails = this.toInput()?.getEmails() ?? [];
    if (toEmails.length === 0) return;
    this.sending.set(true);

    this.onBodyInput();

    this.sendEmail.emit({
      documentType: this.documentType(),
      orderSupplierId: this.documentType() === 'NOMINATION' ? this.nominationOrderSupplierId() : null,
      recipientEmail: toEmails[0],
      ccEmails: this.ccInput()?.getEmails() ?? [],
      bccEmails: this.bccInput()?.getEmails() ?? [],
      subject: this.subject,
      htmlBody: this.htmlBody,
      attachmentIds: this.selectedAttachmentIds(),
    });
  }

  isAttachmentSelected(attachmentId: string): boolean {
    return this.selectedAttachmentIds().includes(attachmentId);
  }

  toggleAttachmentSelection(attachmentId: string, checked: boolean): void {
    this.selectedAttachmentIds.update((current) => {
      if (checked) {
        return current.includes(attachmentId) ? current : [...current, attachmentId];
      }
      return current.filter((id) => id !== attachmentId);
    });
  }

  doSendWa(): void {
    if (!this.waPhoneNumber) return;
    this.waSending.set(true);
    this.onBodyInput();
    // Strip HTML to plain text for WhatsApp
    const tmp = document.createElement('div');
    tmp.innerHTML = this.htmlBody;
    const bodyText = (tmp.textContent || tmp.innerText || '').trim();
    this.sendWhatsApp.emit({
      phone: this.waPhoneNumber,
      documentType: this.documentType(),
      bodyText,
    });
  }

  /** Called by parent after the API call completes. */
  done(): void {
    this.sending.set(false);
    this.open.set(false);
    this.pdfPreviewUrl.set(null);
    if (this._pdfBlobUrl) {
      URL.revokeObjectURL(this._pdfBlobUrl);
      this._pdfBlobUrl = null;
    }
  }

  /** Called by parent after the WhatsApp send completes. */
  waDone(): void {
    this.waSending.set(false);
  }
}
