# Real-city level pipeline

OpenTransport treats a city as static level data, never as an engine branch. `tools/real-city/src/cli.mjs` transforms prepared GeoJSON into a small TypeScript level module for the existing world schema. It is deterministic for the same input files, configuration, and pipeline version.

## Inputs and layout

Keep untracked downloads under `data/raw/<city-id>/`. A config names six GeoJSON FeatureCollections: `roads.geojson`, `waterways.geojson`, `buildings.geojson`, `population.geojson`, `workplaces.geojson`, and `pois.geojson`. Coordinates must be WGS84 GeoJSON `[longitude, latitude]`; population features require `population` and workplaces require `jobs` (both configurable). The importer clips by the configured bounding box, filters road classes, samples geometry, caps buildings/workplaces, then writes the browser-safe package. It deliberately does not read `.osm.pbf` in-browser or at generation time.

For OSM, download a Geofabrik extract (for example Texas) and use QGIS or `osmium export` to create the required GeoJSON layers. Use Census TIGER/Line tract/block-group geometry joined to ACS population for population. Use Texas LEHD/LODES workplace-area data aggregated to points/cell centroids for jobs. Microsoft US Building Footprints or OSM buildings can supply buildings. OSM provides roads, water, POIs, airports, and landmarks. Preserve source URLs/vintage/license notes beside downloaded data and add them to the city attribution when checking generated data in.

## Add a city

1. Copy `tools/real-city/configs/dallas.config.json`, select an ID, bounding box/polygon strategy, output path, and gameplay values.
2. Download and prepare the six source GeoJSON files under `data/raw/<id>/`; do not commit raw data.
3. Put gameplay labels, landmark/job corrections, water restrictions, and construction placeholders in `manualOverrides`. Overrides are level design, not engine hacks.
4. Run `npm run generate:city -- --config tools/real-city/configs/<id>.config.json`.
5. Import the generated module in `src/levels/manifest.ts` only after it passes validation; this keeps absent raw data from breaking the app.

Roads tagged motorway/trunk become `highway`: routable but `busStopEligible: false`. Primary/secondary/tertiary become arterials and ordinary/service streets local. Buildings get nonnegative acquisition values based on area; raw footprints are clipped, simplified and capped. Population and LODES-like jobs become weighted clusters, not millions of agents. Lakes and named prohibited waterways are station-prohibited polygons; tunnels can still cross water under existing engineering rules.

## Validation and QA

The level validator checks unique IDs, coordinate/bounds validity, road classes, geometry, nonnegative costs/counts, and rejects stop-eligible highways. Before committing a package, inspect file size, region-scale map readability, density, water, major POIs, stop placement (surface vs. freeway), and station placement in water. The generator prints source sizes; reduce `maxFeatures` or simplification settings if browser loading becomes heavy.

Generated level data is gameplay data; source data remains local and is never queried during normal play. Attribution must include dataset name, URL/download date, vintage, license, processing date, pipeline version, and known limitations. OSM requires © OpenStreetMap contributors / ODbL attribution; verify Census, LEHD, and Microsoft terms for each vintage.
