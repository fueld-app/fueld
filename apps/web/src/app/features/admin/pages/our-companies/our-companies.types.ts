export interface BankAccountFormData {
  label: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swiftBic: string;
  currency: string;
  branchAddress: string;
  sortCode: string;
  routingNumber: string;
  intermediaryBank: string;
  notes: string;
  isDefault: boolean;
}

export function emptyBankAccountForm(): BankAccountFormData {
  return {
    label: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    iban: '',
    swiftBic: '',
    currency: '',
    branchAddress: '',
    sortCode: '',
    routingNumber: '',
    intermediaryBank: '',
    notes: '',
    isDefault: false,
  };
}

export function bankAccountToForm(ba: { label: string; bankName: string; accountName?: string | null; accountNumber?: string | null; iban?: string | null; swiftBic?: string | null; currency: string; branchAddress?: string | null; sortCode?: string | null; routingNumber?: string | null; intermediaryBank?: string | null; notes?: string | null; isDefault: boolean; counterpartyId: string }): BankAccountFormData {
  return {
    label: ba.label,
    bankName: ba.bankName,
    accountName: ba.accountName ?? '',
    accountNumber: ba.accountNumber ?? '',
    iban: ba.iban ?? '',
    swiftBic: ba.swiftBic ?? '',
    currency: ba.currency,
    branchAddress: ba.branchAddress ?? '',
    sortCode: ba.sortCode ?? '',
    routingNumber: ba.routingNumber ?? '',
    intermediaryBank: (ba as any).intermediaryBank ?? '',
    notes: ba.notes ?? '',
    isDefault: ba.isDefault,
  };
}