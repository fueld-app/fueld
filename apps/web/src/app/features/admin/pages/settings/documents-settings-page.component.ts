import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  AttachmentTypeSettingsDto,
  DeliveryDocumentationSettingsDto,
  PortDocumentationSettingsDto,
  InquiryCancelReasonSettingsDto,
} from '@fueld/types';

import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';

interface InquirySettingsDto {
  supplierResponseUrlEnabled: boolean;
  autoMarkNoReplyAfterHours: number | null;
  defaultResponseDeadlineHours: number | null;
  notifyQuoteSubmitEmail: boolean;
  notifyQuoteSubmitPush: boolean;
  notifyQuoteSubmitWhatsApp: boolean;
}

@Component({
  selector: 'app-documents-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Documents & Inquiry Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure attachment types, delivery and port documentation, inquiry cancellation reasons, and supplier inquiry behaviour.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3 min-[2000px]:grid-cols-4">

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Attachment Types                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--indigo">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--indigo">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10.362 1.093a1 1 0 00-.724 0l-7 2.625A1 1 0 002 4.655v5.69a1 1 0 00.638.937l7 2.625a1 1 0 00.724 0l7-2.625A1 1 0 0018 10.345v-5.69a1 1 0 00-.638-.937l-7-2.625zM10 3.12L4.052 5.35 10 7.58l5.948-2.23L10 3.12z" clip-rule="evenodd" />
                  <path d="M3 11.38l6 2.25v5.25l-6-2.25v-5.25zM11 18.88v-5.25l6-2.25v5.25l-6 2.25z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Attachment Types</h3>
                <p class="text-xs text-gray-500">Configure which attachment types can be selected when uploading order/inquiry attachments.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
              @for (type of attachmentTypes(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveAttachmentTypeUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveAttachmentTypeDown(i)" [disabled]="i === attachmentTypes().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="type"
                    (input)="updateAttachmentType(i, $any($event.target).value)"
                    class="app-input-mono-uppercase flex-1"
                  />
                  <button
                    (click)="removeAttachmentType(i)"
                    [disabled]="attachmentTypes().length <= 1 || type === 'BDR'"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    [title]="type === 'BDR' ? 'BDR is a core type and cannot be removed' : 'Remove type'"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addAttachmentType()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Type
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveAttachmentTypes()"
                  [disabled]="attachmentTypesSaving()"
                  class="app-button-primary"
                >
                  @if (attachmentTypesSaving()) { Saving… } @else { Save Types }
                </button>
                @if (attachmentTypesSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Delivery Documentation                               -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Delivery Documentation</h3>
                <p class="text-xs text-gray-500">Configure which attachment types are required to close (mark delivered) an order.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-4">
              <div class="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div>
                  <p class="text-sm font-medium text-gray-900">Require delivery documentation</p>
                  <p class="text-xs text-gray-500">When enabled, orders cannot be marked as delivered without at least one attachment of the selected types.</p>
                </div>
                <button
                  (click)="requireDeliveryDocumentation.set(!requireDeliveryDocumentation())"
                  [disabled]="deliveryDocumentationSaving()"
                  [class]="requireDeliveryDocumentation()
                    ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-amber-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50'
                    : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:opacity-50'"
                >
                  <span
                    [class]="requireDeliveryDocumentation()
                      ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                      : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                  ></span>
                </button>
              </div>

              @if (requireDeliveryDocumentation()) {
                <div class="space-y-2">
                  <p class="text-sm font-medium text-gray-700">Valid delivery documentation types</p>
                  <p class="text-xs text-gray-500">Select which configured attachment types satisfy the delivery closeout rule.</p>
                  <div class="flex flex-wrap gap-2">
                    @for (type of attachmentTypes(); track type) {
                      <label class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 transition-colors">
                        <input
                          type="checkbox"
                          [checked]="deliveryDocumentationTypes().includes(type)"
                          (change)="toggleDeliveryDocumentationType(type, $any($event.target).checked)"
                          class="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                        />
                        <span class="font-mono text-xs uppercase">{{ type }}</span>
                      </label>
                    }
                  </div>
                </div>
              }

              <div class="flex items-center gap-3 pt-1">
                <button
                  (click)="saveDeliveryDocumentationSettings()"
                  [disabled]="deliveryDocumentationSaving()"
                  class="app-button-primary"
                >
                  @if (deliveryDocumentationSaving()) { Saving… } @else { Save Delivery Documentation }
                </button>
                @if (deliveryDocumentationSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Port Documentation                                     -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--teal">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--teal">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-teal-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.75 3A2.75 2.75 0 0 0 4 5.75v12.5A2.75 2.75 0 0 0 6.75 21h10.5A2.75 2.75 0 0 0 20 18.25V8.81a2.75 2.75 0 0 0-.806-1.944l-2.06-2.06A2.75 2.75 0 0 0 15.19 4H6.75Zm.75 5.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 8.5Zm0 3.75a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Zm0 3.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1-.75-.75Z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Port Documentation</h3>
                <p class="text-xs text-gray-500">Enable order-level port document generation for deployments that use this workflow.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-4">
              <div class="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div>
                  <p class="text-sm font-medium text-gray-900">Feature enabled</p>
                  <p class="text-xs text-gray-500">Phase 1 uses a deployment-level toggle. License-based entitlement can replace this later.</p>
                </div>
                <button
                  (click)="portDocumentationEnabled.set(!portDocumentationEnabled())"
                  [disabled]="portDocumentationSaving()"
                  [class]="portDocumentationEnabled()
                    ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-teal-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50'
                    : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50'"
                >
                  <span
                    [class]="portDocumentationEnabled()
                      ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                      : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                  ></span>
                </button>
              </div>

              <div class="rounded-lg border border-dashed border-gray-200 bg-white p-4 text-xs text-gray-500">
                Phase 1 target: Bunker Instructions generation, Gate List export, and Flange Worksheet attachment from the order workflow.
              </div>

              <div class="flex items-center gap-3 pt-1">
                <button
                  (click)="savePortDocumentationSettings()"
                  [disabled]="portDocumentationSaving()"
                  class="app-button-primary"
                >
                  @if (portDocumentationSaving()) { Saving… } @else { Save Port Documentation Settings }
                </button>
                @if (portDocumentationSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Inquiry Cancel Reasons                                 -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--rose">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--rose">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-rose-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.53-10.53a.75.75 0 0 0-1.06-1.06L10 8.94 7.53 6.47a.75.75 0 0 0-1.06 1.06L8.94 10l-2.47 2.47a.75.75 0 1 0 1.06 1.06L10 11.06l2.47 2.47a.75.75 0 0 0 1.06-1.06L11.06 10l2.47-2.47Z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Inquiry Cancel Reasons</h3>
                <p class="text-xs text-gray-500">Configure selectable reasons required when cancelling an inquiry.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
              @for (reason of inquiryCancelReasons(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveInquiryCancelReasonUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveInquiryCancelReasonDown(i)" [disabled]="i === inquiryCancelReasons().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="reason"
                    (input)="updateInquiryCancelReason(i, $any($event.target).value)"
                    class="app-input flex-1"
                  />
                  <button
                    (click)="removeInquiryCancelReason(i)"
                    [disabled]="inquiryCancelReasons().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove reason"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addInquiryCancelReason()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Reason
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveInquiryCancelReasons()"
                  [disabled]="inquiryCancelReasonsSaving()"
                  class="app-button-primary"
                >
                  @if (inquiryCancelReasonsSaving()) { Saving… } @else { Save Reasons }
                </button>
                @if (inquiryCancelReasonsSaved()) {
                  <span class="text-sm text-green-600 flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                    </svg>
                    Saved
                  </span>
                }
              </div>
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Supplier Inquiry Settings                              -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--sky">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--sky">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 4.75A2.75 2.75 0 0 1 6.75 2h10.5A2.75 2.75 0 0 1 20 4.75v10.5A2.75 2.75 0 0 1 17.25 18H9.56l-4.78 3.52A.75.75 0 0 1 3.6 20.9V18.8A2.75 2.75 0 0 1 2 16.25V4.75A2.75 2.75 0 0 1 4.75 2Zm2.75 1.5a1.25 1.25 0 0 0-1.25 1.25v7.95c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V7.5c0-.69-.56-1.25-1.25-1.25H6.75Z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Supplier Inquiry Settings</h3>
                <p class="text-xs text-gray-500">Control supplier response links, quote alerts, and automatic no-reply handling for inquiries.</p>
              </div>
            </div>

            <div class="app-panel-body">
              @if (inquirySaveSuccess()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                  {{ inquirySaveSuccess() }}
                </div>
              }
              @if (inquirySaveError()) {
                <div class="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                  {{ inquirySaveError() }}
                </div>
              }

              <div class="flex items-center justify-between gap-4">
                <div>
                  <p class="text-sm font-medium text-gray-900">Enable supplier response link</p>
                  <p class="text-xs text-gray-500">Include the public quote URL in inquiry emails so suppliers can submit line-item prices directly.</p>
                </div>
                <button
                  (click)="toggleInquiryResponseUrl()"
                  [disabled]="inquirySaving()"
                  [class]="inquiryResponseUrlEnabled()
                    ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-sky-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'
                    : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'"
                >
                  <span
                    [class]="inquiryResponseUrlEnabled()
                      ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                      : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                  ></span>
                </button>
              </div>

              <div class="mt-5 border-t border-gray-100 pt-5">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <p class="text-sm font-medium text-gray-900">Auto-mark stale inquiries as no reply</p>
                    <p class="text-xs text-gray-500">Convert unanswered inquiries from SENT to NO_REPLY after the configured number of hours.</p>
                  </div>
                  <button
                    (click)="toggleInquiryAutoNoReply()"
                    [disabled]="inquirySaving()"
                    [class]="inquiryAutoNoReplyEnabled()
                      ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-sky-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'
                      : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'"
                  >
                    <span
                      [class]="inquiryAutoNoReplyEnabled()
                        ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                        : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                    ></span>
                  </button>
                </div>

                @if (inquiryAutoNoReplyEnabled()) {
                  <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div class="w-full sm:w-40">
                      <label class="block text-sm font-medium text-gray-700">Hours</label>
                      <input
                        type="number"
                        min="1"
                        [ngModel]="inquiryAutoNoReplyHours()"
                        (ngModelChange)="setInquiryAutoNoReplyHours($event)"
                        class="app-input mt-1 w-full"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="saveInquiryAutoNoReplyHours()"
                      [disabled]="inquirySaving()"
                      class="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
                    >
                      Save no-reply timing
                    </button>
                  </div>
                }
              </div>

              <div class="mt-5 border-t border-gray-100 pt-5">
                <div>
                  <p class="text-sm font-medium text-gray-900">Default response deadline</p>
                  <p class="text-xs text-gray-500">Number of hours from when an inquiry is sent until the response deadline shown to suppliers. Leave blank to disable the deadline feature.</p>
                </div>
                <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div class="w-full sm:w-40">
                    <label class="block text-sm font-medium text-gray-700">Hours</label>
                    <input
                      type="number"
                      min="1"
                      placeholder="Disabled"
                      [ngModel]="inquiryDeadlineHours()"
                      (ngModelChange)="setInquiryDeadlineHours($event)"
                      class="app-input mt-1 w-full"
                    />
                  </div>
                  <button
                    type="button"
                    (click)="saveInquiryDeadlineHours()"
                    [disabled]="inquirySaving()"
                    class="inline-flex items-center justify-center rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
                  >
                    Save deadline
                  </button>
                </div>
              </div>

              <div class="mt-5 border-t border-gray-100 pt-5">
                <div>
                  <p class="text-sm font-medium text-gray-900">Supplier quote alerts</p>
                  <p class="text-xs text-gray-500">Alert the responsible trader when a supplier submits a quote or decline through the public Fueld response form.</p>
                </div>

                <div class="mt-4 space-y-4">
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-sm font-medium text-gray-900">Email alert</p>
                      <p class="text-xs text-gray-500">Send an internal notification email with a link to the order.</p>
                    </div>
                    <button
                      (click)="toggleInquiryQuoteAlertEmail()"
                      [disabled]="inquirySaving()"
                      [class]="inquiryQuoteAlertEmailEnabled()
                        ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-sky-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'
                        : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'"
                    >
                      <span
                        [class]="inquiryQuoteAlertEmailEnabled()
                          ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                          : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                      ></span>
                    </button>
                  </div>

                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-sm font-medium text-gray-900">Push alert</p>
                      <p class="text-xs text-gray-500">Send a browser push notification that opens the order detail page.</p>
                    </div>
                    <button
                      (click)="toggleInquiryQuoteAlertPush()"
                      [disabled]="inquirySaving()"
                      [class]="inquiryQuoteAlertPushEnabled()
                        ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-sky-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'
                        : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'"
                    >
                      <span
                        [class]="inquiryQuoteAlertPushEnabled()
                          ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                          : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                      ></span>
                    </button>
                  </div>

                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <p class="text-sm font-medium text-gray-900">WhatsApp group alert</p>
                      <p class="text-xs text-gray-500">Post the supplier response to the default WhatsApp group when WhatsApp is configured.</p>
                    </div>
                    <button
                      (click)="toggleInquiryQuoteAlertWhatsApp()"
                      [disabled]="inquirySaving()"
                      [class]="inquiryQuoteAlertWhatsAppEnabled()
                        ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-sky-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'
                        : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 disabled:opacity-50'"
                    >
                      <span
                        [class]="inquiryQuoteAlertWhatsAppEnabled()
                          ? 'pointer-events-none inline-block h-5 w-5 translate-x-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'
                          : 'pointer-events-none inline-block h-5 w-5 translate-x-0 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out'"
                      ></span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      }

    </div>
  `,
})
export class DocumentsSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(SettingsToastService);

  readonly loading = signal(true);

  // Attachment Types
  readonly attachmentTypes = signal<string[]>([]);
  readonly attachmentTypesSaving = signal(false);
  readonly attachmentTypesSaved = signal(false);

  // Delivery Documentation
  readonly requireDeliveryDocumentation = signal(true);
  readonly deliveryDocumentationTypes = signal<string[]>(['BDR']);
  readonly deliveryDocumentationSaving = signal(false);
  readonly deliveryDocumentationSaved = signal(false);

  // Port Documentation feature
  readonly portDocumentationEnabled = signal(false);
  readonly portDocumentationSaving = signal(false);
  readonly portDocumentationSaved = signal(false);

  // Inquiry cancellation reasons
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly inquiryCancelReasonsSaving = signal(false);
  readonly inquiryCancelReasonsSaved = signal(false);

  // Supplier inquiry settings
  readonly inquiryResponseUrlEnabled = signal(true);
  readonly inquiryAutoNoReplyEnabled = signal(true);
  readonly inquiryAutoNoReplyHours = signal('168');
  readonly inquiryDeadlineHours = signal('48');
  readonly inquiryQuoteAlertEmailEnabled = signal(false);
  readonly inquiryQuoteAlertPushEnabled = signal(false);
  readonly inquiryQuoteAlertWhatsAppEnabled = signal(false);
  readonly inquirySaving = signal(false);
  readonly inquirySaveSuccess = signal('');
  readonly inquirySaveError = signal('');

  ngOnInit(): void {
    this.loadAttachmentTypes();
    this.loadDeliveryDocumentationSettings();
    this.loadPortDocumentationSettings();
    this.loadInquiryCancelReasons();
    this.loadInquirySettings();
    this.loading.set(false);
  }

  // ─── Attachment Types ──────────────────────────────────────────────

  private async loadAttachmentTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<AttachmentTypeSettingsDto>>(`${API}/admin/settings/attachment-types`),
      );
      if (res.success) this.attachmentTypes.set(res.data.attachmentTypes);
    } catch {
      this.toastService.show('error', 'Failed to load attachment types.');
    }
  }

  updateAttachmentType(index: number, value: string): void {
    const updated = [...this.attachmentTypes()];
    updated[index] = value.toUpperCase();
    this.attachmentTypes.set(updated);
  }

  addAttachmentType(): void {
    this.attachmentTypes.set([...this.attachmentTypes(), '']);
  }

  removeAttachmentType(index: number): void {
    this.attachmentTypes.set(this.attachmentTypes().filter((_, i) => i !== index));
  }

  moveAttachmentTypeUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.attachmentTypes()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.attachmentTypes.set(updated);
  }

  moveAttachmentTypeDown(index: number): void {
    const arr = this.attachmentTypes();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.attachmentTypes.set(updated);
  }

  async saveAttachmentTypes(): Promise<void> {
    const valid = this.attachmentTypes().map((t) => t.trim()).filter((t) => t.length > 0);
    if (valid.length === 0) {
      this.toastService.show('error', 'At least one attachment type is required.');
      return;
    }
    this.attachmentTypesSaving.set(true);
    this.attachmentTypesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<AttachmentTypeSettingsDto>>(`${API}/admin/settings/attachment-types`, { attachmentTypes: valid }),
      );
      if (res.success) {
        this.attachmentTypes.set(res.data.attachmentTypes);
        this.attachmentTypesSaved.set(true);
        setTimeout(() => this.attachmentTypesSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save attachment types.');
    } finally {
      this.attachmentTypesSaving.set(false);
    }
  }

  // ─── Delivery Documentation ────────────────────────────────────────

  private async loadDeliveryDocumentationSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<DeliveryDocumentationSettingsDto>>(`${API}/admin/settings/delivery-documentation`),
      );
      if (res.success) {
        this.requireDeliveryDocumentation.set(res.data.requireDeliveryDocumentation);
        this.deliveryDocumentationTypes.set(res.data.deliveryDocumentationTypes);
      }
    } catch {
      this.toastService.show('error', 'Failed to load delivery documentation settings.');
    }
  }

  toggleDeliveryDocumentationType(type: string, checked: boolean): void {
    const current = new Set(this.deliveryDocumentationTypes());
    if (checked) {
      current.add(type);
    } else {
      current.delete(type);
    }
    this.deliveryDocumentationTypes.set(Array.from(current));
  }

  async saveDeliveryDocumentationSettings(): Promise<void> {
    this.deliveryDocumentationSaving.set(true);
    this.deliveryDocumentationSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<DeliveryDocumentationSettingsDto>>(`${API}/admin/settings/delivery-documentation`, {
          requireDeliveryDocumentation: this.requireDeliveryDocumentation(),
          deliveryDocumentationTypes: this.deliveryDocumentationTypes(),
        }),
      );
      if (res.success) {
        this.requireDeliveryDocumentation.set(res.data.requireDeliveryDocumentation);
        this.deliveryDocumentationTypes.set(res.data.deliveryDocumentationTypes);
        this.deliveryDocumentationSaved.set(true);
        setTimeout(() => this.deliveryDocumentationSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save delivery documentation settings.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save delivery documentation settings.');
    } finally {
      this.deliveryDocumentationSaving.set(false);
    }
  }

  // ─── Port Documentation ────────────────────────────────────────────

  private async loadPortDocumentationSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortDocumentationSettingsDto>>(`${API}/admin/settings/port-documentation`),
      );
      if (res.success) {
        this.portDocumentationEnabled.set(res.data.enabled === true);
      }
    } catch {
      this.toastService.show('error', 'Failed to load Port Documentation settings.');
    }
  }

  async savePortDocumentationSettings(): Promise<void> {
    this.portDocumentationSaving.set(true);
    this.portDocumentationSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<PortDocumentationSettingsDto>>(`${API}/admin/settings/port-documentation`, {
          enabled: this.portDocumentationEnabled(),
        }),
      );
      if (res.success) {
        this.portDocumentationEnabled.set(res.data.enabled === true);
        this.portDocumentationSaved.set(true);
        setTimeout(() => this.portDocumentationSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save Port Documentation settings.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save Port Documentation settings.');
    } finally {
      this.portDocumentationSaving.set(false);
    }
  }

  // ─── Inquiry cancellation reasons ────────────────────────────────

  private async loadInquiryCancelReasons(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquiryCancelReasonSettingsDto>>(`${API}/admin/settings/inquiry-cancel-reasons`),
      );
      if (res.success) this.inquiryCancelReasons.set(res.data.reasons);
    } catch {
      this.toastService.show('error', 'Failed to load inquiry cancellation reasons.');
    }
  }

  updateInquiryCancelReason(index: number, value: string): void {
    const updated = [...this.inquiryCancelReasons()];
    updated[index] = value;
    this.inquiryCancelReasons.set(updated);
  }

  addInquiryCancelReason(): void {
    this.inquiryCancelReasons.set([...this.inquiryCancelReasons(), '']);
  }

  removeInquiryCancelReason(index: number): void {
    this.inquiryCancelReasons.set(this.inquiryCancelReasons().filter((_, i) => i !== index));
  }

  moveInquiryCancelReasonUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.inquiryCancelReasons()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.inquiryCancelReasons.set(updated);
  }

  moveInquiryCancelReasonDown(index: number): void {
    const arr = this.inquiryCancelReasons();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.inquiryCancelReasons.set(updated);
  }

  async saveInquiryCancelReasons(): Promise<void> {
    const valid = this.inquiryCancelReasons().map((r) => r.trim()).filter((r) => r.length > 0);
    if (valid.length === 0) {
      this.toastService.show('error', 'At least one inquiry cancellation reason is required.');
      return;
    }
    this.inquiryCancelReasonsSaving.set(true);
    this.inquiryCancelReasonsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<InquiryCancelReasonSettingsDto>>(`${API}/admin/settings/inquiry-cancel-reasons`, { reasons: valid }),
      );
      if (res.success) {
        this.inquiryCancelReasons.set(res.data.reasons);
        this.inquiryCancelReasonsSaved.set(true);
        setTimeout(() => this.inquiryCancelReasonsSaved.set(false), 3000);
      } else {
        this.toastService.show('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.toastService.show('error', 'Failed to save inquiry cancellation reasons.');
    } finally {
      this.inquiryCancelReasonsSaving.set(false);
    }
  }

  // ─── Supplier inquiry settings ───────────────────────────────────

  private async loadInquirySettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquirySettingsDto>>(`${API}/admin/settings/inquiry`),
      );
      if (res.success) {
        this.applyInquirySettings(res.data);
      }
    } catch {
      this.toastService.show('error', 'Failed to load supplier inquiry settings.');
    }
  }

  private applyInquirySettings(settings: InquirySettingsDto): void {
    this.inquiryResponseUrlEnabled.set(settings.supplierResponseUrlEnabled !== false);
    const autoMarkNoReplyAfterHours = settings.autoMarkNoReplyAfterHours;
    this.inquiryAutoNoReplyEnabled.set(autoMarkNoReplyAfterHours !== null && autoMarkNoReplyAfterHours > 0);
    this.inquiryAutoNoReplyHours.set(String(autoMarkNoReplyAfterHours ?? 168));
    this.inquiryDeadlineHours.set(settings.defaultResponseDeadlineHours == null ? '' : String(settings.defaultResponseDeadlineHours));
    this.inquiryQuoteAlertEmailEnabled.set(settings.notifyQuoteSubmitEmail === true);
    this.inquiryQuoteAlertPushEnabled.set(settings.notifyQuoteSubmitPush === true);
    this.inquiryQuoteAlertWhatsAppEnabled.set(settings.notifyQuoteSubmitWhatsApp === true);
  }

  private async updateInquirySettings(payload: Partial<InquirySettingsDto>, successMessage: string): Promise<void> {
    this.inquirySaving.set(true);
    this.inquirySaveSuccess.set('');
    this.inquirySaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<InquirySettingsDto>>(`${API}/admin/settings/inquiry`, payload),
      );
      if (res.success) {
        this.applyInquirySettings(res.data);
        this.inquirySaveSuccess.set(successMessage);
      } else {
        this.inquirySaveError.set(res.message ?? 'Failed to update inquiry settings.');
      }
    } catch {
      this.inquirySaveError.set('Failed to update inquiry settings.');
    } finally {
      this.inquirySaving.set(false);
    }
  }

  async toggleInquiryResponseUrl(): Promise<void> {
    await this.updateInquirySettings(
      { supplierResponseUrlEnabled: !this.inquiryResponseUrlEnabled() },
      !this.inquiryResponseUrlEnabled() ? 'Supplier response links enabled.' : 'Supplier response links disabled.',
    );
  }

  async toggleInquiryAutoNoReply(): Promise<void> {
    const enabled = !this.inquiryAutoNoReplyEnabled();
    const parsedHours = Number(String(this.inquiryAutoNoReplyHours()).trim() || '168');
    await this.updateInquirySettings(
      { autoMarkNoReplyAfterHours: enabled ? Math.max(1, Math.round(parsedHours || 168)) : null },
      enabled ? 'Automatic no-reply handling enabled.' : 'Automatic no-reply handling disabled.',
    );
  }

  async saveInquiryAutoNoReplyHours(): Promise<void> {
    const parsedHours = Number(String(this.inquiryAutoNoReplyHours()).trim());
    if (!Number.isFinite(parsedHours) || parsedHours < 1) {
      this.inquirySaveSuccess.set('');
      this.inquirySaveError.set('No-reply timing must be at least 1 hour.');
      return;
    }

    await this.updateInquirySettings(
      { autoMarkNoReplyAfterHours: Math.round(parsedHours) },
      'No-reply timing updated.',
    );
  }

  setInquiryAutoNoReplyHours(value: unknown): void {
    this.inquiryAutoNoReplyHours.set(String(value ?? ''));
  }

  async saveInquiryDeadlineHours(): Promise<void> {
    const rawHours = String(this.inquiryDeadlineHours()).trim();
    if (!rawHours) {
      await this.updateInquirySettings(
        { defaultResponseDeadlineHours: null },
        'Response deadline disabled.',
      );
      return;
    }

    const parsedHours = Number(rawHours);
    if (!Number.isFinite(parsedHours) || parsedHours < 1) {
      this.inquirySaveSuccess.set('');
      this.inquirySaveError.set('Response deadline must be at least 1 hour.');
      return;
    }

    await this.updateInquirySettings(
      { defaultResponseDeadlineHours: Math.round(parsedHours) },
      'Response deadline updated.',
    );
  }

  setInquiryDeadlineHours(value: unknown): void {
    this.inquiryDeadlineHours.set(String(value ?? ''));
  }

  async toggleInquiryQuoteAlertEmail(): Promise<void> {
    await this.updateInquirySettings(
      { notifyQuoteSubmitEmail: !this.inquiryQuoteAlertEmailEnabled() },
      !this.inquiryQuoteAlertEmailEnabled() ? 'Supplier quote email alerts enabled.' : 'Supplier quote email alerts disabled.',
    );
  }

  async toggleInquiryQuoteAlertPush(): Promise<void> {
    await this.updateInquirySettings(
      { notifyQuoteSubmitPush: !this.inquiryQuoteAlertPushEnabled() },
      !this.inquiryQuoteAlertPushEnabled() ? 'Supplier quote push alerts enabled.' : 'Supplier quote push alerts disabled.',
    );
  }

  async toggleInquiryQuoteAlertWhatsApp(): Promise<void> {
    await this.updateInquirySettings(
      { notifyQuoteSubmitWhatsApp: !this.inquiryQuoteAlertWhatsAppEnabled() },
      !this.inquiryQuoteAlertWhatsAppEnabled() ? 'Supplier quote WhatsApp alerts enabled.' : 'Supplier quote WhatsApp alerts disabled.',
    );
  }
}
