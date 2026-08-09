# Map & Geographic Engine

The Map module renders a loaded `World` using only static level-package geometry. It does not query live map or city-data APIs, and it does not make economic, routing, construction, or simulation decisions.

## Rendering architecture

`src/map/layers.ts` converts immutable world data into reusable GeoJSON source collections once at load time. `src/map/MapLibreController.ts` is the sole MapLibre adapter: it owns source/layer registration, clicks, camera fitting, and renderer-specific visibility updates. `src/map/MapView.tsx` is the small React integration layer that owns inspector and toggle UI state.

Layer order is water, buildings, roads by classification, population, employment, POIs/landmarks, labels/debug layers, and a reserved transit overlay. Future transit code must use the `MapController` API (`setTransitOverlay`) with polylines/stops instead of manipulating MapLibre directly.

## Geography conventions

Level coordinates are WGS84 `{ latitude, longitude }`. `src/map/geometry.ts` contains the geographic math used by the module. Distances, nearest-point results, and interpolation offsets use **meters**. It provides distance, segment/polyline interpolation, nearest-point, bounds, polygon, and segment-intersection primitives. `src/map/queries.ts` supplies world-aware operations such as nearest road lookup, building demand lookup, and `doesSegmentCrossWater`.

## Interaction and selection

`MapSelection` is deliberately a small domain record, never a MapLibre object. Road, building, workplace, and POI clicks are translated into IDs and displayed by the inspector. Empty-map clicks expose their latitude/longitude for development use. The controller handles fit-to-bounds, reset camera, population display mode, layer visibility, building highlighting, and future transit overlays.

## Performance path

Static world data is converted to source collections only on map initialization; it is not rebuilt during React renders or animation frames. MapLibre renders geometry in layers rather than as large numbers of DOM elements. Large future levels should add source tiling/clustering, worker-side conversion, and code splitting for the renderer before adding sophisticated caches.
