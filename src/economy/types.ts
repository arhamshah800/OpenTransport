export type TransactionCategory = 'STARTING_BALANCE' | 'CONSTRUCTION' | 'DEMOLITION' | 'FARE_REVENUE' | 'OPERATING_COST' | 'LOAN_PROCEEDS' | 'LOAN_PAYMENT' | 'LOAN_INTEREST' | 'ADJUSTMENT';

/** Amounts are integer cents. Credits are positive and expenses are negative. */
export interface LedgerTransaction { readonly id: string; readonly timestampSeconds: number; readonly amountCents: number; readonly category: TransactionCategory; readonly description: string; readonly relatedEntityId?: string; readonly metadata?: Readonly<Record<string, string | number>>; }
export interface LoanProduct { readonly id: string; readonly name: string; readonly principalCents: number; readonly annualInterestRate: number; readonly paymentIntervalSeconds: number; readonly paymentCents: number; }
export interface ActiveLoan { readonly id: string; readonly productId: string; readonly principalCents: number; readonly annualInterestRate: number; readonly outstandingCents: number; readonly issuedAtSeconds: number; readonly nextPaymentAtSeconds: number; readonly paymentIntervalSeconds: number; readonly paymentCents: number; }
export interface LineEconomics { readonly lineId: string; readonly boardings: number; readonly fareRevenueCents: number; readonly operatingCostCents: number; readonly netOperatingCents: number; }
export interface FinancialPeriod { readonly cashCents: number; readonly fareRevenueCents: number; readonly operatingCostCents: number; readonly constructionSpendingCents: number; readonly demolitionSpendingCents: number; readonly netOperatingCents: number; }
export interface FinancialSummary { readonly cashCents: number; readonly debtCents: number; readonly today: FinancialPeriod; readonly allTime: FinancialPeriod; readonly lines: readonly LineEconomics[]; }
export interface EconomyState { readonly version: 1; readonly startingCashCents: number; readonly ledger: readonly LedgerTransaction[]; readonly loans: readonly ActiveLoan[]; }
