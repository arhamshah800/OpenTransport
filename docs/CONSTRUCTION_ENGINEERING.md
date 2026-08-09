# Construction & Engineering

Construction evaluates a player proposal before anything enters the transit network or mutable world state. It produces an estimate, issues, and (only when valid) a `ValidatedConstructionPlan`. Economy owns affordability and payment; Construction never changes cash by itself.

Surface elevation is `0m`; underground subway elevations are negative. The player UI presents depth as positive metres underground and converts to the engine’s signed elevation when building proposals. Subway profiles calculate grade from horizontal distance and reject grades above the centralized prototype maximum. At horizontal tunnel crossings, vertical clearance must meet the configured minimum. River crossings require a configured deep elevation and add a distinct engineering surcharge.

Subway stations use rectangular footprints. Intersecting level building footprints become demolition impacts, with acquisition values included in the estimate. `commit(plan, state)` returns a new mutable construction state containing demolished building IDs and engineering infrastructure; source level data remains immutable.

Bus alignments must remain close to existing roads and have no guideway cost. In the player interface, bus construction is stop and route placement on existing roads rather than expensive guideway building. Tram alignments represent dedicated right-of-way and cost per meter. Subway alignments include a vertical profile and depth costs. All prototype constants are in `src/construction/config.ts` and are balancing values, not real construction estimates.

## Player workflow

`ConstructionWorkflow` is the application boundary used by the Subway and Tram tools:

1. Choose mode (toolbar) and infrastructure action (Station / Tunnel / Alignment).
2. Interact with the map to preview a live proposal (ghost footprint or alignment).
3. Review validity, cost breakdown, cash impact, and engineering issues in the contextual panel and near-cursor cost chip.
4. Confirm **Build** only when valid and affordable, or **Cancel** / Escape to discard the proposal with no world, network, demolition, or economy mutation.

Confirmation is atomic: revalidate → affordability → economy transaction → publish demolition and infrastructure state together. A failed payment never publishes construction state.

The raw Construction Debug panel remains available under Developer Mode for implementation-oriented overrides.
