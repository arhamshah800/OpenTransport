#!/usr/bin/env node
/** Download small, reproducible DFW GIS extracts from public ArcGIS services. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const out = resolve(root, 'data/raw/dallas');
mkdirSync(out, { recursive: true });
const bbox = '-97.12,32.58,-96.42,33.24';
const query = async (service, fields, where = '1=1', limit = 12000) => {
  const base = `${service}/query`;
  const rows = [];
  for (let offset = 0; offset < limit; offset += 2000) {
    const params = new URLSearchParams({ where, geometry: bbox, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: fields, returnGeometry: 'true', f: 'geojson', resultOffset: String(offset), resultRecordCount: '2000' });
    const response = await fetch(`${base}?${params}`);
    if (!response.ok) throw new Error(`${service} returned ${response.status}`);
    const page = await response.json();
    const features = page.features ?? [];
    rows.push(...features);
    if (features.length < 2000) break;
  }
  return { type: 'FeatureCollection', features: rows };
};
const save = (name, value) => writeFileSync(resolve(out, name), `${JSON.stringify(value)}\n`);

// State-maintained corridors give the full DFW highway skeleton. City streets give
// bus-stop-eligible surface routing where the player is most likely to build first.
const txdot = await query('https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadways/FeatureServer/0', 'OBJECTID,RTE_NM,RTE_PRFX,RTE_NBR,MAP_LBL,SYSTEM', "SYSTEM='On'", 12000);
const dallas = await query('https://services2.arcgis.com/rwnOSbfKSwyTBcwN/arcgis/rest/services/DallasAreaRoads/FeatureServer/0', 'OBJECTID,NAME,TYPE', '1=1', 12000);
save('roads.geojson', { type: 'FeatureCollection', features: [...txdot.features.map((feature) => ({ ...feature, properties: { ...feature.properties, source: 'txdot' } })), ...dallas.features.map((feature) => ({ ...feature, properties: { ...feature.properties, source: 'dallas' } }))] });

const tracts = await query('https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Census_Tracts/FeatureServer/0', 'FIPS,POPULATION,POPULATION_2020,POP_SQMI', '1=1', 4000);
// The generator uses points; use a bbox centre for each tract after public-source clipping.
save('population.geojson', { type: 'FeatureCollection', features: tracts.features.map((feature) => ({ type: 'Feature', properties: { population: feature.properties.POPULATION_2020 ?? feature.properties.POPULATION ?? 0, source: 'USA Census Tracts 2020' }, geometry: { type: 'Point', coordinates: feature.geometry.coordinates[0][0] } })) });

const waterBodies = await query('https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Detailed_Water_Bodies/FeatureServer/0', 'NAME,FTYPE', '1=1', 4000);
const rivers = await query('https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/USA_Rivers_and_Streams/FeatureServer/0', 'NAME,FTYPE', '1=1', 4000);
save('waterways.geojson', { type: 'FeatureCollection', features: [...waterBodies.features, ...rivers.features] });

// This public Dallas footprint layer is much faster to clip than the nationwide FEMA service.
const buildings = await query('https://services5.arcgis.com/njRHYVhl2CMXMsap/arcgis/rest/services/building_footprint_in_Dallas/FeatureServer/0', 'FID,Shape__Area', '1=1', 5000);
save('buildings.geojson', { type: 'FeatureCollection', features: buildings.features.map((feature) => ({ ...feature, properties: { ...feature.properties, area_m2: feature.properties.Shape__Area ?? 250, building: 'building' } })) });
const employers = await query('https://services2.arcgis.com/VNo0ht0YPXJoI4oE/arcgis/rest/services/Employers/FeatureServer/0', 'EmpID,EmpName,Employees,NAICS,City', '1=1', 12000);
save('workplaces.geojson', { type: 'FeatureCollection', features: employers.features.map((feature) => ({ ...feature, properties: { ...feature.properties, jobs: feature.properties.Employees ?? 0, name: feature.properties.EmpName } })) });
save('pois.geojson', { type: 'FeatureCollection', features: [] });
console.log(`Downloaded ${txdot.features.length} TxDOT corridors, ${dallas.features.length} Dallas streets, ${tracts.features.length} Census tracts, ${buildings.features.length} building footprints, ${employers.features.length} employer records, and ${waterBodies.features.length + rivers.features.length} water features to ${out}`);
