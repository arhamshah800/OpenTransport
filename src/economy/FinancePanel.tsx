import { useEffect, useState } from 'react';
import { standardLoanProducts } from './config';
import type { Economy } from './Economy';

const money = (cents: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);
const timeLabel = (seconds: number): string => {
  const day = Math.floor(seconds / 86_400) + 1;
  const within = seconds % 86_400;
  const hour = Math.floor(within / 3600);
  const minute = Math.floor((within % 3600) / 60);
  return `Day ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

type FinanceSection = 'overview' | 'operations' | 'construction' | 'loans' | 'ledger';

export function FinancePanel({
  economy,
  timestampSeconds,
  onChange,
  developerMode = false,
  onTakeLoan,
  lineNames = {},
  initialSection,
}: {
  readonly economy: Economy;
  readonly timestampSeconds: number;
  readonly onChange: () => void;
  readonly developerMode?: boolean;
  readonly onTakeLoan?: (productId: string) => void;
  readonly lineNames?: Readonly<Record<string, string>>;
  readonly initialSection?: FinanceSection;
}) {
  const [section, setSection] = useState<FinanceSection>(initialSection ?? 'overview');
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);
  const [pendingLoan, setPendingLoan] = useState<string | null>(null);
  const summary = economy.getFinancialSummary(timestampSeconds);
  const borrow = (id: string): void => {
    if (onTakeLoan) onTakeLoan(id);
    else economy.takeLoan(id, timestampSeconds);
    setPendingLoan(null);
    onChange();
  };
  const addMoney = (): void => {
    economy.record({ timestampSeconds, amountCents: 1_000_000_00, category: 'ADJUSTMENT', description: 'Developer cash adjustment' });
    onChange();
  };
  const constructionEntries = economy.getLedger().filter((entry) => entry.category === 'CONSTRUCTION' || entry.category === 'DEMOLITION' || entry.description.toLowerCase().includes('construction') || entry.description.toLowerCase().includes('demolition') || entry.description.toLowerCase().includes('acquisition'));

  return (
    <section className="finance-panel">
      <p className="eyebrow">FINANCE</p>
      <h2>City finances</h2>
      <div className="finance-kpis-row">
        <div><span>Cash</span><strong>{money(summary.cashCents)}</strong></div>
        <div><span>Today net</span><strong className={summary.today.cashCents < 0 ? 'expense' : 'credit'}>{money(summary.today.cashCents)}</strong></div>
        <div><span>Debt</span><strong>{money(summary.debtCents)}</strong></div>
      </div>
      {summary.cashCents < 0 && <p className="finance-warning" role="status">Cash is negative. Operations can continue; new construction is blocked until funds recover.</p>}
      <div className="segmented-control finance-tabs" role="tablist" aria-label="Finance sections">
        {([
          ['overview', 'Overview'],
          ['operations', 'Operations'],
          ['construction', 'Construction'],
          ['loans', 'Loans'],
          ['ledger', 'Ledger'],
        ] as const).map(([id, label]) => (
          <button className={section === id ? 'active' : ''} type="button" role="tab" aria-selected={section === id} key={id} onClick={() => setSection(id)}>{label}</button>
        ))}
      </div>

      {section === 'overview' && (
        <dl className="finance-overview">
          <dt>Fare revenue today</dt><dd>{money(summary.today.fareRevenueCents)}</dd>
          <dt>Operating costs today</dt><dd>{money(summary.today.operatingCostCents)}</dd>
          <dt>Net operations today</dt><dd>{money(summary.today.netOperatingCents)}</dd>
          <dt>Construction today</dt><dd>{money(summary.today.constructionSpendingCents)}</dd>
          <dt>Demolition today</dt><dd>{money(summary.today.demolitionSpendingCents)}</dd>
        </dl>
      )}

      {section === 'operations' && (
        <div className="finance-operations">
          {summary.lines.length === 0 ? <p className="empty-state">No line operating results yet. Start service and carry passengers to see fares and costs by line.</p> : summary.lines.map((line) => (
            <article key={line.lineId}>
              <h3>{lineNames[line.lineId] ?? line.lineId}</h3>
              <p>{line.boardings} boardings · Fares {money(line.fareRevenueCents)} · Costs {money(line.operatingCostCents)} · Net {money(line.netOperatingCents)}</p>
            </article>
          ))}
        </div>
      )}

      {section === 'construction' && (
        <div className="finance-operations">
          <dl className="finance-overview">
            <dt>Construction spending (all time)</dt><dd>{money(summary.allTime.constructionSpendingCents)}</dd>
            <dt>Demolition / acquisition (all time)</dt><dd>{money(summary.allTime.demolitionSpendingCents)}</dd>
            <dt>Cash available</dt><dd>{money(summary.cashCents)}</dd>
          </dl>
          <h3>Recent construction ledger</h3>
          {constructionEntries.length === 0 ? <p className="empty-state">No construction spending recorded yet. Live proposal breakdowns appear on the Build card.</p> : (
            <ul className="finance-ledger">
              {constructionEntries.slice(-12).reverse().map((entry) => (
                <li key={entry.id}>
                  <span><small>{timeLabel(entry.timestampSeconds)}</small>{entry.description}</span>
                  <strong className="expense">−{money(Math.abs(entry.amountCents))}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {section === 'loans' && (
        <div className="finance-loans">
          <h3>Available capital products</h3>
          {standardLoanProducts.map((loan) => (
            <div className="loan-product" key={loan.id}>
              <div>
                <strong>{loan.name}</strong>
                <p>{money(loan.principalCents)} at {(loan.annualInterestRate * 100).toFixed(1)}% · payments {money(loan.paymentCents)}</p>
              </div>
              {pendingLoan === loan.id ? (
                <div className="loan-confirm">
                  <p>Confirm borrowing {money(loan.principalCents)}? Interest accrues on a schedule; this never auto-borrows.</p>
                  <button type="button" onClick={() => borrow(loan.id)}>Confirm loan</button>
                  <button className="secondary" type="button" onClick={() => setPendingLoan(null)}>Cancel</button>
                </div>
              ) : (
                <button type="button" onClick={() => setPendingLoan(loan.id)}>Review loan</button>
              )}
            </div>
          ))}
          <h3>Active loans</h3>
          {economy.getLoans().length === 0 ? <p className="empty-state">No active loans.</p> : (
            <ul>{economy.getLoans().map((loan) => <li key={loan.id}>{loan.productId}: {money(loan.outstandingCents)} outstanding</li>)}</ul>
          )}
        </div>
      )}

      {section === 'ledger' && (
        <ul className="finance-ledger">
          {economy.getLedger().slice(-24).reverse().map((entry) => (
            <li key={entry.id}>
              <span><small>{timeLabel(entry.timestampSeconds)}</small>{entry.description}</span>
              <strong className={entry.amountCents < 0 ? 'expense' : 'credit'}>{entry.amountCents < 0 ? '−' : '+'}{money(Math.abs(entry.amountCents))}</strong>
            </li>
          ))}
        </ul>
      )}

      {developerMode && <button className="secondary" type="button" onClick={addMoney}>Add $1,000,000 (adjustment)</button>}
    </section>
  );
}
