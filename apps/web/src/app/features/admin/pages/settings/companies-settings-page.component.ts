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
  VesselCompanyRoleSettingsDto,
  VesselCompanyRoleOption,
  CompanyTypeSettingsDto,
  VesselTypeSettingsDto,
} from '@fueld/types';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-companies-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Company & Vessel Settings</h1>
        <p class="mt-1 text-sm text-gray-500">
          Configure company types, segmentation, vessel–company roles, and vessel types.
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

            <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
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
          <!--  Vessel Types                                           -->
          <!-- ════════════════════════════════════════════════════════ -->
          <div class="app-panel">
            <div class="app-panel-header app-panel-header--teal">
              <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--teal">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-teal-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-sm font-semibold text-gray-900">Vessel Types</h3>
                <p class="text-xs text-gray-500">Configure which vessel types appear in vessel dropdowns.</p>
              </div>
            </div>

            <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
              @for (vt of vesselTypes(); track $index; let i = $index) {
                <div class="flex items-center gap-2">
                  <div class="flex flex-col gap-0.5 shrink-0">
                    <button (click)="moveVesselTypeUp(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
                    </button>
                    <button (click)="moveVesselTypeDown(i)" [disabled]="i === vesselTypes().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                    </button>
                  </div>
                  <input
                    type="text"
                    [value]="vt"
                    (input)="updateVesselType(i, $any($event.target).value)"
                    class="app-input-mono-uppercase flex-1"
                  />
                  <button
                    (click)="removeVesselType(i)"
                    [disabled]="vesselTypes().length <= 1"
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
                (click)="addVesselType()"
                class="app-button-add"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add Type
              </button>

              <div class="flex items-center gap-3 pt-2">
                <button
                  (click)="saveVesselTypes()"
                  [disabled]="vesselTypesSaving()"
                  class="app-button-primary"
                >
                  @if (vesselTypesSaving()) { Saving… } @else { Save Types }
                </button>
                @if (vesselTypesSaved()) {
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
          <div class="app-panel min-[900px]:col-span-2 flex flex-col">
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

            <div class="app-panel-body space-y-4 flex-1 min-h-0 overflow-y-auto">
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
export class CompaniesSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(true);
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // Company Types
  readonly companyTypes = signal<string[]>([]);
  readonly companyTypesSaving = signal(false);
  readonly companyTypesSaved = signal(false);

  // Vessel Types
  readonly vesselTypes = signal<string[]>([]);
  readonly vesselTypesSaving = signal(false);
  readonly vesselTypesSaved = signal(false);

  // Vessel-Company Roles
  readonly rolesLoading = signal(false);
  readonly rolesSaving = signal(false);
  readonly rolesSaved = signal(false);
  readonly roles = signal<VesselCompanyRoleOption[]>([]);

  // Company Segmentation
  readonly segmentCategories = signal<
    {
      key: string;
      label: string;
      mode: 'multi' | 'single';
      options: { key: string; label: string; description?: string }[];
    }[]
  >([]);
  readonly segmentsSaving = signal(false);
  readonly segmentsSaved = signal(false);

  ngOnInit(): void {
    this.loadCompanyTypes();
    this.loadVesselTypes();
    this.loadRoles();
    this.loadSegments();
  }

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
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
    } finally {
      this.loading.set(false);
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
    const valid = this.companyTypes().filter((ct) => ct.trim());
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

  // ─── Vessel Types ──────────────────────────────────────────────────

  private async loadVesselTypes(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselTypeSettingsDto>>(`${API}/admin/settings/vessel-types`),
      );
      if (res.success) this.vesselTypes.set(res.data.vesselTypes);
    } catch {
      this.showToast('error', 'Failed to load vessel types.');
    }
  }

  updateVesselType(index: number, value: string): void {
    const updated = [...this.vesselTypes()];
    updated[index] = value.toUpperCase();
    this.vesselTypes.set(updated);
  }

  addVesselType(): void {
    this.vesselTypes.set([...this.vesselTypes(), '']);
  }

  removeVesselType(index: number): void {
    this.vesselTypes.set(this.vesselTypes().filter((_, i) => i !== index));
  }

  moveVesselTypeUp(index: number): void {
    if (index <= 0) return;
    const updated = [...this.vesselTypes()];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    this.vesselTypes.set(updated);
  }

  moveVesselTypeDown(index: number): void {
    const arr = this.vesselTypes();
    if (index >= arr.length - 1) return;
    const updated = [...arr];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    this.vesselTypes.set(updated);
  }

  async saveVesselTypes(): Promise<void> {
    const valid = this.vesselTypes().filter((vt) => vt.trim());
    if (valid.length === 0) {
      this.showToast('error', 'At least one vessel type is required.');
      return;
    }
    this.vesselTypesSaving.set(true);
    this.vesselTypesSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<VesselTypeSettingsDto>>(`${API}/admin/settings/vessel-types`, { vesselTypes: valid }),
      );
      if (res.success) {
        this.vesselTypes.set(res.data.vesselTypes);
        this.vesselTypesSaved.set(true);
        setTimeout(() => this.vesselTypesSaved.set(false), 3000);
      } else {
        this.showToast('error', (res as any).message ?? 'Failed to save.');
      }
    } catch {
      this.showToast('error', 'Failed to save vessel types.');
    } finally {
      this.vesselTypesSaving.set(false);
    }
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
    const valid = this.roles().filter((r) => r.key && r.label);
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

  // ─── Company Segmentation ─────────────────────────────────────────

  private async loadSegments(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<
          ApiResponse<{
            segmentCategories: {
              key: string;
              label: string;
              mode: 'multi' | 'single';
              options: { key: string; label: string; description?: string }[];
            }[];
          }>
        >(`${API}/admin/settings/segment-settings`),
      );
      if (res.success) this.segmentCategories.set(res.data.segmentCategories);
    } catch {
      this.showToast('error', 'Failed to load segment settings.');
    }
  }

  private generateKey(label: string): string {
    return (
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || `item_${Date.now()}`
    );
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
      i === catIndex
        ? { ...c, label, key: c.key.startsWith('category_') ? this.generateKey(label) : c.key }
        : c,
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
        oi === optIndex
          ? { ...o, label, key: o.key.startsWith('option_') ? this.generateKey(label) : o.key }
          : o,
      );
      return { ...c, options };
    });
    this.segmentCategories.set(cats);
  }

  async saveSegments(): Promise<void> {
    const cats = this.segmentCategories().filter(
      (c) => c.label.trim() && c.options.some((o) => o.label.trim()),
    );
    if (cats.length === 0) {
      this.showToast('error', 'At least one category with one option is required.');
      return;
    }
    // Clean empty options
    const cleaned = cats.map((c) => ({
      ...c,
      label: c.label.trim(),
      options: c.options
        .filter((o) => o.label.trim())
        .map((o) => ({ ...o, label: o.label.trim() })),
    }));

    this.segmentsSaving.set(true);
    this.segmentsSaved.set(false);
    try {
      const res = await firstValueFrom(
        this.http.put<
          ApiResponse<{
            segmentCategories: typeof cleaned;
          }>
        >(`${API}/admin/settings/segment-settings`, { segmentCategories: cleaned }),
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
}
