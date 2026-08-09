# Population & Trip Simulation

The Population module turns fixed, aggregated level population into a manageable set of deterministic simulation agents. It creates **transport demand**, never transit routes, vehicles, fares, construction, or changes to the city itself.

## Resident agents and weighting

`generateResidents` converts aggregated `PopulationRecord` data into plain `Resident` records. Each agent has a home, stable work or optional activity destination, varied outbound/return schedule, current state, and `simulationWeight`. Agents are representative: their weight is the source population divided by the chosen agent count, so a later large city need not allocate one object per person.

`SeededRandom` is the sole random source. Given the same World, options, and seed, assignments and schedules reproduce exactly. Employment slots are assigned in proportion to level job weights; workers retain their assignment for the session. Non-workers may receive a single POI activity.

## Time and requests

`PopulationSimulation.tick({ absoluteMinutes })` advances only when the central `SimulationEngine` supplies time; it owns no timer. At its scheduled time a resident emits a `TravelRequest` with an origin, destination, desired departure minute, and purpose (`work`, `activity`, or `return`). Requests remain `unresolved` until a future routing module handles them.

For development, `resolveAllWithAlternativeMode` explicitly records an `assumedAlternativeMode` fallback and moves the agent to its endpoint without inventing a transit journey. This makes the evening return-demand path inspectable while keeping routing outside the module.

## Outputs and boundaries

The module outputs residents, unresolved travel requests, `PopulationSummary`, and endpoint demand buckets for future map overlays. It may read World population, workplaces, POIs, and caller-provided time. It must not alter the city, deduct money, construct infrastructure, run vehicles, calculate fares, or control the game clock.

Static source conversion and event-driven updates make this suitable for future Web Worker execution. Large cities will need worker ownership, compact records, and scheduled-event queues before scaling to many thousands of agents.
