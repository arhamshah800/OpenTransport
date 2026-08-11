#!/usr/bin/env node
/**
 * Deterministic, dependency-free GeoJSON importer. It intentionally consumes prepared
 * GeoJSON rather than OSM PBF: convert PBF with osmium/QGIS first, then keep raw GIS
 * outside the browser bundle. This avoids shipping a large GIS runtime to players.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const arg = process.argv.indexOf('--config');
if (arg < 0 || !process.argv[arg + 1]) throw new Error('Usage: npm run generate:city -- --config path/to/city.config.json');
const configPath = resolve(process.argv[arg + 1]);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const root = resolve(dirname(configPath), '../../..');
const absolute = (path) => resolve(root, path);
const missing = Object.entries(config.sources).filter(([, path]) => !existsSync(absolute(path))).map(([kind, path]) => `${kind}: ${path}`);
if (missing.length) throw new Error(`Cannot generate ${config.cityId}; missing prepared GeoJSON files:\n${missing.join('\n')}\nSee docs/REAL_CITY_PIPELINE.md for download and conversion instructions.`);
const readFeatures = (path) => JSON.parse(readFileSync(absolute(path), 'utf8')).features ?? [];
const inside = ([lon, lat]) => lat >= config.bounds.southWest.latitude && lat <= config.bounds.northEast.latitude && lon >= config.bounds.southWest.longitude && lon <= config.bounds.northEast.longitude;
const coords = (geometry) => geometry?.type === 'Point' ? [geometry.coordinates] : geometry?.type === 'LineString' ? geometry.coordinates : geometry?.type === 'Polygon' ? geometry.coordinates[0] : [];
const toPoint = ([longitude, latitude]) => ({ latitude, longitude });
const simplify = (points, every = 1) => points.filter((_, index) => index === 0 || index === points.length - 1 || index % every === 0);
const id = (prefix, feature, index) => `${prefix}-${String(feature.id ?? feature.properties?.id ?? index + 1).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const property = (feature, ...names) => names.map((name) => feature.properties?.[name]).find((value) => value !== undefined && value !== null);
const highwayValues = new Set(config.roadRules.highwayValues);
const importedRoads = readFeatures(config.sources.roads).flatMap((feature, index) => {
  const line = simplify(coords(feature.geometry).filter(inside), config.roadRules.simplifyEveryNthCoordinate);
  const prefix = String(property(feature, 'RTE_PRFX') ?? '');
  const highway = String(property(feature, 'highway', 'class') ?? (['IH', 'US'].includes(prefix) ? 'motorway' : ['SH', 'FM'].includes(prefix) ? 'primary' : property(feature, 'source') === 'txdot' ? 'secondary' : 'residential'));
  if (line.length < 2 || !config.roadRules.includeHighwayValues.includes(highway)) return [];
  const classification = highwayValues.has(highway) ? 'highway' : ['primary', 'secondary', 'tertiary'].includes(highway) ? 'arterial' : 'local';
  return [{ id: `${property(feature, 'source') ?? 'road'}-${id('road', feature, index)}`, name: property(feature, 'name', 'MAP_LBL', 'NAME'), geometry: line.map(toPoint), classification, speedKph: classification === 'highway' ? 95 : classification === 'arterial' ? 55 : 35, busStopEligible: classification !== 'highway' }];
});
// Preserve every class at a useful regional scale instead of taking the first N rows.
const capped = (classification, maximum) => importedRoads.filter((road) => road.classification === classification).slice(0, maximum ?? Infinity);
const roads = [...capped('highway', config.roadRules.maxHighways), ...capped('arterial', config.roadRules.maxArterials), ...capped('local', config.roadRules.maxLocals)];
const water = readFeatures(config.sources.waterways).flatMap((feature, index) => {
  const line = simplify(coords(feature.geometry).filter(inside), 2); if (line.length < 2) return [];
  const name = String(property(feature, 'name', 'NAME') ?? 'Waterway'); const kind = feature.geometry?.type === 'Polygon' ? 'lake' : 'river';
  return [{ id: id('water', feature, index), geometry: line.map(toPoint), kind, stationProhibited: kind === 'lake' || config.manualOverrides.stationProhibitedWaterNames.includes(name) }];
});
// The Dallas footprint service supplies outlines and area but no usable land-use tag.
// Preserve a supplied category where available; otherwise apply a transparent footprint
// scale classification so the contextual building palette is informative instead of gray.
const classifyBuilding = (feature) => {
  const supplied = String(property(feature, 'building', 'category') ?? '').toLowerCase();
  if (['residential', 'commercial', 'industrial', 'civic'].includes(supplied)) return supplied;
  const area = Number(property(feature, 'area_m2', 'area')) || 250;
  return area >= 25_000 ? 'industrial' : area >= 3_500 ? 'commercial' : 'residential';
};
const buildings = readFeatures(config.sources.buildings).slice(0, config.buildingRules.maxFeatures).flatMap((feature, index) => { const ring = simplify(coords(feature.geometry).filter(inside), config.buildingRules.simplifyEveryNthCoordinate); if (ring.length < 3) return []; return [{ id: id('building', feature, index), footprint: ring.map(toPoint), acquisitionValue: Math.max(50000, Math.round((Number(property(feature, 'area_m2', 'area')) || 250) * 180)), category: classifyBuilding(feature) }]; });
const clusters = (source, prefix, valueName, valueProperty) => readFeatures(source).flatMap((feature, index) => { const point = coords(feature.geometry)[0]; const value = Number(property(feature, valueProperty, valueName)); if (!point || !inside(point) || !Number.isFinite(value) || value < 0) return []; return [{ id: id(prefix, feature, index), coordinate: toPoint(point), [valueName]: Math.round(value), displayName: property(feature, 'name', 'label') }]; });
const population = clusters(config.sources.population, 'population', 'residents', config.populationRules.populationProperty);
// Keep the strongest demand clusters when a city deliberately caps its playable data.
const workplaces = [...clusters(config.sources.workplaces, 'workplace', 'jobs', config.workplaceRules.jobsProperty).sort((first, second) => second.jobs - first.jobs).slice(0, config.workplaceRules.maxClusters), ...config.manualOverrides.workplaces.map(({ id, name, latitude, longitude, jobs }) => ({ id, coordinate: { latitude, longitude }, jobs, displayName: name }))];
const pois = [...readFeatures(config.sources.pois).flatMap((feature, index) => { const point = coords(feature.geometry)[0]; const category = String(property(feature, 'category', 'amenity', 'tourism') ?? 'landmark'); return point && inside(point) && config.poiRules.categories.includes(category) ? [{ id: id('poi', feature, index), category, coordinate: toPoint(point), displayName: property(feature, 'name'), attractionWeight: 30 }] : []; }), ...config.manualOverrides.pois.map(({ id, name, category, latitude, longitude, weight }) => ({ id, category, coordinate: { latitude, longitude }, displayName: name, attractionWeight: weight }))];
const level = { metadata: { id: config.cityId, name: config.displayName, description: config.description, version: config.levelVersion, approximatePopulation: population.reduce((total, item) => total + item.residents, 0) }, bounds: config.bounds, roads, buildings, population, workplaces, pointsOfInterest: pois, waterways: water, landmarks: pois.filter((poi) => poi.category === 'landmark').map((poi) => ({ id: `landmark-${poi.id}`, name: poi.displayName ?? poi.id, coordinate: poi.coordinate })), economy: config.economy };
if (!roads.length || !population.length || !workplaces.length || !water.length) throw new Error('Generated level failed completeness checks: roads, water, population, and workplaces must each contain data.');
const output = absolute(config.output); mkdirSync(dirname(output), { recursive: true });
const serializedLevel = JSON.stringify(level).replaceAll('`', '\\`').replaceAll('${', '\\${');
writeFileSync(output, `// Generated by tools/real-city/src/cli.mjs. Do not hand-edit.\nimport type { LevelDefinition } from '../../world/types';\nexport const ${config.cityId.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}: LevelDefinition = JSON.parse(String.raw\`${serializedLevel}\`);\n`);
writeFileSync(resolve(dirname(output), `${config.cityId}.attribution.json`), `${JSON.stringify({ cityId: config.cityId, pipeline: 'tools/real-city/src/cli.mjs', processedAt: new Date().toISOString().slice(0, 10), sources: config.sources, sourceMetadata: config.sourceMetadata ?? {}, warnings: ['LODES WAC workplace counts are aggregated from Census blocks to tract-centroid gameplay clusters; they are not individual employer locations.'] }, null, 2)}\n`);
console.log(`Generated ${output}: ${roads.length} roads, ${buildings.length} buildings, ${population.length} population clusters, ${workplaces.length} workplaces, ${pois.length} POIs.`);
for (const [name, path] of Object.entries(config.sources)) console.log(`${name}: ${statSync(absolute(path)).size} bytes source`);
