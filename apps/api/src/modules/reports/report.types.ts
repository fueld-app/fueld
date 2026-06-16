// ═══════════════════════════════════════════════════════════════════════
//  Report Types — internal shared types for reports module
// ═══════════════════════════════════════════════════════════════════════

import type { ReportsAccessDto, ReportFiltersDto } from '@fueld/types';

export type StoredReportSettings = NonNullable<Record<string, any>['reportsSettings']>;

export type ScopedOrderRow = {
  orderId: string;
  traderId: string;
  traderName: string;
  traderEmail: string;
  teamId: string | null;
  teamName: string | null;
  clientId: string;
  clientName: string;
  vesselId: string;
  vesselName: string;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
  customerPaymentTermType: string | null;
  customerCreditDays: number | null;
  supplierPaymentTermType: string | null;
  supplierCreditDays: number | null;
};

export type ScopedItemRow = {
  orderId: string;
  productType: string;
  quantity: string | number | null;
  deliveredQuantity: string | number | null;
  costPrice: string | number | null;
  costCurrency: string | null;
  costConversionFactor: string | number | null;
  salesPrice: string | number | null;
  salesCurrency: string | null;
  unitConversionFactor: string | number | null;
};

export type ReportAccessContext = {
  access: ReportsAccessDto;
  userIds: string[] | null;
  teamId: string | null;
};

export type ScopedDataset = {
  filtersApplied: ReportFiltersDto;
  orderRows: ScopedOrderRow[];
  itemRows: ScopedItemRow[];
  itemsByOrder: Map<string, ScopedItemRow[]>;
  financingRateAnnual: number;
};
