# Construction & Engineering

Construction evaluates a player proposal before anything enters the transit network or mutable world state. It produces an estimate, issues, and (only when valid) a `ValidatedConstructionPlan`. The future Economy module owns affordability and payment; Construction never changes cash.

Surface elevation is `0m`; underground subway elevations are negative. Subway profiles calculate grade from horizontal distance and reject grades above the centralized prototype maximum. At horizontal tunnel crossings, vertical clearance must meet the configured minimum. River crossings require a configured deep elevation and add a distinct engineering surcharge.

Subway stations use rectangular footprints. Intersecting level building footprints become demolition impacts, with acquisition values included in the estimate. `commit(plan, state)` returns a new mutable construction state containing demolished building IDs and engineering infrastructure; source level data remains immutable.

Bus alignments must remain close to existing roads and have no guideway cost. Tram alignments represent dedicated right-of-way and cost per meter. Subway alignments include a vertical profile and depth costs. All prototype constants are in `src/construction/config.ts` and are balancing values, not real construction estimates.

The development panel uses the last point clicked on the map to preview and commit station or alignment plans. It intentionally bypasses money handling until the Economy module provides a transaction boundary.
