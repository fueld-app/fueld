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
import type { ApiResponse, OrderNumberSettingsDto, VesselCompanyRoleSettingsDto, VesselCompanyRoleOption, ProductSettingsDto, UnitSettingsDto, CurrencySettingsDto, CompanyTypeSettingsDto, AttachmentTypeSettingsDto, InquiryCancelReasonSettingsDto } from '@fueld/types';

import { API } from '@app/core/config/api';

interface InquirySettingsDto {
  supplierResponseUrlEnabled: boolean;
  autoMarkNoReplyAfterHours: number | null;
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
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm4.75 6.75a.75.75 0 00-1.5 0v2.546l-.943-1.048a.75.75 0 00-1.114 1.004l2.25 2.5a.75.75 0 001.114 0l2.25-2.5a.75.75 0 10-1.114-1.004l-.943 1.048V8.75z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Order Number Format</h3>
                <p class="text-xs text-gray-500">Configure the format used for external order/inquiry numbers.</p>
              </div>
            </div>

            <div class="p-6 space-y-5">

              <!-- Prefix -->
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Prefix (optional)</label>
                <input
                  type="text"
                  [ngModel]="prefix()"
                  (ngModelChange)="prefix.set($event)"
                  placeholder="e.g. FU-"
                  class="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                  class="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono
                         focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <!--  Product Options                                        -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M5 2a2 2 0 00-2 2v14l3.5-2 3.5 2 3.5-2 3.5 2V4a2 2 0 00-2-2H5zm4.707 3.707a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L8.414 9H10a3 3 0 013 3v1a1 1 0 102 0v-1a5 5 0 00-5-5H8.414l1.293-1.293z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Products</h3>
                <p class="text-xs text-gray-500">Configure which products appear in order line item dropdowns.</p>
              </div>
            </div>

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 2a.75.75 0 01.75.75v.258a33.186 33.186 0 016.668.83.75.75 0 01-.336 1.461 31.28 31.28 0 00-1.103-.232l1.702 7.545a.75.75 0 01-.387.832A4.981 4.981 0 0115 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.77-7.849a31.743 31.743 0 00-3.339-.254v11.505a20.01 20.01 0 013.78.501.75.75 0 11-.339 1.462A18.558 18.558 0 0010 17.5c-1.442 0-2.845.165-4.191.477a.75.75 0 01-.338-1.462 20.01 20.01 0 013.779-.501V4.509c-1.129.026-2.243.112-3.34.254l1.771 7.85a.75.75 0 01-.387.83A4.981 4.981 0 015 14c-.825 0-1.606-.2-2.294-.556a.75.75 0 01-.387-.832l1.702-7.545c-.372.06-.742.126-1.103.232a.75.75 0 11-.336-1.462 33.186 33.186 0 016.668-.829V2.75A.75.75 0 0110 2zM5 12.662l-1.395-6.177C4.6 6.327 5.597 6.2 6 6.2c.404 0 1.4.127 2.395.285L5 12.662zm8.395-6.177L15 12.662l1.395-6.177C14.6 6.327 13.597 6.2 13.2 6.2c-.404 0-1.4.127-2.395.285z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Units</h3>
                <p class="text-xs text-gray-500">Configure which measurement units appear in order line item dropdowns.</p>
              </div>
            </div>

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <!--  Currency Options                                       -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50">
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

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-violet-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Company Types</h3>
                <p class="text-xs text-gray-500">Configure which types can be assigned to companies (e.g. Client, Supplier).</p>
              </div>
            </div>

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
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

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <!--  Supplier Inquiry Settings                              -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-sky-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 4.75A2.75 2.75 0 0 1 6.75 2h10.5A2.75 2.75 0 0 1 20 4.75v10.5A2.75 2.75 0 0 1 17.25 18H9.56l-4.78 3.52A.75.75 0 0 1 3.6 20.9V18.8A2.75 2.75 0 0 1 2 16.25V4.75A2.75 2.75 0 0 1 4.75 2Zm2.75 1.5a1.25 1.25 0 0 0-1.25 1.25v7.95c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V7.5c0-.69-.56-1.25-1.25-1.25H6.75Z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Supplier Inquiry Settings</h3>
                <p class="text-xs text-gray-500">Control supplier response links and automatic no-reply handling for inquiries.</p>
              </div>
            </div>

            <div class="p-6">
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
                        class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
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
            </div>
          </div>

          <!-- ════════════════════════════════════════════════════════ -->
          <!--  Inquiry Cancel Reasons                                 -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-rose-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.53-10.53a.75.75 0 0 0-1.06-1.06L10 8.94 7.53 6.47a.75.75 0 0 0-1.06 1.06L8.94 10l-2.47 2.47a.75.75 0 1 0 1.06 1.06L10 11.06l2.47 2.47a.75.75 0 0 0 1.06-1.06L11.06 10l2.47-2.47Z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Inquiry Cancel Reasons</h3>
                <p class="text-xs text-gray-500">Configure selectable reasons required when cancelling an inquiry.</p>
              </div>
            </div>

            <div class="p-6 space-y-3">
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
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                         hover:bg-brand-700 disabled:opacity-50 transition-colors"
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
          <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-[900px]:col-span-2">
            <div class="flex items-center gap-4 border-b border-gray-100 px-6 py-4">
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Vessel–Company Roles</h3>
                <p class="text-xs text-gray-500">Configure the available role options when linking companies to vessels.</p>
              </div>
            </div>

            <div class="p-6 space-y-4">
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
                        class="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono uppercase
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                      <input
                        type="text"
                        [value]="role.label"
                        (input)="updateRoleLabel(i, $any($event.target).value)"
                        placeholder="Label"
                        class="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                      <select
                        [value]="role.group"
                        (change)="updateRoleGroup(i, $any($event.target).value)"
                        class="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
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
                  class="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
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
                    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm
                           hover:bg-brand-700 disabled:opacity-50 transition-colors"
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

  // Inquiry cancellation reasons
  readonly inquiryCancelReasons = signal<string[]>([]);
  readonly inquiryCancelReasonsSaving = signal(false);
  readonly inquiryCancelReasonsSaved = signal(false);
  readonly inquiryResponseUrlEnabled = signal(true);
  readonly inquiryAutoNoReplyEnabled = signal(true);
  readonly inquiryAutoNoReplyHours = signal('168');
  readonly inquirySaving = signal(false);
  readonly inquirySaveSuccess = signal('');
  readonly inquirySaveError = signal('');

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
    this.loadCurrencies();
    this.loadCompanyTypes();
    this.loadAttachmentTypes();
    this.loadInquirySettings();
    this.loadInquiryCancelReasons();
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
}
