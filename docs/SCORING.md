# Scoring

Score is a transparent, non-cumulative comparison metric, not a win condition. `calculateScore` reads snapshots only and cannot alter gameplay. Five normalized components (0-100) are weighted: ridership 25%, coverage 20%, reliability 20%, financial health 20%, and connectivity 15%.

Ridership uses a logarithmic boarding signal; coverage compares boardings with generated demand; reliability penalizes denied boardings and excessive waits; financial health considers operating result, debt, and negative cash; connectivity reflects active lines and transfer complexes. Capital construction is not directly penalized. The constants are prototype values and intentionally live together in `src/game/scoring.ts`.

Because this score uses quality ratios and capped signals instead of raw cumulative boardings, leaving a game running does not trivially inflate it. Travel-time and completed-trip measures await full routing.
