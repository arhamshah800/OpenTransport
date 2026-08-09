# Vehicles & Operations

Operations turns the immutable transit topology plus registry-owned mode/vehicle definitions into serializable runtime service state. `OperationsSimulation.advance(seconds)` is the only clock input: it dispatches vehicles by configured day/night headways, progresses vehicles by distance and speed, handles dwell, queues, capacity, and emits economic events.

Passengers currently enter a stop queue through `enqueuePassenger`. A direct, forward line path is required in this first implementation; demand without one is recorded as unserved. When a vehicle serves a stop it alights destination passengers, boards until capacity, records waits and denied boardings, then applies mode dwell time. Transfer routing remains the next focused improvement.

`FARE_CHARGED` and `VEHICLE_OPERATING_COST` events are emitted rather than changing cash. Economy will aggregate and record them. Operations snapshots expose vehicles, queues, warnings, and aggregate metrics for the UI; rendering is never the source of vehicle state. Vehicle positions use explicit simulation progress, not browser animation time.

The prototype omits depots, traffic, detailed road speed variation, reverse trips, and full multi-line journey planning. The pure domain state and event interface are suitable for a later Web Worker adapter.
