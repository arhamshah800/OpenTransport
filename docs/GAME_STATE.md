# Game State

`GameSession` is the playthrough orchestration boundary. It references a loaded immutable `World` and owns only mutable state: transit network, construction state, Economy, simulation state, achievements, and player metadata. It coordinates commands but delegates engineering validation, finance, simulation, and score calculations to their respective modules.

Construction commands are atomic: evaluate, check affordability, record the ledger transaction, then commit mutable construction state. A failed command leaves construction and cash unchanged. The UI should use session commands rather than mutate subsystem internals; the existing developer editors remain useful prototyping tools until the next UI pass routes every action through this API.

The local player profile is not authentication and must not be treated as cheat-resistant identity.
