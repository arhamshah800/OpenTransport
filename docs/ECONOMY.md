# Economy

Economy is the sole authority for player money. It is deliberately independent of React, map rendering, vehicle movement, population generation, engineering validity, and transit topology.

## Ledger and sign convention

All amounts are safe integer cents. Every balance change is an immutable ledger transaction: credits are positive, expenses are negative. A level creates one `STARTING_BALANCE` entry. Construction and demolition are separate traceable entries, and construction is rejected before anything is committed when current cash is insufficient.

Operations can make cash negative; the simulation continues. Construction never may. This is a sandbox rule, not a game-over condition.

## Integration

`ConstructionEngine` evaluates a proposal without mutation. The UI asks Economy to record its estimate first, then commits construction only after the affordability check succeeds. Operations emits fares and vehicle operating costs; Economy consumes and aggregates them by line, category, and simulated hour. Fare revenue is attributed to the boarding line; operating cost is attributed to the vehicle's line.

## Loans and persistence

Three gameplay loan products are included: $5M at 4.5%, $20M at 5.0%, and $50M at 5.5%. They use simulated 30-day payment intervals and simple scheduled interest on the outstanding balance. Loan proceeds credit cash immediately. Payments may push cash negative, like operating costs. `Economy.serialize()` contains only versioned data, ledger entries, and loans; `Economy.restore()` reconstructs the runtime object.

## Reporting

Financial summaries expose current cash, debt, day/all-time fare revenue, operating costs, construction and demolition spending, plus per-line boardings, revenue, cost, and net operations. The current panel is intentionally compact; charts and scoring remain future work.
