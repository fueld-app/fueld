import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { SearchableDropdownComponent, type DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import type { ApiResponse, CounterpartyDto, VesselDto, PlaceDto, CreditLineDto } from '@fueld/types';
import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';

interface CompanySearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  country?: string;
}

interface VesselSearchResult {
  source: 'local' | 'seasearcher';
  localId?: string;
  seasearcherId?: string;
  name: string;
  imo?: string;
}

interface LliSearchResult {
  source: 'local' | 'lloyds';
  localId?: string;
  lliPlaceId?: string;
  name: string;
  country?: string;
}

@Component({
  selector: 'app-inquiries-list-new-inquiry-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SearchableDropdownComponent],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div class="w-full max-w-lg rounded-2xl bg-white dark:bg-surface shadow-2xl" role="dialog" aria-modal="true">
          <div class="flex items-center justify-between border-b border-gray-200 dark:border-line px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-ink">New Inquiry</h2>
            <button
              (click)="close.emit()"
              class="rounded-md p-1 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <div class="space-y-4 px-6 py-5">
            <!-- Client -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">Client</label>
              <app-searchable-dropdown
                [options]="clientOptions()"
                [selected]="newClientId()"
                [asyncSearch]="true"
                [loading]="clientSearchLoading()"
                placeholder="Search clients..."
                (searchChange)="searchClients($event)"
                (selectionChange)="onNewClientChange($event)"
              />
              @if (auth.canSeePrices()) {
                @if (newInquiryCreditSummary()) {
                  <p class="mt-1.5 text-xs text-green-700 dark:text-green-400">
                    Credit available: {{ newInquiryCreditSummary()!.available | number : '1.2-2' }}
                    {{ newInquiryCreditSummary()!.currency }} · Max {{ newInquiryCreditSummary()!.maxDays }} days
                  </p>
                }
              } @else {
                @if (newInquiryCreditSummary()) {
                  <span class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span> Credit OK
                  </span>
                } @else {
                  <span class="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                    <span class="h-1.5 w-1.5 rounded-full bg-red-500"></span> No credit line
                  </span>
                }
              }
            </div>

            <!-- Vessel -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">Vessel</label>
              <app-searchable-dropdown
                [options]="vesselOptions()"
                [selected]="newVesselId()"
                [asyncSearch]="true"
                [loading]="vesselSearchLoading()"
                placeholder="Search vessels..."
                (searchChange)="searchVessels($event)"
                (selectionChange)="onNewVesselChange($event)"
              />
            </div>

            <!-- Port -->
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">Port</label>
              <app-searchable-dropdown
                [options]="placeOptions()"
                [selected]="newPlaceId()"
                [asyncSearch]="true"
                [loading]="placeSearchLoading()"
                placeholder="Search ports..."
                (searchChange)="searchPlaces($event)"
                (selectionChange)="onNewPlaceChange($event)"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">Responsible Trader <span class="text-gray-400 dark:text-muted font-normal">(optional)</span></label>
              <app-searchable-dropdown
                [options]="responsibleOptions()"
                [selected]="newResponsibleUserId()"
                placeholder="Select responsible trader..."
                [clearable]="true"
                (selectionChange)="newResponsibleUserId.set($event || '')"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-muted">Defaults to you if left empty. You can change Responsible later on the order detail page.</p>
            </div>

            <!-- ETA/ETD date range -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="new-eta" class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">ETA</label>
                <input
                  id="new-eta"
                  type="date"
                  [ngModel]="newEta()"
                  (ngModelChange)="onEtaChange($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>
              <div>
                <label for="new-etd" class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1.5">ETD <span class="text-gray-400 dark:text-muted font-normal">(optional)</span></label>
                <input
                  id="new-etd"
                  type="date"
                  [min]="etdMinDate()"
                  [ngModel]="newEtd()"
                  (ngModelChange)="newEtd.set($event)"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3.5 py-2.5 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                />
              </div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 border-t border-gray-200 dark:border-line px-6 py-4">
            <button
              (click)="close.emit()"
              class="rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim shadow-sm hover:bg-gray-50 dark:hover:bg-surface-tint"
            >
              Cancel
            </button>
            <button
              (click)="createInquiry()"
              [disabled]="creating() || !canCreateInquiry()"
              class="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold
                     text-white shadow-sm transition-colors hover:bg-brand-800
                     disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (creating()) {
                <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              }
              Create Inquiry
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class InquiriesListNewInquiryModalComponent {
  protected readonly auth = inject(AuthService);
  readonly open = input(false);
  readonly responsibleOptions = input<DropdownOption[]>([]);
  readonly close = output<void>();
  readonly created = output<string>();

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /* ---- form state ---- */
  readonly newClientId = signal('');
  readonly newVesselId = signal('');
  readonly newPlaceId = signal('');
  readonly newResponsibleUserId = signal('');
  readonly newEta = signal('');
  readonly newEtd = signal('');

  /* ---- loading / search ---- */
  readonly creating = signal(false);
  readonly clients = signal<CounterpartyDto[]>([]);
  readonly vesselsList = signal<VesselDto[]>([]);
  readonly placesList = signal<PlaceDto[]>([]);
  readonly selectedClient = signal<CounterpartyDto | null>(null);
  readonly selectedVessel = signal<VesselDto | null>(null);
  readonly selectedPlace = signal<PlaceDto | null>(null);
  readonly clientSearchLoading = signal(false);
  readonly vesselSearchLoading = signal(false);
  readonly placeSearchLoading = signal(false);
  readonly clientImportOptions = signal<DropdownOption[]>([]);
  readonly vesselImportOptions = signal<DropdownOption[]>([]);
  readonly placeImportOptions = signal<DropdownOption[]>([]);

  readonly clientOptions = computed<DropdownOption[]>(() => [
    ...this.clients().map((c) => ({ value: c.id, label: c.name })),
    ...this.clientImportOptions(),
  ]);

  readonly vesselOptions = computed<DropdownOption[]>(() => [
    ...this.vesselsList().map((v) => ({ value: v.id, label: v.name })),
    ...this.vesselImportOptions(),
  ]);

  readonly placeOptions = computed<DropdownOption[]>(() => [
    ...this.placesList().map((p) => ({
      value: p.id,
      label: p.unlocode ? `${p.name} (${p.unlocode.replace(/\s+/g, '')})` : p.name,
    })),
    ...this.placeImportOptions(),
  ]);

  /* ---- credit ---- */
  readonly newInquiryCreditLines = signal<CreditLineDto[]>([]);
  readonly newInquiryCreditLoading = signal(false);

  readonly newInquiryCreditSummary = computed(() => {
    const lines = this.newInquiryCreditLines();
    if (!lines.length) return null;
    const available = lines.reduce((sum, line) => sum + (parseFloat(line.availableAmount) || 0), 0);
    const maxDays = Math.max(...lines.map((line) => line.periodDays));
    const currency = lines[0]?.currency ?? 'USD';
    return { currency, available, maxDays };
  });

  /* ---- computed ---- */
  readonly etdMinDate = computed(() => this.newEta() || '');

  readonly canCreateInquiry = computed(
    () => !!this.newClientId() && !!this.newVesselId() && !!this.newPlaceId(),
  );

  /* ---- load initial data ---- */
  async loadInitialData(): Promise<void> {
    try {
      const [clientsRes, vesselsRes, placesRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API}/companies/local?type=CLIENT&limit=500`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
            `${API}/vessels/local?limit=500`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
            `${API}/lloyds/places/local?limit=500`,
          ),
        ),
      ]);
      if (clientsRes.success) this.clients.set(clientsRes.data.companies);
      if (vesselsRes.success) this.vesselsList.set(vesselsRes.data.vessels);
      if (placesRes.success) this.placesList.set(placesRes.data.places);
    } catch {
      // silently ignore — dropdowns will be empty
    }
  }

  /* ---- search ---- */
  async searchClients(term: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API}/companies/local?type=CLIENT&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.selectedClient();
      const localResults = res.success ? res.data.companies : [];
      const localMatches = current
        ? localResults.filter((c) => c.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal =
        current && !localResults.find((c) => c.id === current.id)
          ? [current, ...localResults]
          : localResults;

      if (hasLocalMatches) {
        this.clients.set(mergedLocal);
        this.clientImportOptions.set([]);
      } else {
        this.clients.set(current ? [current] : []);
        this.clientImportOptions.set(await this.loadCompanyImportOptions(term));
      }
    } catch {
      this.clientImportOptions.set([]);
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  async searchVessels(term: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
          `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.selectedVessel();
      const localResults = res.success ? res.data.vessels : [];
      const localMatches = current
        ? localResults.filter((v) => v.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal =
        current && !localResults.find((v) => v.id === current.id)
          ? [current, ...localResults]
          : localResults;

      if (hasLocalMatches) {
        this.vesselsList.set(mergedLocal);
        this.vesselImportOptions.set([]);
      } else {
        this.vesselsList.set(current ? [current] : []);
        this.vesselImportOptions.set(await this.loadVesselImportOptions(term));
      }
    } catch {
      this.vesselImportOptions.set([]);
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  async searchPlaces(term: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
          `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const current = this.selectedPlace();
      const localResults = res.success ? res.data.places : [];
      const localMatches = current
        ? localResults.filter((p) => p.id !== current.id)
        : localResults;
      const hasLocalMatches = localMatches.length > 0;
      const mergedLocal =
        current && !localResults.find((p) => p.id === current.id)
          ? [current, ...localResults]
          : localResults;

      if (hasLocalMatches) {
        this.placesList.set(mergedLocal);
        this.placeImportOptions.set([]);
      } else {
        this.placesList.set(current ? [current] : []);
        this.placeImportOptions.set(await this.loadPlaceImportOptions(term));
      }
    } catch {
      this.placeImportOptions.set([]);
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  /* ---- selection handlers ---- */
  async onNewClientChange(clientId: string): Promise<void> {
    if (!clientId) return;
    if (clientId.startsWith('seasearcher:')) {
      await this.importClientFromSeasearcher(clientId.replace('seasearcher:', ''));
      return;
    }
    const selected = this.clients().find((c) => c.id === clientId) ?? null;
    if (selected) this.selectedClient.set(selected);
    this.newClientId.set(clientId);
    void this.loadNewInquiryCreditLines(clientId);
  }

  async onNewVesselChange(vesselId: string): Promise<void> {
    if (!vesselId) return;
    if (vesselId.startsWith('seasearcher:')) {
      await this.importVesselFromSeasearcher(vesselId.replace('seasearcher:', ''));
      return;
    }
    const selected = this.vesselsList().find((v) => v.id === vesselId) ?? null;
    if (selected) this.selectedVessel.set(selected);
    this.newVesselId.set(vesselId);
  }

  async onNewPlaceChange(placeId: string): Promise<void> {
    if (!placeId) return;
    if (placeId.startsWith('lli:')) {
      await this.importPlaceFromLli(placeId.replace('lli:', ''));
      return;
    }
    const selected = this.placesList().find((p) => p.id === placeId) ?? null;
    if (selected) this.selectedPlace.set(selected);
    this.newPlaceId.set(placeId);
  }

  /** When ETA changes, clear ETD if it's now before the new ETA */
  onEtaChange(value: string): void {
    this.newEta.set(value);
    if (this.newEtd() && value && this.newEtd() < value) {
      this.newEtd.set('');
    }
  }

  /* ---- credit ---- */
  private async loadNewInquiryCreditLines(counterpartyId: string): Promise<void> {
    this.newInquiryCreditLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: CreditLineDto[]; total: number }>>(
          `${API}/credit/lines?type=CUSTOMER&counterpartyId=${encodeURIComponent(counterpartyId)}&limit=50`,
        ),
      );
      this.newInquiryCreditLines.set(res.success ? (res.data.items ?? []) : []);
    } catch {
      this.newInquiryCreditLines.set([]);
    } finally {
      this.newInquiryCreditLoading.set(false);
    }
  }

  /* ---- import ---- */
  private async loadCompanyImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanySearchResult[]>>(`${API}/companies/search?term=${encodeURIComponent(term)}`),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
        .map((r) => ({
          value: `seasearcher:${r.seasearcherId}`,
          label: `${r.name}${r.country ? ` (${r.country})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async loadVesselImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<VesselSearchResult[]>>(`${API}/vessels/search?term=${encodeURIComponent(term)}`),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'seasearcher' && r.seasearcherId)
        .map((r) => ({
          value: `seasearcher:${r.seasearcherId}`,
          label: `${r.name}${r.imo ? ` (IMO ${r.imo})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async loadPlaceImportOptions(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<LliSearchResult[]>>(`${API}/lloyds/places?name=${encodeURIComponent(term)}`),
      );
      if (!res.success || !res.data) return [];
      return res.data
        .filter((r) => r.source === 'lloyds' && r.lliPlaceId)
        .map((r) => ({
          value: `lli:${r.lliPlaceId}`,
          label: `${r.name}${r.country ? ` (${r.country})` : ''}`,
          actionLabel: 'Import',
        }));
    } catch {
      return [];
    }
  }

  private async importClientFromSeasearcher(seasearcherId: string): Promise<void> {
    this.clientSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<CounterpartyDto>>(`${API}/companies/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.clients.set([res.data, ...this.clients().filter((c) => c.id !== res.data.id)]);
        this.clientImportOptions.set([]);
        this.selectedClient.set(res.data);
        this.newClientId.set(res.data.id);
      }
    } catch {
      /* toast not available from child without output */
    } finally {
      this.clientSearchLoading.set(false);
    }
  }

  private async importVesselFromSeasearcher(seasearcherId: string): Promise<void> {
    this.vesselSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<VesselDto>>(`${API}/vessels/import`, { seasearcherId }),
      );
      if (res.success && res.data) {
        this.vesselsList.set([res.data, ...this.vesselsList().filter((v) => v.id !== res.data.id)]);
        this.vesselImportOptions.set([]);
        this.selectedVessel.set(res.data);
        this.newVesselId.set(res.data.id);
      }
    } catch {
      /* ignore */
    } finally {
      this.vesselSearchLoading.set(false);
    }
  }

  private async importPlaceFromLli(lliPlaceId: string): Promise<void> {
    this.placeSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<PlaceDto>>(`${API}/lloyds/places/import`, { lliPlaceId }),
      );
      if (res.success && res.data) {
        this.placesList.set([res.data, ...this.placesList().filter((p) => p.id !== res.data.id)]);
        this.placeImportOptions.set([]);
        this.selectedPlace.set(res.data);
        this.newPlaceId.set(res.data.id);
      }
    } catch {
      /* ignore */
    } finally {
      this.placeSearchLoading.set(false);
    }
  }

  /* ---- create ---- */
  async createInquiry(): Promise<void> {
    if (!this.canCreateInquiry()) return;
    this.creating.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/orders`, {
          clientId: this.newClientId(),
          vesselId: this.newVesselId(),
          placeId: this.newPlaceId(),
          salesRepId: this.newResponsibleUserId() || undefined,
          eta: this.newEta() || undefined,
          etd: this.newEtd() || undefined,
        }),
      );
      if (res.success) {
        this.close.emit();
        this.resetForm();
        this.created.emit(res.data.orderNumber || res.data.id);
        this.router.navigate(['/trading/inquiries', res.data.orderNumber || res.data.id]);
      }
    } catch {
      /* error displayed via parent toast */
    } finally {
      this.creating.set(false);
    }
  }

  resetForm(): void {
    this.newClientId.set('');
    this.newVesselId.set('');
    this.newPlaceId.set('');
    this.newResponsibleUserId.set('');
    this.newEta.set('');
    this.newEtd.set('');
    this.selectedClient.set(null);
    this.selectedVessel.set(null);
    this.selectedPlace.set(null);
    this.clientImportOptions.set([]);
    this.vesselImportOptions.set([]);
    this.placeImportOptions.set([]);
  }
}