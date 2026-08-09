# Transportation Modes

The Modes module is a registry of serializable `ModeId` definitions. It owns display metadata, infrastructure rules, operating defaults, day/night frequency defaults, flat boarding fares, and vehicle templates. It does not build infrastructure, move vehicles, route passengers, manage cash, or render the map.

- **Bus** uses roads, needs no constructed guideway, and has low-capacity, low-cost vehicle templates.
- **Tram / Light Rail** needs dedicated constructed guideway and has higher-capacity tram vehicles.
- **Subway** needs underground guideway and stations; Construction applies its depth, grade, clearance, and river rules.

`ServiceFrequency` contains positive daytime and nighttime headways plus integer period boundaries. Capacity always means total riders per vehicle. Fares are prototype flat-fare-per-boarding policies; Economy will consume revenue later.

To add commuter rail later, define its `TransportModeDefinition` and compatible `VehicleDefinition` records, register them in a composition root, and supply any required Construction strategy/configuration. Transit lines continue storing only the mode ID, while Operations can query vehicle and service defaults through the registry. No city, map, or passenger code needs a commuter-rail branch.
