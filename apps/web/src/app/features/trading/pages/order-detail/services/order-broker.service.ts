import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, CompanyContactDto, OrderDto } from '@fueld/types';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderBrokerService {
  private readonly http = inject(HttpClient);

  // ─── Signals ─────────────────────────────────────────────────

  readonly brokers = signal<CounterpartyDto[]>([]);
  readonly brokerSearchLoading = signal(false);
  readonly brokerContact = signal<CompanyContactDto | null>(null);
  readonly brokerContacts = signal<CompanyContactDto[]>([]);

  // ─── Computed ────────────────────────────────────────────────

  readonly brokerName = computed(() => {
    const id = this._order()?.brokerId;
    if (!id) return '—';
    return this.brokers().find((b) => b.id === id)?.name ?? '—';
  });

  readonly brokerDropdownOptions = computed<DropdownOption[]>(() =>
    this.brokers().map((b) => ({ value: b.id, label: b.name })),
  );

  readonly brokerContactDropdownOptions = computed(() =>
    this.brokerContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  // ─── External state hook (set by component) ──────────────────

  private _order = signal<OrderDto | null>(null);

  /** The component calls this whenever the order changes so computed signals stay fresh. */
  setOrder(order: OrderDto | null): void {
    this._order.set(order);
  }

  // ─── Methods ─────────────────────────────────────────────────

  async searchBrokers(term: string): Promise<void> {
    this.brokerSearchLoading.set(true);
    try {
      let res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?type=BROKER&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      let localResults = res.success ? res.data.companies : [];
      if (localResults.length === 0 && term.trim()) {
        res = await firstValueFrom(
          this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
            `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
          ),
        );
        localResults = res.success ? res.data.companies : [];
      }
      const currentId = this._order()?.brokerId ?? '';
      const mergedLocal = currentId && !localResults.find((c) => c.id === currentId)
        ? [this.brokers().find((b) => b.id === currentId) ?? null, ...localResults].filter(Boolean)
        : localResults;
      this.brokers.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.brokerSearchLoading.set(false);
    }
  }

  onBrokerChange(
    brokerId: string,
    updateOrder: (updater: (o: OrderDto) => OrderDto) => void,
    loadContacts: (companyId: string) => void,
  ): void {
    if (!brokerId) {
      updateOrder((o) => ({ ...o, brokerId: null, brokerContactId: null, brokerGetsAll: false }));
      this.brokerContact.set(null);
      this.brokerContacts.set([]);
      return;
    }
    updateOrder((o) => ({ ...o, brokerId, brokerContactId: null }));
    this.brokerContact.set(null);
    loadContacts(brokerId);
  }

  onBrokerContactChange(
    contactId: string,
    updateOrder: (updater: (o: OrderDto) => OrderDto) => void,
  ): void {
    updateOrder((o) => ({ ...o, brokerContactId: contactId || null }));
    const contact = this.brokerContacts().find((c) => c.id === contactId) ?? null;
    this.brokerContact.set(contact);
  }

  onBrokerGetsAllChange(
    value: boolean,
    updateOrder: (updater: (o: OrderDto) => OrderDto) => void,
  ): void {
    updateOrder((o) => ({ ...o, brokerGetsAll: value }));
  }

  /** Update internal contacts list after a company contacts API call. */
  setBrokerContacts(contacts: CompanyContactDto[]): void {
    this.brokerContacts.set(contacts);
  }
}