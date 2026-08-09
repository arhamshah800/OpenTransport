import type { LoanProduct } from './types';

/** Gameplay-only loan products. Payment intervals are simulated 30-day months. */
export const standardLoanProducts: readonly LoanProduct[] = [
  { id: 'small-expansion', name: 'Small Expansion Loan', principalCents: 5_000_000_00, annualInterestRate: 0.045, paymentIntervalSeconds: 2_592_000, paymentCents: 22_000_00 },
  { id: 'medium-infrastructure', name: 'Medium Infrastructure Loan', principalCents: 20_000_000_00, annualInterestRate: 0.05, paymentIntervalSeconds: 2_592_000, paymentCents: 95_000_00 },
  { id: 'major-capital', name: 'Major Capital Loan', principalCents: 50_000_000_00, annualInterestRate: 0.055, paymentIntervalSeconds: 2_592_000, paymentCents: 250_000_00 },
];
