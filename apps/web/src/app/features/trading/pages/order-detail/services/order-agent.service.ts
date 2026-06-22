import { Service, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, CompanyContactDto, OrderDto } from '@fueld/types';
import type { DropdownOption } from '@app/shared/components/searchable-dropdown/searchable-dropdown.component';
import { API_URL } from '@app/core/config/api';

@Service()
export class OrderAgentService {
  private readonly http = inject(HttpClient);

  // ─── Signals ─────────────────────────────────────────────────

  readonly agent = signal<CounterpartyDto | null>(null);
  readonly agents = signal<CounterpartyDto[]>([]);
  readonly agentSearchLoading = signal(false);
  readonly agentContact = signal<CompanyContactDto | null>(null);
  readonly agentContacts = signal<CompanyContactDto[]>([]);

  // ─── Computed ────────────────────────────────────────────────

  readonly agentName = computed(() => {
    const id = this._order()?.agentId;
    if (!id) return '—';
    return this.agent()?.name ?? this.agents().find((a) => a.id === id)?.name ?? '—';
  });

  readonly agentDropdownOptions = computed<DropdownOption[]>(() =>
    this.agents().map((a) => ({ value: a.id, label: a.name })),
  );

  readonly agentContactDropdownOptions = computed(() =>
    this.agentContacts().map((c) => ({
      value: c.id,
      label: c.name + (c.role ? ` (${c.role})` : ''),
    })),
  );

  // ─── External state hook ─────────────────────────────────────

  private _order = signal<OrderDto | null>(null);

  setOrder(order: OrderDto | null): void {
    this._order.set(order);
  }

  // ─── Methods ─────────────────────────────────────────────────

  async searchAgents(term: string): Promise<void> {
    this.agentSearchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
          `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      const localResults = res.success ? res.data.companies : [];
      const currentId = this._order()?.agentId ?? '';
      const currentAgent = currentId
        ? this.agent() ?? this.agents().find((company) => company.id === currentId) ?? null
        : null;
      const mergedLocal = currentId && !localResults.find((company) => company.id === currentId)
        ? [currentAgent, ...localResults].filter(Boolean)
        : localResults;
      this.agents.set(mergedLocal as CounterpartyDto[]);
    } catch {
      // silently ignore
    } finally {
      this.agentSearchLoading.set(false);
    }
  }

  onAgentChange(
    agentId: string,
    updateOrder: (updater: (o: OrderDto) => OrderDto) => void,
    loadContacts: (companyId: string) => void,
  ): void {
    if (!agentId) {
      updateOrder((o) => ({ ...o, agentId: null, agentContactId: null }));
      this.agent.set(null);
      this.agentContact.set(null);
      this.agentContacts.set([]);
      return;
    }

    updateOrder((o) => ({ ...o, agentId, agentContactId: null }));
    const company = this.agents().find((c) => c.id === agentId) ?? null;
    this.agent.set(company);
    this.agentContact.set(null);
    loadContacts(agentId);
  }

  onAgentContactChange(
    contactId: string,
    updateOrder: (updater: (o: OrderDto) => OrderDto) => void,
  ): void {
    updateOrder((o) => ({ ...o, agentContactId: contactId || null }));
    const contact = this.agentContacts().find((c) => c.id === contactId) ?? null;
    this.agentContact.set(contact);
  }

  /** Update internal contacts list after a company contacts API call. */
  setAgentContacts(contacts: CompanyContactDto[]): void {
    this.agentContacts.set(contacts);
  }
}