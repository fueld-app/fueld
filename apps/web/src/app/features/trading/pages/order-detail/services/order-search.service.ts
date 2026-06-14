import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CounterpartyDto, VesselDto, PlaceDto, CompanyContactDto } from '@fueld/types';
import { API_URL } from '@app/core/config/api';

@Injectable({ providedIn: 'root' })
export class OrderSearchService {
  private readonly http = inject(HttpClient);

  async searchClients(term: string, currentClient: CounterpartyDto | null): Promise<CounterpartyDto[]> {
    let res = await firstValueFrom(
      this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
        `${API_URL}/companies/local?type=CLIENT&search=${encodeURIComponent(term)}&limit=20`,
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
    return currentClient && !localResults.find((c) => c.id === currentClient.id)
      ? [currentClient, ...localResults]
      : localResults;
  }

  async searchSuppliers(
    term: string,
    currentSupplierId: string,
    currentOrderSupplierCompany: CounterpartyDto | null,
    fallbackSupplier: CounterpartyDto | null,
    suppliers: CounterpartyDto[],
  ): Promise<CounterpartyDto[]> {
    let res = await firstValueFrom(
      this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
        `${API_URL}/companies/local?type=SUPPLIER&search=${encodeURIComponent(term)}&limit=20`,
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
    const currentSupplier = currentSupplierId
      ? currentOrderSupplierCompany ?? fallbackSupplier ?? suppliers.find((s) => s.id === currentSupplierId) ?? null
      : null;
    return currentSupplierId && !localResults.find((c) => c.id === currentSupplierId)
      ? [currentSupplier, ...localResults].filter(Boolean) as CounterpartyDto[]
      : localResults;
  }

  async searchVessels(term: string, currentVessel: VesselDto | null): Promise<VesselDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
        `${API_URL}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
      ),
    );
    const localResults = res.success ? res.data.vessels : [];
    return currentVessel && !localResults.find((v) => v.id === currentVessel.id)
      ? [currentVessel, ...localResults]
      : localResults;
  }

  async searchPlaces(term: string, currentPort: PlaceDto | null): Promise<PlaceDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
        `${API_URL}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=20`,
      ),
    );
    const localResults = res.success ? res.data.places : [];
    return currentPort && !localResults.find((p) => p.id === currentPort.id)
      ? [currentPort, ...localResults]
      : localResults;
  }

  async searchBrokers(term: string, currentBrokerId: string, brokers: CounterpartyDto[]): Promise<CounterpartyDto[]> {
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
    const current = currentBrokerId && !localResults.find((c) => c.id === currentBrokerId)
      ? [brokers.find((b) => b.id === currentBrokerId) ?? null, ...localResults].filter(Boolean)
      : localResults;
    return current as CounterpartyDto[];
  }

  async searchAgents(
    term: string,
    currentAgentId: string,
    currentAgent: CounterpartyDto | null,
    agents: CounterpartyDto[],
  ): Promise<CounterpartyDto[]> {
    const res = await firstValueFrom(
      this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(
        `${API_URL}/companies/local?search=${encodeURIComponent(term)}&limit=20`,
      ),
    );
    const localResults = res.success ? res.data.companies : [];
    const current = currentAgentId && !localResults.find((co) => co.id === currentAgentId)
      ? [currentAgent ?? agents.find((a) => a.id === currentAgentId) ?? null, ...localResults].filter(Boolean)
      : localResults;
    return current as CounterpartyDto[];
  }

  async loadCompanyContacts(side: 'customer' | 'supplier' | 'broker' | 'agent', companyId: string): Promise<CompanyContactDto[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CompanyContactDto[]>>(`${API_URL}/companies/local/${companyId}/contacts`),
      );
      if (res.success) return res.data ?? [];
    } catch {
      // silently ignore
    }
    return [];
  }
}