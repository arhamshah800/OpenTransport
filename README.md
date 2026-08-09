# OpenTransport

OpenTransport is a browser-based transportation strategy sandbox. Select a real or fictional city, receive a starting budget, and eventually design bus, dedicated-right-of-way rail, and subway networks. The first module establishes the static World / Level System; no transit construction or simulation has been implemented yet.

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

The ten intended game modules are World, Map, Population, Transit, Construction, Modes, Operations, Economy, Time, and Game. World and Map are prototyped; the remaining modules are intentionally deferred. City data is static while gameplay runs: there are no live geographic API calls. `World` and Map-domain logic are plain TypeScript, so later simulation and worker code do not depend on React.

## Levels

`test-city` (Port Junction) is a human-readable fictional development package with 28 roads, 48 buildings, residential and workplace clusters, a river, bridge crossings, POIs, landmarks, districts, and starting economy data. To add a city, create another `LevelDefinition` package and add one manifest entry; do not add city-specific engine conditionals. See [the level format](docs/LEVEL_FORMAT.md) for the schema and future data pipeline.

After loading a level, the Map Engine renders local geometry with interactive roads/buildings/workplaces/POIs, population modes, developer toggles, camera reset, and selection inspector. See [the Map Engine documentation](docs/MAP_ENGINE.md) for coordinate conventions and the future overlay API.
