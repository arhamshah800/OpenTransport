# Dallas / DFW level

Dallas is configured as a broader Dallas-side Metroplex sandbox: DFW Airport is the west anchor; the extent reaches US-380/Frisco north, I-20/DeSoto south, and Garland/Mesquite east. It starts with **$100,000,000** and no prebuilt transit. Highways are bus-routable but their mainline stops are prohibited; subway stations cannot be built in the Trinity River or lake polygons.

## Download and prepare data

Place converted GeoJSON in `data/raw/dallas/` using the filenames in `tools/real-city/configs/dallas.config.json`.

- Roads, water, POIs, airports: [Geofabrik Texas](https://download.geofabrik.de/north-america/us/texas.html) OSM extract, exported with QGIS or osmium.
- Census geometry and ACS population: [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) and [data.census.gov](https://data.census.gov/).
- Employment: [LEHD/LODES](https://lehd.ces.census.gov/data/) Texas workplace-area records, aggregated to clusters with a `jobs` property.
- Footprints: [Microsoft US Building Footprints](https://github.com/microsoft/USBuildingFootprints) or OSM buildings, clipped before conversion.

Populate every GeoJSON feature with WGS84 coordinates. Keep `population` on population points and `jobs` on employment points. The config supplies DFW Airport, Love Field, Downtown, Uptown, Plano/Legacy, Frisco, Garland, Mesquite, DeSoto, Richardson, and key job-center overrides; raw sources supply the geography and density.

Run:

```sh
npm run download:dallas
npm run generate:dallas
npm run build
npm run dev
```

`download:dallas` automatically retrieves the public ArcGIS DFW road, Census-tract, water, Dallas building-footprint, and employer extracts. They stay in ignored `data/raw/dallas/`; `generate:dallas` produces the committed, simplified static package.

Then add the generated `src/levels/generated/dallas.ts` to the manifest. Do not add it before generation. QA: confirm Trinity River/White Rock Lake, highways, both airports, density/jobs, no transit, valid surface-road stops, rejected highway stops, and rejected station footprints in water.

Known limitations: this first importer supports prepared GeoJSON, not direct PBF/shapefile ingestion; it clips with a bounding box rather than a custom polygon; and it uses representative clusters and footprint caps for browser performance. A full Dallas package is intentionally not checked in without the required public raw data, so the app does not imply fabricated real-world coverage.
