import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { VesselDto } from '@fueld/types';

@Component({
  selector: 'app-vessel-info-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:h-[449px] min-[900px]:flex min-[900px]:flex-col overflow-hidden">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-1">
          <button (click)="infoTabChange.emit('info')"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            [class]="vesselInfoTab() === 'info' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'">
            Vessel Info
          </button>
          <button (click)="infoTabChange.emit('dimensions')"
            class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            [class]="vesselInfoTab() === 'dimensions' ? 'bg-brand-50 text-brand-700' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'">
            Dimensions
          </button>
        </div>
        @if (!vessel().seasearcherId && !editing()) {
          <button (click)="startEditing.emit()"
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit
          </button>
        }
        @if (editing()) {
          <div class="flex items-center gap-2">
            <button (click)="cancelEditing.emit()"
              [disabled]="editSaving()"
              class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">Cancel</button>
            <button (click)="saveEditing.emit()"
              [disabled]="editSaving()"
              class="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 transition-colors disabled:opacity-50">
              @if (editSaving()) { Saving… } @else { Save }
            </button>
          </div>
        }
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-5">
        @if (vesselInfoTab() === 'info') {
          <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt class="text-gray-500">Vessel Name</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editName()" (input)="editNameChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().name }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">IMO</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editImo()" (input)="editImoChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel().imo ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">MMSI</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editMmsi()" (input)="editMmsiChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel().mmsi ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Flag</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editFlag()" (input)="editFlagChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().flag ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Type</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <select [value]="editType()" (change)="editTypeChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100 bg-white">
                    <option value="">— Select Type —</option>
                    @for (t of vesselTypes(); track t) {
                      <option [value]="t">{{ t }}</option>
                    }
                  </select>
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 capitalize">{{ vessel().type ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Status</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editStatus()" (input)="editStatusChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5">
                  @if (vessel().status) {
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      [class]="vessel().status === 'Live' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'">
                      {{ vessel().status }}
                    </span>
                  } @else { — }
                </dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Build Year</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editBuildYear()" (input)="editBuildYearChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().buildYear ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Builder</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editBuilder()" (input)="editBuilderChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium">
                  @if (enrichment()?.['builderCompany']?.id) {
                    <button (click)="navigateToCompany.emit(enrichment()!['builderCompany'].id)" class="text-blue-700 hover:text-blue-900 hover:underline transition-colors cursor-pointer">
                      @if (navigatingCompanyId() === enrichment()!['builderCompany'].id) {
                        <span class="inline-flex items-center gap-1"><svg class="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> {{ vessel().builder }}</span>
                      } @else {
                        {{ vessel().builder }}
                      }
                    </button>
                  } @else {
                    <span class="text-gray-900">{{ vessel().builder ?? '—' }}</span>
                  }
                </dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Classification</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editClassification()" (input)="editClassificationChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().classificationSociety ?? '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Phone</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="tel" [value]="editPhone()" (input)="editPhoneChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium">
                  @if (vessel().phone) {
                    <a [href]="'tel:' + vessel().phone" class="text-brand-700 hover:text-brand-900 hover:underline transition-colors">{{ formatPhone(vessel().phone) }}</a>
                  } @else { — }
                </dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Seasearcher ID</dt>
              <dd class="mt-0.5 font-medium text-gray-900 font-mono">{{ vessel().seasearcherId ?? '—' }}</dd>
            </div>
          </dl>
        } @else {
          <dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt class="text-gray-500">LOA</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <div class="flex items-center gap-1">
                    <input type="text" [value]="editLoa()" (input)="editLoaChange.emit($any($event.target).value)"
                      class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <span class="text-gray-400 text-xs">m</span>
                  </div>
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().loa ? vessel().loa + ' m' : '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Breadth</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <div class="flex items-center gap-1">
                    <input type="text" [value]="editBreadth()" (input)="editBreadthChange.emit($any($event.target).value)"
                      class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <span class="text-gray-400 text-xs">m</span>
                  </div>
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().breadth ? vessel().breadth + ' m' : '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Depth</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <div class="flex items-center gap-1">
                    <input type="text" [value]="editDepth()" (input)="editDepthChange.emit($any($event.target).value)"
                      class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <span class="text-gray-400 text-xs">m</span>
                  </div>
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().depth ? vessel().depth + ' m' : '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Draft</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <div class="flex items-center gap-1">
                    <input type="text" [value]="editDraught()" (input)="editDraughtChange.emit($any($event.target).value)"
                      class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <span class="text-gray-400 text-xs">m</span>
                  </div>
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900">{{ vessel().draught ? vessel().draught + ' m' : '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">DWT</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editDwt()" (input)="editDwtChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-xs text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 font-mono text-xs">{{ vessel().deadWeightTonnage ? vessel().deadWeightTonnage!.toLocaleString() : '—' }}</dd>
              }
            </div>
            <div>
              <dt class="text-gray-500">Gross Tonnage</dt>
              @if (editing()) {
                <dd class="mt-0.5">
                  <input type="text" [value]="editGrossTonnage()" (input)="editGrossTonnageChange.emit($any($event.target).value)"
                    class="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium font-mono text-xs text-gray-900 focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </dd>
              } @else {
                <dd class="mt-0.5 font-medium text-gray-900 font-mono text-xs">{{ vessel().grossTonnage ? vessel().grossTonnage!.toLocaleString() : '—' }}</dd>
              }
            </div>
          </dl>
        }
      </div>
    </div>
  `,
})
export class VesselInfoCardComponent {
  readonly vessel = input.required<VesselDto>();
  readonly enrichment = input<any>(null);
  readonly vesselTypes = input<string[]>([]);
  readonly editing = input(false);
  readonly editSaving = input(false);
  readonly vesselInfoTab = input<'info' | 'dimensions'>('info');
  readonly navigatingCompanyId = input<string | null>(null);

  readonly editName = input('');
  readonly editImo = input('');
  readonly editFlag = input('');
  readonly editType = input('');
  readonly editMmsi = input('');
  readonly editStatus = input('');
  readonly editBuildYear = input('');
  readonly editBuilder = input('');
  readonly editClassification = input('');
  readonly editPhone = input('');
  readonly editLoa = input('');
  readonly editBreadth = input('');
  readonly editDepth = input('');
  readonly editDraught = input('');
  readonly editDwt = input('');
  readonly editGrossTonnage = input('');

  readonly infoTabChange = output<'info' | 'dimensions'>();
  readonly startEditing = output();
  readonly cancelEditing = output();
  readonly saveEditing = output();
  readonly navigateToCompany = output<string>();

  readonly editNameChange = output<string>();
  readonly editImoChange = output<string>();
  readonly editFlagChange = output<string>();
  readonly editTypeChange = output<string>();
  readonly editMmsiChange = output<string>();
  readonly editStatusChange = output<string>();
  readonly editBuildYearChange = output<string>();
  readonly editBuilderChange = output<string>();
  readonly editClassificationChange = output<string>();
  readonly editPhoneChange = output<string>();
  readonly editLoaChange = output<string>();
  readonly editBreadthChange = output<string>();
  readonly editDepthChange = output<string>();
  readonly editDraughtChange = output<string>();
  readonly editDwtChange = output<string>();
  readonly editGrossTonnageChange = output<string>();

  formatPhone(phone: string | null | undefined): string {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return '+1 ' + digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    if (digits.length === 11 && digits.startsWith('1')) return '+1 ' + digits.slice(1).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    return phone;
  }
}