# Transit Network System

The Transit Network module is the serializable, player-owned topology of stops, transfer complexes, alignments, and services. It is independent of the immutable World data and does not run vehicles, calculate fares, route passengers, or decide whether infrastructure can be built.

## Domain objects

- `TransitStop` represents roadside stops or stations, with WGS84 coordinates, compatible modes, optional infrastructure metadata, and an optional transfer-complex parent.
- `TransitLine` is a named BUS, TRAM, or SUBWAY service with an ordered stop sequence, display alignment segments, direction, active state, and service/fare placeholders.
- `TransitSegment` joins each adjacent ordered stop pair and leaves room for a future vertical profile or right-of-way metadata.
- `TransitTransferComplex` explicitly groups physical stops. The graph also detects nearby stops using a configurable 150-meter walking-distance threshold.

Infrastructure (stops/stations/alignment), service (lines), and future vehicles are deliberately distinct. There are no separate bus/tram/subway network object models; all share the same topology types and differ by mode metadata.

## Commands, graph, and persistence

The public command functions (`createStop`, `createLine`, `addStopToLine`, `reorderLineStops`, and so on) return a new `TransitNetwork`, avoiding arbitrary in-place mutations and leaving a natural future undo boundary. An optional `TransitInfrastructureValidator` accepts/rejects proposals, but construction engineering remains outside this module.

`TransitGraph` builds transient service and transfer edges from the serialized network and offers neighbors, lines serving a stop, direct-connection, transfer, and component queries. `getStopsNearCoordinate`, `getLinesServingStop`, and `getConnectedTransitEdges` are the route-planner-facing query API.

`serializeTransitNetwork` and `deserializeTransitNetwork` store only the versioned `TransitNetworkDefinition`; no React or MapLibre objects are persisted. Version 1 is the initial migration boundary.

## Debug editor and integration

The map’s **Transit Network Debug** panel can select a mode, place stops by clicking the map, select stops, create/rename/delete a line, create a transfer complex, and reset the player network. It projects the network into the existing `MapController.setTransitOverlay` API, so bus, tram, subway lines and stops render over immutable geography.

Future Construction will validate physical feasibility and costs. Future routing will consume graph queries to resolve Population travel requests. Future Operations will create vehicles; none of those behaviors belong here.
