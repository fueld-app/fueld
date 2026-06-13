import {
  Component, ChangeDetectionStrategy, input, output, signal, inject, computed,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CompanyContactDto, VesselCompanyDto, VesselDto } from '@fueld/types';
import { API } from '@app/core/config/api';

interface FleetVessel {
  id: string;
  imo: string;
  name: string;
  type: string;
  status: string;
  flag: { code: string; name: string } | null;
  grossTonnage: number | null;
  deadWeightTonnage: number | null;
  buildYear: number | null;
  lengthOverall: string | null;
  breadthExtreme: string | null;
  draught: string | null;
  hasSanctions: boolean;
  owners: Array<{ type: string; typeCode: string; companyId: string; companyName: string }>;
  destination: { place: { id: string; name: string }; country: { code: string; name: string }; eta: string } | null;
}

interface FleetResponse {
  results: FleetVessel[];
  totalMatches: number;
}

interface GroupVesselRow {
  id: string;
  vesselId: string;
  localVesselId: string | null;
  seasearcherVesselId: string | null;
  vesselName: string;
  vesselImo: string | null;
  companyName: string;
  role: string;
  source: string | null;
}

type VesselCompanyRole = import('@fueld/types').VesselCompanyRole;

interface VesselSearchResultOption {
  key: string;
  source: 'local' | 'seasearcher';
  id?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
}

interface VesselSearchResult {
  source: 'local' | 'seasearcher';
  seasearcherId?: string;
  id?: string;
  name: string;
  imo?: string | null;
}

