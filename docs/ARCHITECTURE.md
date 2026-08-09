# Architecture

OpenTransport is a static-city, browser-based transport sandbox. The ten modules are: World/Level (immutable city data), Map (geography/rendering), Population (deterministic demand), Transit (network topology), Construction (engineering proposals), Modes (vehicle/fare definitions), Operations (vehicles/events), Economy (ledger), Time (fixed-step clock), and Game (session, saves, score, player adapters).

`World -> Population/Construction/Map`; `Modes -> Transit/Operations`; `Transit + Economy + Population -> Time`; and `GameSession` orchestrates these without absorbing their logic. React consumes snapshots and sends commands; it does not own core simulation state. A city is added by supplying a validated `LevelDefinition`, adding one manifest entry, and running tests. `mini-city` demonstrates the same path.

Add a mode or vehicle through the mode registry, a score metric in the centralized score configuration, and an achievement through the data-driven achievement list. No city-specific engine branches are needed.
