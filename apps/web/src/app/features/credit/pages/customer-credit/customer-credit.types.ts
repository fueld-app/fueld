export interface CreditLineForm {
  creditAmount: string;
  currency: string;
  expires: string;
  periodDays: number;
  notes: string;
  fromDelivery: boolean;
  qualified: boolean;
  /**
   * Broker credit line: tracks broker-deal exposure on behalf of counterparties.
   * The server matches a line to a deal on this flag, so a regular line cannot
   * back a broker deal (and vice versa) — without this toggle a broker deal's
   * customer side could never be given a usable line.
   */
  isBrokerCreditLine: boolean;
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
    isBrokerCreditLine: false,
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