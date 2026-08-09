# Time & Simulation Engine

`SimulationEngine` is the sole heartbeat for gameplay time. It stores an integer simulated-second timestamp, starts on Day 1 / Monday, and derives calendar fields on demand. It has no browser or React dependencies, so it can move into a Web Worker with an adapter that sends player commands in and receives snapshots out.

## Fixed step and ordering

The engine converts real-time deltas through an accumulator into one-second fixed logical ticks. Pause is speed `0`; supported speeds are `1x`, `2x`, and `4x`. Its order is: advance clock, evaluate population schedules, advance operations/dispatch, aggregate operations economic events, then process scheduled loan payments. This prevents finance from observing vehicle events a tick late.

The browser `SimulationControls` is only an adapter around `requestAnimationFrame`; it supplies elapsed wall time and displays snapshots. Rendering never controls vehicle movement or resident schedules. Debug jump controls advance explicit simulated seconds, making tests and inspection immediate.

## Schedules, determinism, and persistence

The engine provides a lightweight serializable schedule queue (`id`, timestamp, type, payload). Loans currently use Economy's deterministic simulated-time schedule; future dispatch or resident schedule work can use the same queue. `serialize()` saves timestamp, speed, and scheduled-event data without callbacks.

Given the same level, seed, starting state, and player actions at the same timestamps, fixed ticks produce reproducible population, operations, and economy outcomes. The test harness advances hours and multiple days directly without browser waits. The UI consumes compact snapshots; it does not inspect every internal simulation object on every map render.

## Current limits

One simulated second is the prototype step size. Longer-running worlds may use batched/coarser adapters after profiling, provided they preserve fixed-step results. Complete game saves, player-command replay, scoring, and worker transport belong to the next Game module.
