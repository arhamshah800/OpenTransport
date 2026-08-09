# Vehicles & Operations

Operations turns the immutable transit topology plus registry-owned mode/vehicle definitions into serializable runtime service state. `OperationsSimulation.advance(seconds)` is the only clock input: it dispatches vehicles by configured day/night headways, progresses vehicles by distance and speed, handles dwell, queues, capacity, and emits economic events.

## Player controls

Selecting a transit line opens an Operations section with service status, day/night headways, vehicle type/count, fleet planning estimates, ridership/wait when available, and operating cost / fare revenue from Economy. Players can Start/Stop Service, change headways (presets like “Every 5 minutes” plus validated numeric input), pick a mode-compatible vehicle, and assign fleet size.

**Stop Service rule:** Setting `configuration.active = false` stops *future* dispatches. Vehicles already in motion continue to the end of the line. The line topology is not deleted.

## Day / night

Headways switch from the shared simulation clock using each line’s `daytimeStartHour` / `nighttimeStartHour` (defaults 06:00–22:00 day). The HUD shows whether Day or Night service frequencies are active. There is no independent operations timer.

## Fleet shortfalls

When the assigned fleet cannot sustain the requested headway (planning estimate assuming recirculation), Operations surfaces warnings such as `Requested: every 5 min. Available fleet supports: every 9 min.` rather than silently claiming the frequency is met.

## Passengers & economy

Passengers enter through journey planning (`SimulationEngine` → `enqueueJourney`) or direct `enqueuePassenger` for tests. Journey plans may include modest transfers using connected transfer complexes / nearby stops only. When a vehicle serves a stop it alights destination passengers, boards until capacity, records waits and denied boardings, then applies mode dwell time. Remaining transfer legs re-enter the next board stop after a walk delay; `FARE_CHARGED` respects mode free-transfer policy.

`FARE_CHARGED` and `VEHICLE_OPERATING_COST` events are emitted rather than changing cash. Economy aggregates and records them through the central `SimulationEngine`. Operations snapshots expose vehicles, queues, warnings, and aggregate metrics for the UI; rendering is never the source of vehicle state. Vehicle positions use explicit simulation progress, not browser animation time.

## Simplified assumptions

The prototype omits depots, traffic, and detailed road speed variation. Vehicles travel outbound along the line and remain visible at the terminus after the final dwell, but idle terminus vehicles do not consume fleet slots — new trips can dispatch from the origin on headway (simplified depot recirculation). Full reverse/turnback simulation is not modeled yet — return demand needs a reverse line or a later turnback feature. Fleet-support estimates assume recirculation. The pure domain state and event interface are suitable for a later Web Worker adapter.