@Component({
  selector: 'app-fleet-table-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-[17] min-[900px]:col-span-2">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-gray-700">Fleet</h2>
          @if (isParent()) {
            <div class="flex gap-1">
              <button (click)="modeToggle.emit()"
                class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
                [class]="mode() === 'own' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
              >Own</button>
              <button (click)="modeToggle.emit()"
                class="rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors"
                [class]="mode() === 'group' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
              >Group</button>
            </div>
          }
        </div>
        <div class="flex items-center gap-2">
          @if (totalMatches(); as totalMatches) {
            <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {{ totalMatches }} vessels
            </span>
          }
          @if (limitNotice(); as notice) {
            <span class="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                  [title]="'Showing first ' + notice.queried + ' of ' + notice.total + ' linked companies in group map mode'">
              {{ notice.queried }}/{{ notice.total }} companies
            </span>
          }
          <button (click)="openAdd()"
            class="rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors">
            + Add manual
          </button>
        </div>
      </div>

      @if (mode() === 'own') {
        @if (showForm()) {
          <div class="border-b border-gray-100 px-5 py-4 bg-gray-50/50">
            <div class="space-y-2">
              @if (!editingId()) {
                <div class="relative">
                  @if (selectedVessel()) {
                    <div class="flex items-center justify-between rounded-md border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm">
                      <span class="font-medium text-brand-800">{{ selectedVessel()!.name }}</span>
                      <button (click)="clearSelectedVessel()"
                        class="ml-2 text-brand-400 hover:text-brand-600 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  } @else {
                    <input [ngModel]="vesselSearch()" (ngModelChange)="onVesselSearch($event)"
                      placeholder="Search vessel..."
                      class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500" />
                    @if (vesselSearchResults().length) {
                      <div class="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                        @for (v of vesselSearchResults(); track v.key) {
                          <button (click)="selectVessel(v)"
                            class="w-full px-3 py-2 text-left text-sm hover:bg-brand-50 transition-colors flex items-center justify-between">
                            <span class="font-medium text-gray-900">{{ v.name }}</span>
                            @if (v.source === 'seasearcher') {
                              <span class="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Import</span>
                            } @else if (v.imo) {
                              <span class="text-xs text-gray-400">IMO {{ v.imo }}</span>
                            }
                          </button>
                        }
                      </div>
                    }
                  }
                </div>
              }

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select [ngModel]="form().role" (ngModelChange)="form.set({ ...form(), role: $event })"
                  class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                  @for (grp of roleGroups(); track grp.group) {
                    <optgroup [label]="grp.group">
                      @for (role of grp.roles; track role.key) {
                        <option [ngValue]="role.key">{{ role.label }}</option>
                      }
                    </optgroup>
                  }
                </select>
              </div>

              @if (!editingId() && selectedVessel() && selectedVesselRoleExists()) {
                <div class="text-[11px] text-amber-600">This vessel already has that role.</div>
              }

              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Contact Person</label>
                @if (contactsLoading()) {
                  <div class="text-xs text-gray-400 py-1">Loading contacts...</div>
                } @else if (contacts().length) {
                  <select [ngModel]="form().contactId" (ngModelChange)="form.set({ ...form(), contactId: $event || null })"
                    class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                    <option [ngValue]="null">— None —</option>
                    @for (ct of contacts(); track ct.id) {
                      <option [ngValue]="ct.id">{{ ct.name }}{{ ct.role ? ' (' + ct.role + ')' : '' }}</option>
                    }
                  </select>
                } @else {
                  <div class="text-xs text-gray-400 py-1">No contacts on file</div>
                }
              </div>

              <textarea [ngModel]="form().note" (ngModelChange)="form.set({ ...form(), note: $event })"
                placeholder="Notes" rows="2"
                class="w-full rounded-md border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              ></textarea>
              <div class="flex justify-end gap-2">
                <button (click)="cancelForm()"
                  class="rounded-md border border-gray-200 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button (click)="save()"
                  [disabled]="saving() || (!editingId() && !selectedVessel())"
                  class="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  {{ editingId() ? 'Update' : 'Add' }}
                </button>
              </div>
            </div>
          </div>
        }

        @if (fleetLoading() || vesselsLoading()) {
          <div class="flex items-center justify-center py-8">
            <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if ((fleet()?.results?.length || manualRows().length)) {
          <div class="overflow-auto max-h-[500px]">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10">
                <tr class="border-b border-gray-100 bg-gray-50">
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Vessel</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Type</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Flag</th>
                  <th class="px-5 py-2 text-right font-medium text-gray-500">DWT</th>
                  <th class="px-5 py-2 text-right font-medium text-gray-500">GT</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Built</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Destination</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Status</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Link</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                @if (fleet()?.results?.length) {
                  @for (v of fleet()!.results; track v.id) {
                    <tr class="hover:bg-gray-50/50 transition-colors">
                      <td class="px-5 py-2.5">
                        <button (click)="navigateToVessel.emit(v.id); $event.stopPropagation()"
                          [disabled]="navigatingVesselId() === v.id"
                          class="font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                        >
                          @if (navigatingVesselId() === v.id) {
                            <svg class="inline h-3 w-3 animate-spin mr-0.5" viewBox="0 0 24 24" fill="none">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                          {{ v.name }}
                        </button>
                        <span class="ml-1 text-xs text-gray-400">{{ v.imo }}</span>
                        @if (v.hasSanctions) {
                          <span class="ml-1 text-xs text-red-600">⚠️</span>
                        }
                        @if (linkedRoles(v).length) {
                          <div class="mt-1 flex flex-wrap gap-1">
                            @for (role of linkedRoles(v); track role) {
                              <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ formatRole(role) }}</span>
                            }
                          </div>
                        }
                      </td>
                      <td class="px-5 py-2.5 text-gray-600 capitalize">{{ v.type || '—' }}</td>
                      <td class="px-5 py-2.5 text-gray-600">{{ v.flag?.name ?? '—' }}</td>
                      <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">{{ v.deadWeightTonnage ? v.deadWeightTonnage.toLocaleString() : '—' }}</td>
                      <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">{{ v.grossTonnage ? v.grossTonnage.toLocaleString() : '—' }}</td>
                      <td class="px-5 py-2.5 text-gray-600">{{ v.buildYear ?? '—' }}</td>
                      <td class="px-5 py-2.5 text-gray-600">
                        @if (v.destination?.place) { {{ v.destination!.place!.name }} } @else { — }
                      </td>
                      <td class="px-5 py-2.5">
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="v.status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
                          {{ v.status }}
                        </span>
                      </td>
                      <td class="px-5 py-2.5">
                        <div class="flex items-center gap-2">
                          @if (isAutoMatch(v)) {
                            <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">Registered Owner</span>
                            <span class="ml-2 inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Auto</span>
                          } @else {
                            <select [ngModel]="fleetRoleFor(v)" (ngModelChange)="fleetRoleChange.emit({ vessel: v, role: $event })"
                              class="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
                              @for (grp of roleGroups(); track grp.group) {
                                <optgroup [label]="grp.group">
                                  @for (role of grp.roles; track role.key) {
                                    <option [ngValue]="role.key">{{ role.label }}</option>
                                  }
                                </optgroup>
                              }
                            </select>
                            <span class="text-[11px] text-gray-400">
                              @if (linkingFleetKey() === rowKey(v)) { Linking… } @else { {{ fleetLinkLabel(v) }} }
                            </span>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                }
                @for (vc of manualRows(); track vc.id) {
                  <tr class="hover:bg-gray-50/50 transition-colors">
                    <td class="px-5 py-2.5">
                      <a [routerLink]="['/vessels', vc.vesselId]" class="font-medium text-brand-700 hover:text-brand-900 hover:underline">
                        {{ vc.vesselName ?? 'Unknown vessel' }}
                      </a>
                      @if (vc.vesselImo) {
                        <span class="ml-1 text-xs text-gray-400">{{ vc.vesselImo }}</span>
                      }
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ formatRole(vc.role) }}</span>
                        <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
                      </div>
                    </td>
                    <td class="px-5 py-2.5 text-gray-600">—</td>
                    <td class="px-5 py-2.5 text-gray-600">—</td>
                    <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">—</td>
                    <td class="px-5 py-2.5 text-right text-gray-600 font-mono text-xs">—</td>
                    <td class="px-5 py-2.5 text-gray-600">—</td>
                    <td class="px-5 py-2.5 text-gray-600">—</td>
                    <td class="px-5 py-2.5">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Manual</span>
                    </td>
                    <td class="px-5 py-2.5">
                      <div class="flex items-center gap-1">
                        <button (click)="openEditManual(vc)"
                          class="rounded p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" title="Edit">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                          </svg>
                        </button>
                        <button (click)="deleteVesselAssoc.emit({ vesselId: vc.vesselId, assocId: vc.id, vesselName: vc.vesselName, role: vc.role })"
                          class="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Delete Association">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No vessels added yet</div>
        }
      }

      @if (mode() === 'group') {
        @if (groupVesselsLoading()) {
          <div class="flex items-center justify-center py-8">
            <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (groupVessels().length) {
          <div class="overflow-auto max-h-[500px]">
            <table class="w-full text-sm">
              <thead class="sticky top-0 z-10">
                <tr class="border-b border-gray-100 bg-gray-50">
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Client</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Vessel</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Role</th>
                  <th class="px-5 py-2 text-left font-medium text-gray-500">Source</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-50">
                @for (v of groupVessels(); track v.id) {
                  <tr class="hover:bg-gray-50/50 transition-colors">
                    <td class="px-5 py-2.5 text-gray-700">{{ v.companyName }}</td>
                    <td class="px-5 py-2.5">
                      @if (v.localVesselId || v.seasearcherVesselId) {
                        <button type="button" (click)="openGroupVessel.emit(v)"
                          [disabled]="navigatingVesselId() === (v.seasearcherVesselId || v.localVesselId)"
                          class="font-medium text-brand-600 hover:text-brand-800 hover:underline text-left disabled:opacity-50"
                        >
                          @if (navigatingVesselId() === (v.seasearcherVesselId || v.localVesselId)) {
                            <svg class="inline h-3 w-3 animate-spin mr-0.5" viewBox="0 0 24 24" fill="none">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                          {{ v.vesselName }}
                        </button>
                      } @else {
                        <span class="font-medium text-gray-900">{{ v.vesselName }}</span>
                      }
                      @if (v.vesselImo) {
                        <span class="ml-1 text-xs text-gray-400">{{ v.vesselImo }}</span>
                      }
                    </td>
                    <td class="px-5 py-2.5 text-gray-600">{{ formatRole(v.role) }}</td>
                    <td class="px-5 py-2.5">
                      <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                        [class]="v.source === 'manual' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'">
                        {{ v.source || 'linked' }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="px-5 py-6 text-center text-sm text-gray-400">No vessels in group</div>
        }
      }
    </div>
  `,
})
export class FleetTableCardComponent {
  private readonly http = inject(HttpClient);

  readonly companyId = input.required<string>();
  readonly isParent = input<boolean>(false);
  readonly contacts = input<CompanyContactDto[]>([]);
  readonly contactsLoading = input<boolean>(false);
  readonly mode = input<'own' | 'group'>('own');
  readonly fleet = input<FleetResponse | null>(null);
  readonly fleetLoading = input<boolean>(false);
  readonly vesselsLoading = input<boolean>(false);
  readonly groupVessels = input<GroupVesselRow[]>([]);
  readonly groupVesselsLoading = input<boolean>(false);
  readonly companyVessels = input<VesselCompanyDto[]>([]);
  readonly fleetMatchBySeasearcherId = input<Record<string, VesselDto>>({});
  readonly fleetMatchByImo = input<Record<string, VesselDto>>({});
  readonly fleetRoleSelections = input<Record<string, VesselCompanyRole>>({});
  readonly linkingFleetKey = input<string | null>(null);
  readonly totalMatches = input<number | null>(null);
  readonly limitNotice = input<{ queried: number; total: number; max: number } | null>(null);
  readonly navigatingVesselId = input<string | null>(null);

  readonly modeToggle = output<void>();
  readonly mutated = output<void>();
  readonly fleetRoleChange = output<{ vessel: FleetVessel; role: VesselCompanyRole }>();
  readonly navigateToVessel = output<string>();
  readonly openGroupVessel = output<GroupVesselRow>();
  readonly deleteVesselAssoc = output<{ vesselId?: string | null; assocId: string; vesselName?: string | null; role?: string }>();

  readonly showForm = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<{ vesselId: string; role: VesselCompanyRole; contactId: string | null; note: string }>({
    vesselId: '', role: 'REGISTERED_OWNER', contactId: null, note: '',
  });
  readonly saving = signal(false);
  readonly vesselSearch = signal('');
  readonly vesselSearchResults = signal<VesselSearchResultOption[]>([]);
  readonly selectedVessel = signal<{ id: string; name: string } | null>(null);
  private vesselSearchTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly roleOptions = signal([
    { key: 'REGISTERED_OWNER' as VesselCompanyRole, label: 'Registered Owner', group: 'Legal & Financial' },
    { key: 'NOMINAL_OWNER' as VesselCompanyRole, label: 'Nominal Owner', group: 'Legal & Financial' },
    { key: 'BENEFICIAL_OWNER' as VesselCompanyRole, label: 'Beneficial Owner', group: 'Legal & Financial' },
    { key: 'GROUP_BENEFICIAL_OWNER' as VesselCompanyRole, label: 'Group Beneficial Owner', group: 'Legal & Financial' },
    { key: 'COMMERCIAL_OPERATOR' as VesselCompanyRole, label: 'Commercial Operator', group: 'Operational & Commercial' },
    { key: 'THIRD_PARTY_OPERATOR' as VesselCompanyRole, label: 'Third-Party Operator', group: 'Operational & Commercial' },
    { key: 'DISPONENT_OWNER' as VesselCompanyRole, label: 'Disponent Owner', group: 'Operational & Commercial' },
    { key: 'BAREBOAT_CHARTERER' as VesselCompanyRole, label: 'Bareboat Charterer', group: 'Operational & Commercial' },
    { key: 'TECHNICAL_MANAGER' as VesselCompanyRole, label: 'Technical Manager', group: 'Technical & Safety' },
    { key: 'ISM_MANAGER' as VesselCompanyRole, label: 'ISM Manager', group: 'Technical & Safety' },
    { key: 'SHIP_MANAGER' as VesselCompanyRole, label: 'Ship Manager', group: 'Technical & Safety' },
  ]);

  readonly roleGroups = computed(() => {
    const groups = new Map<string, { key: VesselCompanyRole; label: string; group: string }[]>();
    for (const opt of this.roleOptions()) {
      if (!groups.has(opt.group)) groups.set(opt.group, []);
      groups.get(opt.group)!.push(opt);
    }
    return [...groups.entries()].map(([group, roles]) => ({ group, roles }));
  });

  readonly manualRows = computed(() => {
    const fleetResults = this.fleet()?.results ?? [];
    const matchedIds = new Set(
      fleetResults
        .map((v) => this.localMatch(v)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    return this.companyVessels().filter((vc) => !matchedIds.has(vc.vesselId));
  });

  openAdd(): void {
    this.form.set({ vesselId: '', role: 'REGISTERED_OWNER', contactId: null, note: '' });
    this.editingId.set(null);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
    this.showForm.set(true);
  }

  openEditManual(vc: VesselCompanyDto): void {
    this.form.set({ vesselId: vc.vesselId, role: vc.role as VesselCompanyRole, contactId: vc.contactId ?? null, note: vc.note ?? '' });
    this.editingId.set(vc.id);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
    this.showForm.set(true);
  }

  cancelForm(): void {
    this.showForm.set(false);
    this.editingId.set(null);
    this.selectedVessel.set(null);
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
  }

  onVesselSearch(term: string): void {
    this.vesselSearch.set(term);
    if (this.vesselSearchTimeout) clearTimeout(this.vesselSearchTimeout);
    if (term.length < 2) { this.vesselSearchResults.set([]); return; }
    this.vesselSearchTimeout = setTimeout(async () => {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(`${API}/vessels/local?search=${encodeURIComponent(term)}&limit=15`),
        );
        const localResults = res.success && res.data ? res.data.vessels : [];
        if (localResults.length) {
          this.vesselSearchResults.set(localResults.map((v) => ({ key: v.id, source: 'local' as const, id: v.id, name: v.name, imo: v.imo ?? undefined })));
          return;
        }
        const importRes = await firstValueFrom(
          this.http.get<ApiResponse<VesselSearchResult[]>>(`${API}/vessels/search?term=${encodeURIComponent(term)}`),
        );
        if (importRes.success && importRes.data) {
          this.vesselSearchResults.set(
            importRes.data
              .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
              .map((r) => ({ key: `seasearcher:${r.seasearcherId}`, source: 'seasearcher' as const, seasearcherId: r.seasearcherId, name: r.name, imo: r.imo ?? undefined })),
          );
        } else {
          this.vesselSearchResults.set([]);
        }
      } catch {
        this.vesselSearchResults.set([]);
      }
    }, 250);
  }

  async selectVessel(v: VesselSearchResultOption): Promise<void> {
    if (v.source === 'seasearcher' && v.seasearcherId) {
      try {
        const res = await firstValueFrom(this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId: v.seasearcherId }));
        if (res.success && res.data) {
          this.selectedVessel.set({ id: res.data.id, name: res.data.name });
          this.form.set({ ...this.form(), vesselId: res.data.id });
          this.vesselSearch.set('');
          this.vesselSearchResults.set([]);
        }
      } catch {
        // ignore
      }
      return;
    }
    if (!v.id) return;
    this.selectedVessel.set({ id: v.id, name: v.name });
    this.form.set({ ...this.form(), vesselId: v.id });
    this.vesselSearch.set('');
    this.vesselSearchResults.set([]);
  }

  clearSelectedVessel(): void {
    this.selectedVessel.set(null);
    this.form.set({ ...this.form(), vesselId: '' });
    this.vesselSearch.set('');
  }

  selectedVesselRoleExists(): boolean {
    const selected = this.selectedVessel();
    if (!selected) return false;
    return this.companyVessels().some((vc) => vc.vesselId === selected.id && vc.role === this.form().role);
  }

  async save(): Promise<void> {
    const form = this.form();
    this.saving.set(true);
    try {
      const editId = this.editingId();
      if (editId) {
        await firstValueFrom(
          this.http.patch(`${API}/vessels/local/${form.vesselId}/companies/${editId}`, {
            role: form.role, contactId: form.contactId, note: form.note.trim() || undefined,
          }),
        );
      } else {
        if (!form.vesselId) return;
        const replaceExistingRole = this.selectedVesselRoleExists()
          ? window.confirm('This role already exists for this vessel. Replace the existing one?')
          : false;
        if (this.selectedVesselRoleExists() && !replaceExistingRole) return;
        await firstValueFrom(
          this.http.post(`${API}/vessels/local/${form.vesselId}/companies`, {
            companyId: this.companyId(), role: form.role, contactId: form.contactId,
            note: form.note.trim() || undefined, replaceExistingRole: replaceExistingRole || undefined,
          }),
        );
      }
      this.cancelForm();
      this.mutated.emit();
    } catch (err) {
      console.error('Failed to save company vessel:', err);
    } finally {
      this.saving.set(false);
    }
  }

  localMatch(v: FleetVessel): VesselDto | null {
    if (v.id) {
      const bySea = this.fleetMatchBySeasearcherId()[String(v.id)];
      if (bySea) return bySea;
    }
    if (v.imo) {
      const byImo = this.fleetMatchByImo()[String(v.imo)];
      if (byImo) return byImo;
    }
    return null;
  }

  linkedRoles(v: FleetVessel): string[] {
    const match = this.localMatch(v);
    if (!match) return [];
    const roles = this.companyVessels()
      .filter((vc) => vc.vesselId === match.id)
      .map((vc) => vc.role);
    return Array.from(new Set(roles));
  }

  isAutoMatch(v: FleetVessel): boolean {
    return Boolean(v.id);
  }

  rowKey(v: FleetVessel): string {
    if (v.id) return `sea:${v.id}`;
    if (v.imo) return `imo:${v.imo}`;
    return `name:${v.name}`;
  }

  fleetRoleFor(v: FleetVessel): VesselCompanyRole {
    return this.fleetRoleSelections()[this.rowKey(v)] ?? 'REGISTERED_OWNER';
  }

  fleetLinkLabel(v: FleetVessel): string {
    const match = this.localMatch(v);
    const role = this.fleetRoleFor(v);
    if (match && this.companyVessels().some((vc) => vc.vesselId === match.id && vc.role === role)) {
      return this.isAutoMatch(v) ? 'Replace Reg. Owner' : 'Linked';
    }
    if (!match) return 'Import + Link';
    return this.companyVessels().some((vc) => vc.vesselId === match.id) ? 'Add Role' : 'Link';
  }

  formatRole(role: string): string {
    return this.roleOptions().find((r) => r.key === role)?.label ?? role.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  }
}
