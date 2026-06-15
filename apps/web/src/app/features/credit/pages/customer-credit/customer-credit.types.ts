export interface CreditLineForm {
  creditAmount: string;
  currency: string;
  expires: string;
  periodDays: number;
  notes: string;
  fromDelivery: boolean;
  qualified: boolean;
}

export function emptyCreditLineForm(): CreditLineForm {
  return {
    creditAmount: '',
    currency: 'USD',
    expires: '',
    periodDays: 30,
    notes: '',
    fromDelivery: false,
    qualified: false,
  };
}

export interface CounterpartyOption {
  key: string;
  id?: string;
  name: string;
  country: string | null;
  source: 'local' | 'seasearcher';
  seasearcherId?: string;
}

export interface OwnCompanyOption {
  id: string;
  name: string;
  country?: string | null;
}