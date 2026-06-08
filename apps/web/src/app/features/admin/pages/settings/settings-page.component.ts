import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OrderNumberSettingsDto, VesselCompanyRoleSettingsDto, VesselCompanyRoleOption, ProductSettingsDto, UnitSettingsDto, CurrencySettingsDto, CompanyTypeSettingsDto, AttachmentTypeSettingsDto, PortDocumentationSettingsDto, InquiryCancelReasonSettingsDto, UnitConversionSettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';

interface InquirySettingsDto {
  supplierResponseUrlEnabled: boolean;
  autoMarkNoReplyAfterHours: number | null;
  defaultResponseDeadlineHours: number | null;
  notifyQuoteSubmitEmail: boolean;
  notifyQuoteSubmitPush: boolean;
  notifyQuoteSubmitWhatsApp: boolean;
}

@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">General Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure order numbering and other general settings.
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
          <!--  Order Number Template                                   -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--brand">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--brand">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 00-1.5 0v2.546l-.943-1.048a.75.75 0 00-1.114 1.004l2.25 2.5a.75.75 0 001.114 0l2.25-2.5a.75.75 0 10-1.114-1.004l-.943 1.048V8.75z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Order Number Format</h3>
                <p class="text-xs text-gray-500">Configure the format used for external order/inquiry numbers.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-5">

              <!-- Prefix -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Prefix (optional)</label>
                <input
                  type="text"
                  [ngModel]="prefix()"
                  (ngModelChange)="prefix.set($event)"
                  placeholder="e.g. FU-"
                      class="app-input w-full max-w-xs"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Added before the template. Leave empty for no prefix.
                </p>
              </div>

              <!-- Template -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Template</label>
                <input
                  type="text"
                  [ngModel]="template()"
                  (ngModelChange)="template.set($event)"
                      class="app-input-mono w-full max-w-md"
                />
                <p class="mt-1 text-xs text-gray-500">
                  Available tokens:
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}PREFIX{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}YYYY{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}MM{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}DD{{ '}' }}</code>,
                  <code class="rounded bg-gray-100 px-1 py-0.5 text-xs">{{ '{' }}SEQ:N{{ '}' }}</code> (N = zero-padded digits)
                </p>
              </div>

              <!-- Preview -->
              <div class="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p class="text-xs font-medium uppercase tracking-wider text-gray-500 mb-1">Preview (next number)</p>
                <p class="text-lg font-mono font-semibold text-gray-900">{{ livePreview() }}</p>
                <p class="text-xs text-gray-500 mt-1">
                  Global sequence counter: {{ nextSeq() }}
                </p>
              </div>

              <!-- Save button -->
              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="save()"
                  [disabled]="saving()"
                      class="app-button-primary"
                >
                  @if (saving()) {
                    Saving…
                  } @else {
                    Save Changes
                  }
                </button>

                @if (saved()) {
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
          <!--  Timezone                                               -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--blue">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--blue">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Timezone</h3>
                <p class="text-xs text-gray-500">Default timezone for date/time display in the UI, emails, WhatsApp messages, and PDF documents.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Default timezone</label>
                <select
                  [ngModel]="defaultTimezone()"
                  (ngModelChange)="setDefaultTimezone($event)"
                  class="app-input w-full max-w-xs bg-white"
                >
                  <option value="">Browser default (no override)</option>
                  @for (tz of commonTimezones(); track tz.value) {
                    <option [value]="tz.value">{{ tz.label }}</option>
                  }
                </select>
                <p class="mt-1 text-xs text-gray-500">
                  All timestamps are stored as UTC. This setting controls how dates are displayed.
                  Leave empty to use each user's browser timezone.
                </p>
              </div>

              @if (defaultTimezone()) {
                <div class="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800">
                  Current time in {{ defaultTimezone() }}:
                  <span class="font-semibold">{{ timezonePreview() }}</span>
                </div>
              }

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveTimezone()"
                  [disabled]="timezoneSaving()"
                  class="app-button-primary"
                >
                  @if (timezoneSaving()) { Saving… } @else { Save Timezone }
                </button>
                @if (timezoneSaved()) {
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
          <!--  Product Options                                        -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--emerald">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--emerald">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 3.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 9H10a3 3 0 013 3v1a1 1 0 102 0v-1a5 5 0 00-5-5H8.414l1.293-1.293z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Products</h3>
                <p class="text-xs text-gray-500">Configure which products appear in order line item dropdowns.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (p of products(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveProductUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveProductDown(i)" [disabled]="i === products().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="p"
                    (input)="updateProduct(i, $any($event.target).value)"
                          class="app-input-mono-uppercase flex-1"
                  />
                  <button
                    (click)="removeProduct(i)"
                    [disabled]="products().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove product"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addProduct()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Product
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveProducts()"
                  [disabled]="productsSaving()"
                      class="app-button-primary"
                >
                  @if (productsSaving()) { Saving… } @else { Save Products }
                </button>
                @if (productsSaved()) {
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
          <!--  Unit Options                                           -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 2a.75.75 0 01.75.75v.258a33.186 33.186 0 016.668.83.75.75 0 01-.336 1.461 31.28 31.28 0 00-1.103-.232l1.702 7.545a.75.75 0 01-.387.832A4.981 4.981 0 0115 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.77-7.849a31.743 31.743 0 00-3.339-.254v11.505a20.01 20.01 0 013.78.501.75.75 0 11-.339 1.462A18.558 18.558 0 0010 17.5c-1.442 0-2.845.165-4.191.477a.75.75 0 01-.338-1.462 20.01 20.01 0 013.779-.501V4.509c-1.129.026-2.243.112-3.34.254l1.771 7.85a.75.75 0 01-.387.83A4.981 4.981 0 015 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.702-7.545c-.372.06-.742.126-1.103.232a.75.75 0 11-.336-1.462 33.186 33.186 0 016.668-.829V2.75A.75.75 0 0110 2zM5 12.662l-1.395-6.177C4.6 6.327 5.597 6.2 6 6.2c.404 0 1.4.127 2.395.285L5 12.662zm8.395-6.177L15 12.662l1.395-6.177C14.6 6.327 13.597 6.2 13.2 6.2c-.404 0-1.4.127-2.395.285z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Units</h3>
                <p class="text-xs text-gray-500">Configure which measurement units appear in order line item dropdowns.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (u of units(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveUnitUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveUnitDown(i)" [disabled]="i === units().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="u"
                    (input)="updateUnit(i, $any($event.target).value)"
                          class="app-input-mono-uppercase flex-1"
                  />
                  <button
                    (click)="removeUnit(i)"
                    [disabled]="units().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove unit"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addUnit()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Unit
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveUnits()"
                  [disabled]="unitsSaving()"
                      class="app-button-primary"
                >
                  @if (unitsSaving()) { Saving… } @else { Save Units }
                </button>
                @if (unitsSaved()) {
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
          <!--  Unit Conversions                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel min-w-0">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.28a.75.75 0 00-.75.75v3.955a.75.75 0 001.5 0v-2.134l.312.312a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm.002-2.853a.75.75 0 00.743-.648 7 7 0 00-11.712 3.138.75.75 0 001.449.39 5.5 5.5 0 019.201-2.466l.312.311H13.01a.75.75 0 000 1.5h3.955a.75.75 0 00.75-.75V6.091a.75.75 0 00-1.5 0v2.134l-.312-.312a5.474 5.474 0 00-.59-.342z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Unit Conversions</h3>
                <p class="text-xs text-gray-500">Default density/conversion factors per product. Leave product blank for a generic fallback.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (conv of unitConversions(); track $index; let i = $index) {
                <div class="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    [value]="conv.productType ?? ''"
                    (input)="updateUnitConversion(i, 'productType', $any($event.target).value)"
                    placeholder="All products"
                    class="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <input
                    type="text"
                    [value]="conv.fromUnit"
                    (input)="updateUnitConversion(i, 'fromUnit', $any($event.target).value.toUpperCase())"
                    placeholder="From"
                    class="app-input-mono-uppercase min-w-0 w-16 shrink"
                  />
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clip-rule="evenodd" />
                  </svg>
                  <input
                    type="text"
                    [value]="conv.toUnit"
                    (input)="updateUnitConversion(i, 'toUnit', $any($event.target).value.toUpperCase())"
                    placeholder="To"
                    class="app-input-mono-uppercase min-w-0 w-16 shrink"
                  />
                  <span class="text-xs text-gray-400">=</span>
                  <input
                    type="number" step="0.0001" min="0"
                    [ngModel]="conv.factor"
                    (ngModelChange)="updateUnitConversion(i, 'factor', +$event)"
                    class="min-w-0 w-20 shrink rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm tabular-nums
                           [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    (click)="removeUnitConversion(i)"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    title="Remove conversion"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addUnitConversion()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Conversion
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveUnitConversions()"
                  [disabled]="unitConversionsSaving()"
                  class="app-button-primary"
                >
                  @if (unitConversionsSaving()) { Saving… } @else { Save Conversions }
                </button>
                @if (unitConversionsSaved()) {
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
          <!--  Price References (formula pricing sources)             -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel min-w-0">
            <div class="app-panel-header app-panel-header--violet">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--violet">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042-.815a.75.75 0 01-.53-.919z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Price References</h3>
                <p class="text-xs text-gray-500">Named pricing sources for formula-based pricing (e.g. Aramco OSP, Platts). Used when suppliers quote "posted price + premium".</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (ref of priceRefs(); track ref.id; let i = $index) {
                <div class="flex items-center gap-2 min-w-0">
                  <input
                    type="text"
                    [value]="ref.name"
                    (input)="updatePriceRef(i, 'name', $any($event.target).value)"
                    placeholder="Name (e.g. Aramco OSP)"
                    class="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <input
                    type="text"
                    [value]="ref.code"
                    (input)="updatePriceRef(i, 'code', $any($event.target).value.toUpperCase())"
                    placeholder="Code"
                    class="app-input-mono-uppercase min-w-0 w-28 shrink"
                  />
                  <input
                    type="text"
                    [value]="ref.description ?? ''"
                    (input)="updatePriceRef(i, 'description', $any($event.target).value)"
                    placeholder="Description (optional)"
                    class="min-w-0 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                           focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                  <button
                    (click)="removePriceRef(i)"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    title="Remove price reference"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addPriceRef()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Price Reference
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="savePriceRefs()"
                  [disabled]="priceRefsSaving()"
                  class="app-button-primary"
                >
                  @if (priceRefsSaving()) { Saving… } @else { Save Price References }
                </button>
                @if (priceRefsSaved()) {
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
          <!--  Currency Options                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--cyan">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--cyan">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-cyan-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 10.818v2.614A3.13 3.13 0 0011.888 13c.482-.315.612-.648.612-.875 0-.227-.13-.56-.612-.875a3.13 3.13 0 00-1.138-.432zM8.33 8.62c.053.055.115.11.184.164.208.16.46.284.736.363V6.603a2.45 2.45 0 00-.92.363c-.293.18-.42.403-.42.56 0 .159.127.382.42.56.08.05.164.092.25.128z" />
                  <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-6a.75.75 0 01.75.75v.316a3.78 3.78 0 011.653.713c.426.33.744.74.925 1.2a.75.75 0 01-1.395.55 1.35 1.35 0 00-.447-.563 2.187 2.187 0 00-.736-.363V9.3c.514.082 1.006.234 1.438.467.669.36 1.115.86 1.115 1.608 0 .746-.446 1.245-1.115 1.607a3.78 3.78 0 01-1.438.467v.316a.75.75 0 01-1.5 0v-.316a3.78 3.78 0 01-1.653-.713 2.72 2.72 0 01-.925-1.2.75.75 0 011.395-.55c.12.3.272.492.447.563.243.098.5.163.736.363v-2.697a3.78 3.78 0 01-1.438-.467C5.446 8.87 5 8.37 5 7.625c0-.746.446-1.245 1.115-1.607a3.78 3.78 0 011.438-.467V5.25A.75.75 0 018.25 4.5h.08z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Currencies</h3>
                <p class="text-xs text-gray-500">Configure which currencies appear in order line item dropdowns and are tracked via Yahoo Finance.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (c of currencies(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveCurrencyUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveCurrencyDown(i)" [disabled]="i === currencies().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <select
                    [value]="c"
                    (change)="updateCurrency(i, $any($event.target).value)"
                          class="app-input-mono flex-1 bg-white"
                  >
                    @for (opt of availableCurrencyOptions(); track opt.code) {
                      <option [value]="opt.code" [selected]="opt.code === c" [disabled]="opt.code !== c && currencies().includes(opt.code)">{{ opt.code }} — {{ opt.name }}</option>
                    }
                  </select>
                  <button
                    (click)="removeCurrency(i)"
                    [disabled]="currencies().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove currency"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addCurrency()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Currency
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveCurrencies()"
                  [disabled]="currenciesSaving()"
                      class="app-button-primary"
                >
                  @if (currenciesSaving()) { Saving… } @else { Save Currencies }
                </button>
                @if (currenciesSaved()) {
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
          <!--  Company Types                                          -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--violet">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--violet">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Company Types</h3>
                <p class="text-xs text-gray-500">Configure which types can be assigned to companies (e.g. Client, Supplier).</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
              @for (ct of companyTypes(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveCompanyTypeUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveCompanyTypeDown(i)" [disabled]="i === companyTypes().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="ct"
                    (input)="updateCompanyType(i, $any($event.target).value)"
                          class="app-input-mono-uppercase flex-1"
                  />
                  <button
                    (click)="removeCompanyType(i)"
                    [disabled]="companyTypes().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove type"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }
              <button
                (click)="addCompanyType()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Type
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveCompanyTypes()"
                  [disabled]="companyTypesSaving()"
                      class="app-button-primary"
                >
                  @if (companyTypesSaving()) { Saving… } @else { Save Types }
                </button>
                @if (companyTypesSaved()) {
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

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
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
                    [disabled]="attachmentTypes().length <= 1"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                    title="Remove type"
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

            <div class="app-panel-body space-y-3 max-h-[28rem] overflow-y-auto">
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
          <!--  Vessel–Company Role Options                            -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel min-[900px]:col-span-2">
            <div class="app-panel-header app-panel-header--purple">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--purple">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Vessel–Company Roles</h3>
                <p class="text-xs text-gray-500">Configure the available role options when linking companies to vessels.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-4 max-h-[28rem] overflow-y-auto">
              @if (rolesLoading()) {
                <div class="flex items-center justify-center py-6">
                  <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </div>
              } @else {
                <div class="space-y-2">
                  <!-- Header row -->
                  <div class="flex items-center gap-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <div class="w-[22px] shrink-0"></div>
                    <div class="flex-1 min-w-0 px-1">Key</div>
                    <div class="flex-1 min-w-0 px-1">Label</div>
                    <div class="flex-1 min-w-0 px-1">Group</div>
                    <div class="w-[30px] shrink-0"></div>
                  </div>

                  @for (role of roles(); track role.key; let i = $index) {
                    <div class="flex items-center gap-3">
                      <div class="flex flex-col gap-0.5 shrink-0">
                        <button
                          (click)="moveRoleUp(i)"
                          [disabled]="i === 0"
                          class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move up"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                        <button
                          (click)="moveRoleDown(i)"
                          [disabled]="i === roles().length - 1"
                          class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                          title="Move down"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                      <input
                        type="text"
                        [value]="role.key"
                        (input)="updateRoleKey(i, $any($event.target).value)"
                        placeholder="KEY"
                           class="app-input-mono-uppercase flex-1 min-w-0"
                      />
                      <input
                        type="text"
                        [value]="role.label"
                        (input)="updateRoleLabel(i, $any($event.target).value)"
                        placeholder="Label"
                           class="app-input flex-1 min-w-0"
                      />
                      <select
                        [value]="role.group"
                        (change)="updateRoleGroup(i, $any($event.target).value)"
                           class="app-input flex-1 min-w-0"
                      >
                        <option value="Legal & Financial">Legal & Financial</option>
                        <option value="Operational & Commercial">Operational & Commercial</option>
                        <option value="Technical & Safety">Technical & Safety</option>
                        <option value="Other">Other</option>
                      </select>
                      <button
                        (click)="removeRole(i)"
                        [disabled]="roles().length <= 1"
                        class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                        title="Remove role"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>

                <button
                  (click)="addRole()"
                  class="app-button-add"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                  </svg>
                  Add Role
                </button>

                <div class="flex items-center gap-3 pt-2">
                  <button
                    (click)="saveRoles()"
                    [disabled]="rolesSaving()"
                          class="app-button-primary"
                  >
                    @if (rolesSaving()) {
                      Saving…
                    } @else {
                      Save Roles
                    }
                  </button>

                  @if (rolesSaved()) {
                    <span class="text-sm text-green-600 flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                      </svg>
                      Saved
                    </span>
                  }
                </div>
              }
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Follow-Up Settings                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--amber">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--amber">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Follow-Up Settings</h3>
                <p class="text-xs text-gray-500">Configure default follow-up reminder timing for comments.</p>
              </div>
            </div>

            <div class="app-panel-body">
              <div>
                <p class="text-sm font-medium text-gray-900">Default follow-up days</p>
                <p class="text-xs text-gray-500">When a user adds a follow-up to a comment, the date will default to this many days from today.</p>
              </div>
              <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <div class="w-full sm:w-40">
                  <label class="block text-sm font-medium text-gray-700">Days</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    [ngModel]="followUpDefaultDays()"
                    (ngModelChange)="setFollowUpDefaultDays($event)"
                    class="app-input mt-1 w-full"
                  />
                </div>
                <button
                  type="button"
                  (click)="saveFollowUpSettings()"
                  [disabled]="followUpSaving()"
                  class="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
                >
                  @if (followUpSaving()) { Saving… } @else { Save }
                </button>
                @if (followUpSaved()) {
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
          <!--  Company Segmentation                                    -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel min-[900px]:col-span-2 min-[2000px]:col-span-2">
            <div class="app-panel-header app-panel-header--violet">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--violet">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M2 4.5A2.5 2.5 0 014.5 2h11A2.5 2.5 0 0118 4.5v3.757c0 .663-.263 1.299-.732 1.768l-7.2 7.2a2.5 2.5 0 01-3.536 0l-3.768-3.768A2.5 2.5 0 012 11.69V4.5zm5-1a1 1 0 100 2 1 1 0 000-2z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Company Segmentation</h3>
                <p class="text-xs text-gray-500">Define segment categories and options that can be assigned to companies.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-5">
              @for (cat of segmentCategories(); track cat.key; let ci = $index) {
                <div class="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                  <div class="flex items-center gap-3">
                    <div class="flex flex-col gap-0.5 shrink-0">
                      <button (click)="moveSegmentCategoryUp(ci)" [disabled]="ci === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                      </button>
                      <button (click)="moveSegmentCategoryDown(ci)" [disabled]="ci === segmentCategories().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                      </button>
                    </div>
                    <input
                      type="text"
                      [value]="cat.label"
                      (input)="updateSegmentCategoryLabel(ci, $any($event.target).value)"
                      placeholder="Category name"
                      class="app-input flex-1"
                    />
                    <select
                      [value]="cat.mode"
                      (change)="updateSegmentCategoryMode(ci, $any($event.target).value)"
                      class="app-input w-32"
                    >
                      <option value="multi">Multi-select</option>
                      <option value="single">Single-select</option>
                    </select>
                    <button
                      (click)="removeSegmentCategory(ci)"
                      [disabled]="segmentCategories().length <= 1"
                      class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                      title="Remove category"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>

                  <!-- Options for this category -->
                  <div class="ml-8 space-y-2">
                    @for (opt of cat.options; track opt.key; let oi = $index) {
                      <div class="flex items-center gap-2">
                        <div class="flex flex-col gap-0.5 shrink-0">
                          <button (click)="moveSegmentOptionUp(ci, oi)" [disabled]="oi === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                          </button>
                          <button (click)="moveSegmentOptionDown(ci, oi)" [disabled]="oi === cat.options.length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                          </button>
                        </div>
                        <input
                          type="text"
                          [value]="opt.label"
                          (input)="updateSegmentOptionLabel(ci, oi, $any($event.target).value)"
                          placeholder="Option name"
                          class="app-input flex-1"
                        />
                        <button
                          (click)="removeSegmentOption(ci, oi)"
                          [disabled]="cat.options.length <= 1"
                          class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
                          title="Remove option"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    }
                    <button
                      (click)="addSegmentOption(ci)"
                      class="text-xs text-violet-600 hover:text-violet-700 font-medium flex items-center gap-1"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                      </svg>
                      Add Option
                    </button>
                  </div>
                </div>
              }

              <button
                (click)="addSegmentCategory()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Category
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveSegments()"
                  [disabled]="segmentsSaving()"
                  class="app-button-primary"
                >
                  @if (segmentsSaving()) { Saving… } @else { Save Segments }
                </button>
                @if (segmentsSaved()) {
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

        </div>
      }

      <!-- Toast notification -->
      @if (toast()) {
        <div
          class="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-opacity"
          [class]="toast()!.type === 'success'
            ? 'border border-green-200 bg-green-50 text-green-800'
            : 'border border-red-200 bg-red-50 text-red-800'"
        >
          {{ toast()!.message }}
        </div>
      }
    </div>
  `,
})
export class SettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  readonly template = signal('{YYYY}{MM}{DD}-{SEQ:6}');
  readonly prefix = signal('');
  readonly nextSeq = signal(1);

  // Vessel-company roles
  readonly rolesLoading = signal(false);
  readonly rolesSaving = signal(false);
  readonly rolesSaved = signal(false);
  readonly roles = signal<VesselCompanyRoleOption[]>([]);

  // Products
  readonly products = signal<string[]>([]);
  readonly productsSaving = signal(false);
  readonly productsSaved = signal(false);

  // Units
  readonly units = signal<string[]>([]);
  readonly unitsSaving = signal(false);
  readonly unitsSaved = signal(false);

  // Unit Conversions
  readonly unitConversions = signal<{ productType?: string; fromUnit: string; toUnit: string; factor: number }[]>([]);
  readonly unitConversionsSaving = signal(false);
  readonly unitConversionsSaved = signal(false);

  // Price References
  readonly priceRefs = signal<{ id: string; name: string; code: string; description: string | null; _new?: boolean }[]>([]);
  readonly priceRefsSaving = signal(false);
  readonly priceRefsSaved = signal(false);

  // Currencies
  readonly currencies = signal<string[]>([]);
  readonly currenciesSaving = signal(false);
  readonly currenciesSaved = signal(false);

  // Company Types
  readonly companyTypes = signal<string[]>([]);
  readonly companyTypesSaving = signal(false);
  readonly companyTypesSaved = signal(false);

  // Attachment Types
  readonly attachmentTypes = signal<string[]>([]);
  readonly attachmentTypesSaving = signal(false);
  readonly attachmentTypesSaved = signal(false);

  // Port Documentation feature
  readonly portDocumentationEnabled = signal(false);
  readonly portDocumentationSaving = signal(false);
  readonly portDocumentationSaved = signal(false);

  // Inquiry cancellation reasons
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly inquiryCancelReasonsSaving = signal(false);
  readonly inquiryCancelReasonsSaved = signal(false);
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

  // Company segmentation
  readonly segmentCategories = signal<{ key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string; description?: string }[] }[]>([]);
  readonly segmentsSaving = signal(false);
  readonly segmentsSaved = signal(false);

  // Follow-up settings
  readonly followUpDefaultDays = signal('90');
  readonly followUpSaving = signal(false);
  readonly followUpSaved = signal(false);

  // Timezone settings
  readonly defaultTimezone = signal('');
  readonly timezoneSaving = signal(false);
  readonly timezoneSaved = signal(false);

  readonly commonTimezones = signal<{ value: string; label: string }[]>([
    { value: 'America/Chicago', label: 'America/Chicago (Houston, CST/CDT)' },
    { value: 'Europe/Copenhagen', label: 'Europe/Copenhagen (CET/CEST)' },
    { value: 'Europe/Monaco', label: 'Europe/Monaco (CET/CEST)' },
    { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
    { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
    { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
    { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
    { value: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
    { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
    { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
    { value: 'Europe/Moscow', label: 'Europe/Moscow (MSK)' },
    { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
    { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
    { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  ]);

  readonly timezonePreview = computed(() => {
    const tz = this.defaultTimezone();
    if (!tz) return '';
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short',
      }).format(new Date());
    } catch {
      return 'Invalid timezone';
    }
  });

  readonly livePreview = computed(() => {
    const tmpl = this.template();
    const pfx = this.prefix();
    const seq = this.nextSeq();

    const now = new Date();
    const yyyy = now.getUTCFullYear().toString();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');

    let result = tmpl
      .replace('{PREFIX}', pfx)
      .replace('{YYYY}', yyyy)
      .replace('{MM}', mm)
      .replace('{DD}', dd);

    result = result.replace(/\{SEQ:(\d+)\}/g, (_match: string, digits: string) => {
      return String(seq).padStart(parseInt(digits, 10), '0');
    });
    result = result.replace('{SEQ}', String(seq).padStart(6, '0'));

    return result;
  });

  ngOnInit(): void {
    this.loadSettings();
    this.loadRoles();
    this.loadProducts();
    this.loadUnits();
    this.loadUnitConversions();
    this.loadPriceRefs();
    this.loadCurrencies();
    this.loadCompanyTypes();
    this.loadAttachmentTypes();
    this.loadPortDocumentationSettings();
    this.loadInquirySettings();
    this.loadInquiryCancelReasons();
    this.loadSegments();
    this.loadFollowUpSettings();
    this.loadTimezoneSettings();
  }

  private async loadSettings(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
        ),
      );
      if (res.success) {
        this.template.set(res.data.template);
        this.prefix.set(res.data.prefix);
        this.nextSeq.set(res.data.nextSeq);
      }
    } catch {
      this.showToast('error', 'Failed to load order number settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.saved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<OrderNumberSettingsDto>>(
          `${API}/admin/settings/order-number`,
          {
            template: this.template(),
            prefix: this.prefix(),
          },
        ),
      );
      if (res.success) {
        this.nextSeq.set(res.data.nextSeq);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 3000);
      } else {
        this.showToast('error', res.message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save order number settings.');
    } finally {
      this.saving.set(false);
    }
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  // ─── Vessel-Company Roles ──────────────────────────────────────────

  private async loadRoles(): Promise<void> {
    this.rolesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselCompanyRoleSettingsDto>>(
          `${API}/admin/settings/vessel-company-roles`,
        ),
      );
      if (res.success) {
        this.roles.set(res.data.roles);
      }
    } catch {
      this.showToast('error', 'Failed to load vessel-company roles.');
    } finally {
      this.rolesLoading.set(false);
    }
  }

  updateRoleKey(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], key: value.toUpperCase().replace(/[^A-Z0-9_]/g, '') };
    this.roles.set(updated);
  }

  updateRoleLabel(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], label: value };
    this.roles.set(updated);
  }

  updateRoleGroup(index: number, value: string): void {
    const updated = [...this.roles()];
    updated[index] = { ...updated[index], group: value };
    this.roles.set(updated);
  }

  addRole(): void {
    this.roles.set([...this.roles(), { key: '', label: '', group: 'Other' }]);
  }

  removeRole(index: number): void {
    const updated = this.roles().filter((_, i) => i !== index);
    this.roles.set(updated);
  }

  moveRoleUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.roles()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.roles.set(updated);
  }

  moveRoleDown(index: number): void {
    const arr = this.roles();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.roles.set(updated);
  }

  async saveRoles(): Promise<void> {
    const valid = this.roles().filter(r => r.key && r.label);
    if (valid.length === 0) {
      this.showToast('error', 'At least one role is required.');
      return;
    }
    this.rolesSaving.set(true);
    this.rolesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<VesselCompanyRoleSettingsDto>>(
          `${API}/admin/settings/vessel-company-roles`,
          { roles: valid },
        ),
      );
      if (res.success) {
        this.roles.set(res.data.roles);
        this.rolesSaved.set(true);
        setTimeout(() => this.rolesSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save vessel-company roles.');
    } finally {
      this.rolesSaving.set(false);
    }
  }

  // ─── Products ───────────────────────────────────────────────────────

  private async loadProducts(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<ProductSettingsDto>>(`${API}/admin/settings/products`),
      );
      if (res.success) this.products.set(res.data.products);
    } catch {
      this.showToast('error', 'Failed to load products.');
    }
  }

  updateProduct(index: number, value: string): void {
    const updated = [...this.products()];
    updated[index] = value.toUpperCase();
    this.products.set(updated);
  }

  addProduct(): void {
    this.products.set([...this.products(), '']);
  }

  removeProduct(index: number): void {
    this.products.set(this.products().filter((_, i) => i !== index));
  }

  moveProductUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.products()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.products.set(updated);
  }

  moveProductDown(index: number): void {
    const arr = this.products();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.products.set(updated);
  }

  async saveProducts(): Promise<void> {
    const valid = this.products().filter(p => p.trim());
    if (valid.length === 0) {
      this.showToast('error', 'At least one product is required.');
      return;
    }
    this.productsSaving.set(true);
    this.productsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<ProductSettingsDto>>(`${API}/admin/settings/products`, { products: valid }),
      );
      if (res.success) {
        this.products.set(res.data.products);
        this.productsSaved.set(true);
        setTimeout(() => this.productsSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save products.');
    } finally {
      this.productsSaving.set(false);
    }
  }

  // ─── Units ─────────────────────────────────────────────────────────

  private async loadUnits(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UnitSettingsDto>>(`${API}/admin/settings/units`),
      );
      if (res.success) this.units.set(res.data.units);
    } catch {
      this.showToast('error', 'Failed to load units.');
    }
  }

  updateUnit(index: number, value: string): void {
    const updated = [...this.units()];
    updated[index] = value.toUpperCase();
    this.units.set(updated);
  }

  addUnit(): void {
    this.units.set([...this.units(), '']);
  }

  removeUnit(index: number): void {
    this.units.set(this.units().filter((_, i) => i !== index));
  }

  moveUnitUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.units()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.units.set(updated);
  }

  moveUnitDown(index: number): void {
    const arr = this.units();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.units.set(updated);
  }

  async saveUnits(): Promise<void> {
    const valid = this.units().filter(u => u.trim());
    if (valid.length === 0) {
      this.showToast('error', 'At least one unit is required.');
      return;
    }
    this.unitsSaving.set(true);
    this.unitsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<UnitSettingsDto>>(`${API}/admin/settings/units`, { units: valid }),
      );
      if (res.success) {
        this.units.set(res.data.units);
        this.unitsSaved.set(true);
        setTimeout(() => this.unitsSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save units.');
    } finally {
      this.unitsSaving.set(false);
    }
  }

  // ─── Unit Conversions ──────────────────────────────────────────────

  private async loadUnitConversions(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<UnitConversionSettingsDto>>(`${API}/admin/settings/unit-conversions`),
      );
      if (res.success) this.unitConversions.set(res.data.conversions);
    } catch {
      this.showToast('error', 'Failed to load unit conversions.');
    }
  }

  updateUnitConversion(index: number, field: 'productType' | 'fromUnit' | 'toUnit' | 'factor', value: string | number): void {
    const updated = this.unitConversions().map((c, i) =>
      i === index ? { ...c, [field]: value } : c,
    );
    this.unitConversions.set(updated);
  }

  addUnitConversion(): void {
    this.unitConversions.set([...this.unitConversions(), { productType: '', fromUnit: '', toUnit: '', factor: 1 }]);
  }

  removeUnitConversion(index: number): void {
    this.unitConversions.set(this.unitConversions().filter((_, i) => i !== index));
  }

  async saveUnitConversions(): Promise<void> {
    const valid = this.unitConversions().filter(c => c.fromUnit.trim() && c.toUnit.trim() && c.factor > 0);
    this.unitConversionsSaving.set(true);
    this.unitConversionsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<UnitConversionSettingsDto>>(`${API}/admin/settings/unit-conversions`, { conversions: valid }),
      );
      if (res.success) {
        this.unitConversions.set(res.data.conversions);
        this.unitConversionsSaved.set(true);
        setTimeout(() => this.unitConversionsSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save unit conversions.');
    } finally {
      this.unitConversionsSaving.set(false);
    }
  }

  // ─── Price References ──────────────────────────────────────────────

  private async loadPriceRefs(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ references: { id: string; name: string; code: string; description: string | null }[] }>>(`${API}/admin/settings/price-references`),
      );
      if (res.success) this.priceRefs.set(res.data.references);
    } catch {
      this.showToast('error', 'Failed to load price references.');
    }
  }

  updatePriceRef(index: number, field: 'name' | 'code' | 'description', value: string): void {
    const updated = this.priceRefs().map((r, i) =>
      i === index ? { ...r, [field]: value } : r,
    );
    this.priceRefs.set(updated);
  }

  addPriceRef(): void {
    this.priceRefs.set([...this.priceRefs(), { id: crypto.randomUUID(), name: '', code: '', description: null, _new: true }]);
  }

  removePriceRef(index: number): void {
    const ref = this.priceRefs()[index];
    this.priceRefs.set(this.priceRefs().filter((_, i) => i !== index));
    // If it has a real ID (not new), delete from server
    if (ref && !ref._new) {
      firstValueFrom(
        this.http.delete<ApiResponse<null>>(`${API}/admin/settings/price-references/${ref.id}`),
      ).catch(() => this.showToast('error', 'Failed to delete price reference.'));
    }
  }

  async savePriceRefs(): Promise<void> {
    this.priceRefsSaving.set(true);
    this.priceRefsSaved.set(false);
    try {
      for (const ref of this.priceRefs()) {
        if (!ref.name.trim() || !ref.code.trim()) continue;
        if (ref._new) {
          await firstValueFrom(
            this.http.post<ApiResponse<unknown>>(`${API}/admin/settings/price-references`, {
              name: ref.name,
              code: ref.code,
              description: ref.description || null,
            }),
          );
        } else {
          await firstValueFrom(
            this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/price-references/${ref.id}`, {
              name: ref.name,
              code: ref.code,
              description: ref.description || null,
            }),
          );
        }
      }
      // Reload to get server-assigned IDs
      await this.loadPriceRefs();
      this.priceRefsSaved.set(true);
      setTimeout(() => this.priceRefsSaved.set(false), 3000);
    } catch {
      this.showToast('error', 'Failed to save price references.');
    } finally {
      this.priceRefsSaving.set(false);
    }
  }

  // ─── Currencies ────────────────────────────────────────────────────

  private async loadCurrencies(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CurrencySettingsDto>>(`${API}/admin/settings/currencies`),
      );
      if (res.success) this.currencies.set(res.data.currencies);
    } catch {
      this.showToast('error', 'Failed to load currencies.');
    }
  }

  // All ISO currencies available for selection
  readonly allCurrencies: { code: string; name: string }[] = [
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'DKK', name: 'Danish Krone' },
    { code: 'NOK', name: 'Norwegian Krone' },
    { code: 'SEK', name: 'Swedish Krona' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'AED', name: 'UAE Dirham' },
    { code: 'SAR', name: 'Saudi Riyal' },
    { code: 'QAR', name: 'Qatari Riyal' },
    { code: 'KWD', name: 'Kuwaiti Dinar' },
    { code: 'BHD', name: 'Bahraini Dinar' },
    { code: 'OMR', name: 'Omani Rial' },
    { code: 'SGD', name: 'Singapore Dollar' },
    { code: 'HKD', name: 'Hong Kong Dollar' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'NZD', name: 'New Zealand Dollar' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'ZAR', name: 'South African Rand' },
    { code: 'TRY', name: 'Turkish Lira' },
    { code: 'PLN', name: 'Polish Zloty' },
    { code: 'CZK', name: 'Czech Koruna' },
    { code: 'HUF', name: 'Hungarian Forint' },
    { code: 'RON', name: 'Romanian Leu' },
    { code: 'THB', name: 'Thai Baht' },
    { code: 'MYR', name: 'Malaysian Ringgit' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'PHP', name: 'Philippine Peso' },
    { code: 'TWD', name: 'Taiwan Dollar' },
    { code: 'ILS', name: 'Israeli Shekel' },
    { code: 'EGP', name: 'Egyptian Pound' },
    { code: 'NGN', name: 'Nigerian Naira' },
    { code: 'KES', name: 'Kenyan Shilling' },
  ];

  readonly availableCurrencyOptions = computed(() => {
    // Return all currencies — disabled state handled in template
    return this.allCurrencies;
  });

  updateCurrency(index: number, value: string): void {
    const updated = [...this.currencies()];
    updated[index] = value;
    this.currencies.set(updated);
  }

  addCurrency(): void {
    const current = new Set(this.currencies());
    const next = this.allCurrencies.find(c => !current.has(c.code));
    this.currencies.set([...this.currencies(), next?.code ?? '']);
  }

  removeCurrency(index: number): void {
    this.currencies.set(this.currencies().filter((_, i) => i !== index));
  }

  moveCurrencyUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.currencies()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.currencies.set(updated);
  }

  moveCurrencyDown(index: number): void {
    const arr = this.currencies();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.currencies.set(updated);
  }

  async saveCurrencies(): Promise<void> {
    const valid = this.currencies().filter(c => c.trim());
    if (valid.length === 0) {
      this.showToast('error', 'At least one currency is required.');
      return;
    }
    this.currenciesSaving.set(true);
    this.currenciesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<CurrencySettingsDto>>(`${API}/admin/settings/currencies`, { currencies: valid }),
      );
      if (res.success) {
        this.currencies.set(res.data.currencies);
        this.currenciesSaved.set(true);
        setTimeout(() => this.currenciesSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save currencies.');
    } finally {
      this.currenciesSaving.set(false);
    }
  }

  // ─── Company Types ─────────────────────────────────────────────────

  private async loadCompanyTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyTypeSettingsDto>>(`${API}/admin/settings/company-types`),
      );
      if (res.success) this.companyTypes.set(res.data.companyTypes);
    } catch {
      this.showToast('error', 'Failed to load company types.');
    }
  }

  updateCompanyType(index: number, value: string): void {
    const updated = [...this.companyTypes()];
    updated[index] = value.toUpperCase();
    this.companyTypes.set(updated);
  }

  addCompanyType(): void {
    this.companyTypes.set([...this.companyTypes(), '']);
  }

  removeCompanyType(index: number): void {
    this.companyTypes.set(this.companyTypes().filter((_, i) => i !== index));
  }

  moveCompanyTypeUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.companyTypes()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.companyTypes.set(updated);
  }

  moveCompanyTypeDown(index: number): void {
    const arr = this.companyTypes();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.companyTypes.set(updated);
  }

  async saveCompanyTypes(): Promise<void> {
    const valid = this.companyTypes().filter(ct => ct.trim());
    if (valid.length === 0) {
      this.showToast('error', 'At least one company type is required.');
      return;
    }
    this.companyTypesSaving.set(true);
    this.companyTypesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<CompanyTypeSettingsDto>>(`${API}/admin/settings/company-types`, { companyTypes: valid }),
      );
      if (res.success) {
        this.companyTypes.set(res.data.companyTypes);
        this.companyTypesSaved.set(true);
        setTimeout(() => this.companyTypesSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save company types.');
    } finally {
      this.companyTypesSaving.set(false);
    }
  }

  // ─── Attachment Types ──────────────────────────────────────────────

  private async loadAttachmentTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<AttachmentTypeSettingsDto>>(`${API}/admin/settings/attachment-types`),
      );
      if (res.success) this.attachmentTypes.set(res.data.attachmentTypes);
    } catch {
      this.showToast('error', 'Failed to load attachment types.');
    }
  }

  private async loadPortDocumentationSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<PortDocumentationSettingsDto>>(`${API}/admin/settings/port-documentation`),
      );
      if (res.success) {
        this.portDocumentationEnabled.set(res.data.enabled === true);
      }
    } catch {
      this.showToast('error', 'Failed to load Port Documentation settings.');
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
        this.showToast('error', (res as any).message ?? 'Failed to save Port Documentation settings.');
      }
    } catch {
      this.showToast('error', 'Failed to save Port Documentation settings.');
    } finally {
      this.portDocumentationSaving.set(false);
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
      this.showToast('error', 'At least one attachment type is required.');
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
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save attachment types.');
    } finally {
      this.attachmentTypesSaving.set(false);
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
      this.showToast('error', 'Failed to load supplier inquiry settings.');
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

  // ─── Inquiry cancellation reasons ────────────────────────────────

  private async loadInquiryCancelReasons(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<InquiryCancelReasonSettingsDto>>(`${API}/admin/settings/inquiry-cancel-reasons`),
      );
      if (res.success) this.inquiryCancelReasons.set(res.data.reasons);
    } catch {
      this.showToast('error', 'Failed to load inquiry cancellation reasons.');
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
      this.showToast('error', 'At least one inquiry cancellation reason is required.');
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
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save inquiry cancellation reasons.');
    } finally {
      this.inquiryCancelReasonsSaving.set(false);
    }
  }

  // ─── Company segmentation ─────────────────────────────────────────

  private async loadSegments(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ segmentCategories: { key: string; label: string; mode: 'multi' | 'single'; options: { key: string; label: string; description?: string }[] }[] }>>(`${API}/admin/settings/segment-settings`),
      );
      if (res.success) this.segmentCategories.set(res.data.segmentCategories);
    } catch {
      this.showToast('error', 'Failed to load segment settings.');
    }
  }

  private generateKey(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `item_${Date.now()}`;
  }

  addSegmentCategory(): void {
    const key = `category_${Date.now()}`;
    this.segmentCategories.set([
      ...this.segmentCategories(),
      { key, label: '', mode: 'multi', options: [{ key: `option_${Date.now()}`, label: '' }] },
    ]);
  }

  removeSegmentCategory(index: number): void {
    this.segmentCategories.set(this.segmentCategories().filter((_, i) => i !== index));
  }

  moveSegmentCategoryUp(index: number): void {
    if (index <= 0) return;
    const cats = [...this.segmentCategories()];
    [cats[index - 1], cats[index]] = [cats[index], cats[index - 1]];
    this.segmentCategories.set(cats);
  }

  moveSegmentCategoryDown(index: number): void {
    const cats = [...this.segmentCategories()];
    if (index >= cats.length - 1) return;
    [cats[index], cats[index + 1]] = [cats[index + 1], cats[index]];
    this.segmentCategories.set(cats);
  }

  updateSegmentCategoryLabel(catIndex: number, label: string): void {
    const cats = this.segmentCategories().map((c, i) =>
      i === catIndex ? { ...c, label, key: c.key.startsWith('category_') ? this.generateKey(label) : c.key } : c,
    );
    this.segmentCategories.set(cats);
  }

  updateSegmentCategoryMode(catIndex: number, mode: string): void {
    const cats = this.segmentCategories().map((c, i) =>
      i === catIndex ? { ...c, mode: mode as 'multi' | 'single' } : c,
    );
    this.segmentCategories.set(cats);
  }

  addSegmentOption(catIndex: number): void {
    const cats = this.segmentCategories().map((c, i) =>
      i === catIndex
        ? { ...c, options: [...c.options, { key: `option_${Date.now()}`, label: '' }] }
        : c,
    );
    this.segmentCategories.set(cats);
  }

  removeSegmentOption(catIndex: number, optIndex: number): void {
    const cats = this.segmentCategories().map((c, i) =>
      i === catIndex
        ? { ...c, options: c.options.filter((_, oi) => oi !== optIndex) }
        : c,
    );
    this.segmentCategories.set(cats);
  }

  moveSegmentOptionUp(catIndex: number, optIndex: number): void {
    if (optIndex <= 0) return;
    const cats = this.segmentCategories().map((c, i) => {
      if (i !== catIndex) return c;
      const opts = [...c.options];
      [opts[optIndex - 1], opts[optIndex]] = [opts[optIndex], opts[optIndex - 1]];
      return { ...c, options: opts };
    });
    this.segmentCategories.set(cats);
  }

  moveSegmentOptionDown(catIndex: number, optIndex: number): void {
    const cats = this.segmentCategories().map((c, i) => {
      if (i !== catIndex) return c;
      if (optIndex >= c.options.length - 1) return c;
      const opts = [...c.options];
      [opts[optIndex], opts[optIndex + 1]] = [opts[optIndex + 1], opts[optIndex]];
      return { ...c, options: opts };
    });
    this.segmentCategories.set(cats);
  }

  updateSegmentOptionLabel(catIndex: number, optIndex: number, label: string): void {
    const cats = this.segmentCategories().map((c, ci) => {
      if (ci !== catIndex) return c;
      const options = c.options.map((o, oi) =>
        oi === optIndex ? { ...o, label, key: o.key.startsWith('option_') ? this.generateKey(label) : o.key } : o,
      );
      return { ...c, options };
    });
    this.segmentCategories.set(cats);
  }

  async saveSegments(): Promise<void> {
    const cats = this.segmentCategories().filter(c => c.label.trim() && c.options.some(o => o.label.trim()));
    if (cats.length === 0) {
      this.showToast('error', 'At least one category with one option is required.');
      return;
    }
    // Clean empty options
    const cleaned = cats.map(c => ({
      ...c,
      label: c.label.trim(),
      options: c.options.filter(o => o.label.trim()).map(o => ({ ...o, label: o.label.trim() })),
    }));

    this.segmentsSaving.set(true);
    this.segmentsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ segmentCategories: typeof cleaned }>>(`${API}/admin/settings/segment-settings`, { segmentCategories: cleaned }),
      );
      if (res.success) {
        this.segmentCategories.set(res.data.segmentCategories);
        this.segmentsSaved.set(true);
        setTimeout(() => this.segmentsSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save segment settings.');
    } finally {
      this.segmentsSaving.set(false);
    }
  }

  // ─── Follow-up settings ────────────────────────────────────────

  private async loadFollowUpSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ defaultFollowUpDays: number }>>(`${API}/admin/settings/follow-up`),
      );
      if (res.success) {
        this.followUpDefaultDays.set(String(res.data.defaultFollowUpDays));
      }
    } catch {
      // ignore – defaults work fine
    }
  }

  setFollowUpDefaultDays(value: string): void {
    this.followUpDefaultDays.set(value);
  }

  async saveFollowUpSettings(): Promise<void> {
    const days = parseInt(this.followUpDefaultDays(), 10);
    if (!days || days < 1 || days > 365) {
      this.showToast('error', 'Days must be between 1 and 365.');
      return;
    }
    this.followUpSaving.set(true);
    this.followUpSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ defaultFollowUpDays: number }>>(`${API}/admin/settings/follow-up`, { defaultFollowUpDays: days }),
      );
      if (res.success) {
        this.followUpDefaultDays.set(String(res.data.defaultFollowUpDays));
        this.followUpSaved.set(true);
        setTimeout(() => this.followUpSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save follow-up settings.');
    } finally {
      this.followUpSaving.set(false);
    }
  }

  // ─── Timezone settings ─────────────────────────────────────────

  private async loadTimezoneSettings(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ defaultTimezone: string | null }>>(`${API}/admin/settings/timezone`),
      );
      if (res.success) {
        this.defaultTimezone.set(res.data.defaultTimezone ?? '');
      }
    } catch {
      // ignore – defaults work fine
    }
  }

  setDefaultTimezone(value: string): void {
    this.defaultTimezone.set(value);
  }

  async saveTimezone(): Promise<void> {
    this.timezoneSaving.set(true);
    this.timezoneSaved.set(false);
    try {
      const tz = this.defaultTimezone() || null;
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ defaultTimezone: string | null }>>(`${API}/admin/settings/timezone`, { defaultTimezone: tz }),
      );
      if (res.success) {
        this.defaultTimezone.set(res.data.defaultTimezone ?? '');
        this.timezoneSaved.set(true);
        setTimeout(() => this.timezoneSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save timezone settings.');
    } finally {
      this.timezoneSaving.set(false);
    }
  }
}
