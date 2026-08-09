# OpenTransport

OpenTransport is a browser-based transportation strategy sandbox. Select a static city package, build bus/tram/subway infrastructure, run a deterministic simulation, inspect finance and score, and save a local prototype session. It is a modular foundation, not a production service.

## Development

```sh
npm install
npm run dev
npm run test
npm run build
```

## Architecture

- `src/app` - React shell only: level selection and global styling.
- `src/world` - framework-independent level types, validation, registry, and runtime `World` indexes.
- `src/map` - geographic math, world queries, GeoJSON layer adapters, MapLibre controller, and map view.
- `src/levels` - static city packages and the manifest that registers them.
- `src/map`, `src/population`, `src/transit`, `src/construction`, `src/modes`, `src/operations`, `src/economy`, `src/time`, `src/game`, `src/components`, `src/shared`, and `src/workers` - reserved module boundaries for later work.

The ten modules are World, Map, Population, Transit, Construction, Modes, Operations, Economy, Time, and Game. City data is static while gameplay runs: there are no live geographic API calls. Core domain logic is plain TypeScript, so a later worker or backend adapter does not depend on React.

## Levels

`test-city` (Port Junction) is a human-readable fictional development package with 28 roads, 48 buildings, residential and workplace clusters, a river, bridge crossings, POIs, landmarks, districts, and starting economy data. `mini-city` is a second fixture proving levels flow through the same engine. To add a city, create another `LevelDefinition` package, add one manifest entry, and run tests - never add city-specific engine conditionals. See [the level format](docs/LEVEL_FORMAT.md), [architecture](docs/ARCHITECTURE.md), [game state](docs/GAME_STATE.md), [scoring](docs/SCORING.md), and [saves](docs/SAVES.md).

After loading a level, the Map Engine renders local geometry with interactive roads/buildings/workplaces/POIs, population modes, developer toggles, camera reset, and selection inspector. See [the Map Engine documentation](docs/MAP_ENGINE.md) for coordinate conventions and the future overlay API.

The development-only Population Debug panel deterministically generates representative residents from the static city, advances supplied simulation time, and inspects unresolved work/activity/return demand. It has no routing or transit behavior; see [the Population Simulation documentation](docs/POPULATION_SIMULATION.md).

The Transit Network Debug panel owns a separate player network: it can place BUS/TRAM/SUBWAY stops, create topology-only lines and transfers, and render them above the map. Its saved model contains no map or UI objects; see [the Transit Network documentation](docs/TRANSIT_NETWORK.md).
