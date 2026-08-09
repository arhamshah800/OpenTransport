# Level format

OpenTransport treats a city as immutable level data, not application code. Every level conforms to `LevelDefinition` in `src/world/types.ts` and is loaded through the manifest-based registry.

## Required shape

Each package contains metadata, geographic bounds, roads, building footprints, population records, workplaces, points of interest, waterways, landmarks, and a starting economy. Geographic points use `{ latitude, longitude }`; road and waterway geometry is a polyline, while buildings use a polygon footprint. References from population, workplace, POI, and landmark records to buildings must point to an existing building ID.

The loader validates identifiers, geometry, bounds, references, quantities, and monetary values before creating a `World`. `World` creates runtime ID indexes but does not mutate the serialized definition.

## Adding a city

1. Produce a `LevelDefinition` from hand-authored data or an offline preprocessing pipeline.
2. Add a single manifest entry in `src/levels/manifest.ts` with a summary and async loader.
3. Add validation fixtures/tests appropriate to the new data package.

The loading code remains unchanged. Future production data follows this pipeline:

`Raw geographic datasets → offline preprocessing → validated game level package → static application assets → World loader → simulation`

This keeps gameplay independent of live geographic APIs and allows the same runtime loader to consume both hand-written test data and generated real-city packages.
