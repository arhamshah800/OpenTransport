import fs from 'fs';
import path from 'path';

// Helper to convert IDs or filenames to camelCase variables
function toCamelCase(str) {
  return str
    .replace(/[-_]([a-z])/g, (g) => g[1].toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

// Helper to calculate area of footprint polygon in square meters
function calculateFootprintArea(footprint) {
  if (footprint.length < 3) return 0;
  const lat0 = footprint[0].latitude;
  const lon0 = footprint[0].longitude;
  const points = footprint.map(p => {
    const y = (p.latitude - lat0) * 111320;
    const x = (p.longitude - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180);
    return { x, y };
  });
  
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) * 0.5;
}

// Helper to get average centroid coordinate of polygon
function getCentroid(coords) {
  let latSum = 0;
  let lonSum = 0;
  for (const c of coords) {
    latSum += c.lat;
    lonSum += c.lon;
  }
  return { latitude: latSum / coords.length, longitude: lonSum / coords.length };
}

// Helper to estimate acquisition value based on footprint area and category
function calculateAcquisitionValue(area, type) {
  const baseValPerSqm = 200;
  let multiplier = 1.0;
  if (type === 'commercial' || type === 'workplace') {
    multiplier = 2.5;
  } else if (type === 'industrial') {
    multiplier = 1.8;
  } else if (type === 'poi') {
    multiplier = 3.0;
  }
  const variance = 0.95 + Math.random() * 0.1;
  return Math.round(area * baseValPerSqm * multiplier * variance);
}

// Classification helper for OSM elements
function classifyBuilding(element) {
  const tags = element.tags || {};
  const bType = tags.building || '';
  const amenity = tags.amenity || '';
  const shop = tags.shop || '';
  const office = tags.office || '';
  const craft = tags.craft || '';
  const industrial = tags.industrial || '';

  // POI Categories
  if (amenity === 'university' || amenity === 'college' || amenity === 'school') {
    return { type: 'poi', category: 'university', isWorkplace: true };
  }
  if (amenity === 'hospital' || amenity === 'clinic') {
    return { type: 'poi', category: 'hospital', isWorkplace: true };
  }
  if (amenity === 'library') {
    return { type: 'poi', category: 'government', isWorkplace: true };
  }
  if (['townhall', 'courthouse', 'post_office'].includes(amenity)) {
    return { type: 'poi', category: 'government', isWorkplace: true };
  }
  if (['stadium', 'sports_centre'].includes(tags.leisure) || ['theatre', 'cinema'].includes(amenity)) {
    return { type: 'poi', category: 'entertainment', isWorkplace: true };
  }
  if (tags.tourism === 'museum' || tags.tourism === 'gallery') {
    return { type: 'poi', category: 'landmark', isWorkplace: true };
  }

  // Commercial / Workplaces
  if (
    ['commercial', 'office', 'retail', 'supermarket', 'warehouse', 'industrial', 'factory'].includes(bType) ||
    office || shop || craft || industrial || amenity === 'restaurant' || amenity === 'cafe' || amenity === 'bank'
  ) {
    let category = 'commercial';
    if (['warehouse', 'industrial', 'factory'].includes(bType) || industrial || craft) {
      category = 'industrial';
    } else if (shop || amenity === 'restaurant' || amenity === 'cafe') {
      category = 'retail';
    }
    return { type: 'workplace', category, isWorkplace: true };
  }

  // Residential categories
  if (
    ['residential', 'apartments', 'house', 'detached', 'semidetached', 'terrace', 'dormitory', 'barracks'].includes(bType) ||
    bType === 'yes'
  ) {
    return { type: 'residential', category: bType === 'apartments' ? 'apartments' : 'residential', isResidential: true };
  }

  // Default fallback is residential
  return { type: 'residential', category: 'residential', isResidential: true };
}

// Argument Parser
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const parts = arg.split('=');
    const key = parts[0].slice(2);
    const value = parts.length > 1 ? parts.slice(1).join('=') : args[++i];
    options[key] = value;
  }
}

if (options.help || !options.id || !options.name || !options.bounds) {
  console.log(`
OpenTransport Level Importer Utility
-----------------------------------
Usage: node scripts/import-level.js [options]

Required parameters:
  --id         Unique ID for the level (e.g., boston-commons)
  --name       Display name for the level (e.g., Boston Commons)
  --bounds     Bounding box in format: south,west,north,east 
               (e.g., --bounds=42.348,-71.078,42.365,-71.050)

Optional parameters:
  --desc       Level description
  --population Target total residents to generate (default: 10000)
  --budget     Starting budget in dollars (default: 50000000)
  --row-cost   Right of way cost per meter of road (default: 5000)
  --underground-mult Underground cost multiplier (default: 2.5)
`);
  process.exit(0);
}

const levelId = options.id;
const levelName = options.name;
const description = options.desc || `Real-life map level for ${levelName}`;
const targetPopulation = parseInt(options.population || '10000', 10);
const startingBudget = parseInt(options.budget || '50000000', 10);
const roadRightOfWayCostPerMeter = parseInt(options.rowCost || '5000', 10);
const undergroundCostMultiplier = parseFloat(options.undergroundMult || '2.5');

const [south, west, north, east] = options.bounds.split(',').map(Number);
if (isNaN(south) || isNaN(west) || isNaN(north) || isNaN(east)) {
  console.error("Error: Bounds must be formatted as four comma-separated numbers (south,west,north,east).");
  process.exit(1);
}

// Bounding box size safety check
const sizeLat = north - south;
const sizeLon = east - west;
if (sizeLat > 0.15 || sizeLon > 0.15) {
  console.warn(`Warning: Bounding box size (${sizeLat.toFixed(3)} x ${sizeLon.toFixed(3)} degrees) is relatively large.`);
  console.warn(`It may result in a very large dataset that could lag the browser rendering. Recommended size is <= 0.05.`);
}

async function fetchOSMData() {
  const query = `[out:json][timeout:180];
(
  way["highway"](${south},${west},${north},${east});
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
  way["waterway"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
  node["amenity"~"university|college|school|hospital|clinic|library|townhall|courthouse|post_office|stadium|sports_centre|theatre|cinema|museum|gallery|station|terminal"](${south},${west},${north},${east});
  way["amenity"~"university|college|school|hospital|clinic|library|townhall|courthouse|post_office|stadium|sports_centre|theatre|cinema|museum|gallery|station|terminal"](${south},${west},${north},${east});
  node["historic"](${south},${west},${north},${east});
  way["historic"](${south},${west},${north},${east});
  node["tourism"~"attraction|museum|gallery|theme_park"](${south},${west},${north},${east});
  way["tourism"~"attraction|museum|gallery|theme_park"](${south},${west},${north},${east});
);
out geom;`;

  console.log(`Requesting map data from Overpass API for bounds [${south}, ${west}, ${north}, ${east}]...`);
  const url = 'https://overpass-api.de/api/interpreter';
  
  try {
    const response = await fetch(url + '?data=' + encodeURIComponent(query), {
      method: 'GET',
      headers: {
        'User-Agent': 'OpenTransportMapImporter/1.0 (contact: playopentransport@example.com)'
      }
    });
    if (!response.ok) {
      throw new Error(`Overpass API returned status ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Failed to fetch map data:", error);
    process.exit(1);
  }
}

function parseOSMData(osmJson) {
  const elements = osmJson.elements || [];
  console.log(`Received ${elements.length} raw map features. Processing...`);
  
  const roads = [];
  const buildings = [];
  const rawPopulation = [];
  const rawWorkplaces = [];
  const pointsOfInterest = [];
  const waterways = [];
  const landmarks = [];
  
  let minLat = south;
  let maxLat = north;
  let minLon = west;
  let maxLon = east;
  
  function updateBounds(lat, lon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  
  const processedBuildingIds = new Set();
  const processedRoadIds = new Set();
  const processedPoiIds = new Set();
  const processedWaterwayIds = new Set();
  const processedLandmarkIds = new Set();
  
  // 1. Process Ways & Relations first (geometry-based elements)
  for (const element of elements) {
    const tags = element.tags || {};
    const id = String(element.id);
    
    // Process Roads (highway key)
    if (tags.highway && element.type === 'way') {
      if (processedRoadIds.has(id)) continue;
      processedRoadIds.add(id);
      
      const geometry = (element.geometry || []).map(p => {
        updateBounds(p.lat, p.lon);
        return { latitude: p.lat, longitude: p.lon };
      });
      
      if (geometry.length < 2) continue;
      
      const highway = tags.highway;
      let classification = 'local';
      let speedKph = 30;
      
      if (['motorway', 'trunk', 'motorway_link', 'trunk_link'].includes(highway)) {
        classification = 'highway';
        speedKph = 90;
      } else if (['primary', 'secondary', 'primary_link', 'secondary_link'].includes(highway)) {
        classification = 'arterial';
        speedKph = 55;
      } else if (['tertiary', 'tertiary_link'].includes(highway)) {
        classification = 'local';
        speedKph = 40;
      }
      
      if (tags.maxspeed) {
        const match = tags.maxspeed.match(/^(\d+)\s*(mph|km\/h)?/i);
        if (match) {
          let speedVal = parseInt(match[1], 10);
          if (match[2] && match[2].toLowerCase() === 'mph') {
            speedVal = Math.round(speedVal * 1.609);
          }
          if (speedVal > 0) speedKph = speedVal;
        }
      }
      
      roads.push({
        id: `road-${id}`,
        name: tags.name || undefined,
        geometry,
        classification,
        speedKph
      });
    }
    
    // Process Waterways & waterbodies
    else if ((tags.waterway || tags.natural === 'water') && (element.type === 'way' || element.type === 'relation')) {
      if (processedWaterwayIds.has(id)) continue;
      processedWaterwayIds.add(id);
      
      let geometry = [];
      if (element.type === 'way') {
        geometry = (element.geometry || []).map(p => {
          updateBounds(p.lat, p.lon);
          return { latitude: p.lat, longitude: p.lon };
        });
      } else if (element.type === 'relation') {
        const outer = element.members?.find(m => m.type === 'way' && (m.role === 'outer' || !m.role));
        if (outer && outer.geometry) {
          geometry = outer.geometry.map(p => {
            updateBounds(p.lat, p.lon);
            return { latitude: p.lat, longitude: p.lon };
          });
        }
      }
      
      if (geometry.length < 2) continue;
      
      let kind = 'river';
      if (tags.natural === 'water' || tags.water === 'lake' || tags.waterway === 'lake') {
        kind = 'lake';
      } else if (tags.waterway === 'canal') {
        kind = 'canal';
      }
      
      waterways.push({
        id: `waterway-${id}`,
        geometry,
        kind
      });
    }
    
    // Process Buildings
    else if (tags.building && tags.building !== 'no') {
      if (processedBuildingIds.has(id)) continue;
      processedBuildingIds.add(id);
      
      let osmGeom = null;
      if (element.type === 'way') {
        osmGeom = element.geometry;
      } else if (element.type === 'relation') {
        const outer = element.members?.find(m => m.type === 'way' && (m.role === 'outer' || !m.role));
        if (outer) osmGeom = outer.geometry;
      }
      
      if (!osmGeom || osmGeom.length < 3) continue;
      
      const footprint = osmGeom.map(p => {
        updateBounds(p.lat, p.lon);
        return { latitude: p.lat, longitude: p.lon };
      });
      
      const area = calculateFootprintArea(footprint);
      const categoryInfo = classifyBuilding(element);
      const acquisitionValue = calculateAcquisitionValue(area, categoryInfo.type);
      const buildingId = `building-${id}`;
      
      buildings.push({
        id: buildingId,
        footprint,
        acquisitionValue,
        category: categoryInfo.type === 'poi' ? 'mixed-use' : categoryInfo.type,
        displayName: tags.name || undefined
      });
      
      const centroid = getCentroid(osmGeom);
      
      if (categoryInfo.isResidential) {
        rawPopulation.push({
          id: `residents-${id}`,
          coordinate: centroid,
          buildingId,
          rawResidentsWeight: area * (categoryInfo.category === 'apartments' ? 0.15 : 0.05)
        });
      } else if (categoryInfo.isWorkplace) {
        let density = 0.08;
        if (categoryInfo.category === 'industrial') density = 0.04;
        else if (categoryInfo.category === 'retail') density = 0.1;
        else if (categoryInfo.category === 'office') density = 0.15;
        
        rawWorkplaces.push({
          id: `workplace-${id}`,
          coordinate: centroid,
          buildingId,
          displayName: tags.name || undefined,
          rawJobsWeight: area * density
        });
      }
      
      // POI Building
      if (categoryInfo.type === 'poi') {
        let attractionWeight = 50;
        if (categoryInfo.category === 'university') attractionWeight = 85;
        else if (categoryInfo.category === 'hospital') attractionWeight = 75;
        else if (categoryInfo.category === 'entertainment') attractionWeight = 90;
        else if (categoryInfo.category === 'government') attractionWeight = 40;
        
        pointsOfInterest.push({
          id: `poi-${id}`,
          category: categoryInfo.category,
          coordinate: centroid,
          attractionWeight,
          buildingId,
          displayName: tags.name || undefined
        });
      }
    }
  }
  
  // 2. Process standalone Nodes (POIs and Landmarks)
  for (const element of elements) {
    if (element.type === 'node') {
      const tags = element.tags || {};
      const id = String(element.id);
      const coordinate = { latitude: element.lat, longitude: element.lon };
      updateBounds(element.lat, element.lon);
      
      const amenity = tags.amenity || '';
      
      let isPoi = false;
      let poiCategory = '';
      let attractionWeight = 30;
      
      if (amenity === 'university' || amenity === 'college' || amenity === 'school') {
        isPoi = true;
        poiCategory = 'university';
        attractionWeight = 80;
      } else if (amenity === 'hospital' || amenity === 'clinic') {
        isPoi = true;
        poiCategory = 'hospital';
        attractionWeight = 70;
      } else if (amenity === 'library') {
        isPoi = true;
        poiCategory = 'government';
        attractionWeight = 45;
      } else if (['townhall', 'courthouse', 'post_office'].includes(amenity)) {
        isPoi = true;
        poiCategory = 'government';
        attractionWeight = 40;
      } else if (['stadium', 'sports_centre'].includes(tags.leisure) || ['theatre', 'cinema'].includes(amenity)) {
        isPoi = true;
        poiCategory = 'entertainment';
        attractionWeight = 90;
      } else if (tags.tourism === 'museum' || tags.tourism === 'gallery') {
        isPoi = true;
        poiCategory = 'landmark';
        attractionWeight = 50;
      }
      
      if (isPoi) {
        if (processedPoiIds.has(id)) continue;
        processedPoiIds.add(id);
        
        pointsOfInterest.push({
          id: `poi-${id}`,
          category: poiCategory,
          coordinate,
          attractionWeight,
          displayName: tags.name || undefined
        });
      }
      
      const isLandmark = tags.historic || tags.tourism === 'attraction' || tags.landmark || tags.monument || tags.railway === 'station';
      if (isLandmark) {
        if (processedLandmarkIds.has(id)) continue;
        processedLandmarkIds.add(id);
        
        landmarks.push({
          id: `landmark-${id}`,
          name: tags.name || tags.historic || tags.tourism || 'Historic Landmark',
          coordinate
        });
      }
    }
  }
  
  // 3. Fallbacks to prevent game engine crashes
  if (buildings.length === 0) {
    console.warn("Warning: Zero buildings found. Generating placeholder core nodes.");
    const centerLat = (south + north) / 2;
    const centerLon = (west + east) / 2;
    const mockFootprint = [
      { latitude: centerLat - 0.0003, longitude: centerLon - 0.0003 },
      { latitude: centerLat - 0.0003, longitude: centerLon + 0.0003 },
      { latitude: centerLat + 0.0003, longitude: centerLon + 0.0003 },
      { latitude: centerLat + 0.0003, longitude: centerLon - 0.0003 },
    ];
    
    buildings.push({
      id: "building-placeholder-res",
      footprint: mockFootprint,
      acquisitionValue: 120000,
      category: 'residential'
    });
    buildings.push({
      id: "building-placeholder-work",
      footprint: mockFootprint.map(p => ({ latitude: p.latitude + 0.001, longitude: p.longitude + 0.001 })),
      acquisitionValue: 280000,
      category: 'mixed-use'
    });
    rawPopulation.push({
      id: "residents-placeholder",
      coordinate: { latitude: centerLat, longitude: centerLon },
      buildingId: "building-placeholder-res",
      rawResidentsWeight: 100
    });
    rawWorkplaces.push({
      id: "workplace-placeholder",
      coordinate: { latitude: centerLat + 0.001, longitude: centerLon + 0.001 },
      buildingId: "building-placeholder-work",
      displayName: "Placeholder Workplace",
      rawJobsWeight: 100
    });
  }
  
  if (rawPopulation.length === 0) {
    const b = buildings[0];
    const centroid = getCentroid(b.footprint.map(c => ({ lat: c.latitude, lon: c.longitude })));
    rawPopulation.push({
      id: `residents-${b.id}`,
      coordinate: centroid,
      buildingId: b.id,
      rawResidentsWeight: 100
    });
  }
  
  if (rawWorkplaces.length === 0) {
    const b = buildings[buildings.length - 1];
    const centroid = getCentroid(b.footprint.map(c => ({ lat: c.latitude, lon: c.longitude })));
    rawWorkplaces.push({
      id: `workplace-${b.id}`,
      coordinate: centroid,
      buildingId: b.id,
      displayName: "Local Employment Site",
      rawJobsWeight: 100
    });
  }
  
  // 4. Proportionally scale Residents & Jobs to target figures
  const totalRawPop = rawPopulation.reduce((sum, p) => sum + p.rawResidentsWeight, 0);
  const populationList = rawPopulation.map((p, idx) => {
    const share = p.rawResidentsWeight / totalRawPop;
    let residentsCount = Math.round(share * targetPopulation);
    if (residentsCount === 0 && idx === 0) residentsCount = 1;
    return {
      id: p.id,
      coordinate: p.coordinate,
      residents: residentsCount,
      buildingId: p.buildingId
    };
  }).filter(p => p.residents > 0);
  
  const targetJobs = Math.round(targetPopulation * 0.75); // Target balanced employment rate
  const totalRawJobs = rawWorkplaces.reduce((sum, w) => sum + w.rawJobsWeight, 0);
  const workplaceList = rawWorkplaces.map((w, idx) => {
    const share = w.rawJobsWeight / totalRawJobs;
    let jobsCount = Math.round(share * targetJobs);
    if (jobsCount === 0 && idx === 0) jobsCount = 1;
    return {
      id: w.id,
      coordinate: w.coordinate,
      jobs: jobsCount,
      buildingId: w.buildingId,
      displayName: w.displayName
    };
  }).filter(w => w.jobs > 0);
  
  // 5. Build bounding box enclosing all exported geometries plus tiny safety margin
  const bounds = {
    southWest: { latitude: minLat - 0.0005, longitude: minLon - 0.0005 },
    northEast: { latitude: maxLat + 0.0005, longitude: maxLon + 0.0005 }
  };
  
  console.log(`Processed:`);
  console.log(`  - Roads: ${roads.length}`);
  console.log(`  - Buildings: ${buildings.length}`);
  console.log(`  - Waterways: ${waterways.length}`);
  console.log(`  - POIs: ${pointsOfInterest.length}`);
  console.log(`  - Landmarks: ${landmarks.length}`);
  console.log(`  - Total Residents: ${populationList.reduce((sum, p) => sum + p.residents, 0)}`);
  console.log(`  - Total Jobs: ${workplaceList.reduce((sum, w) => sum + w.jobs, 0)}`);
  
  return {
    metadata: {
      id: levelId,
      name: levelName,
      description,
      version: 1,
      approximatePopulation: targetPopulation
    },
    bounds,
    roads,
    buildings,
    population: populationList,
    workplaces: workplaceList,
    pointsOfInterest,
    waterways,
    landmarks,
    economy: {
      startingBudget,
      currency: 'USD'
    },
    construction: {
      roadRightOfWayCostPerMeter,
      undergroundCostMultiplier
    }
  };
}

// Local schema verification to catch problems early
function validateLevelLocal(level) {
  console.log("Verifying level layout integrity...");
  const bounds = level.bounds;
  const insideBounds = (coord) => 
    coord.latitude >= bounds.southWest.latitude && 
    coord.latitude <= bounds.northEast.latitude && 
    coord.longitude >= bounds.southWest.longitude && 
    coord.longitude <= bounds.northEast.longitude;
    
  if (bounds.southWest.latitude >= bounds.northEast.latitude) {
    throw new Error("Invalid bounds: SouthWest latitude must be smaller than NorthEast latitude");
  }
  if (bounds.southWest.longitude >= bounds.northEast.longitude) {
    throw new Error("Invalid bounds: SouthWest longitude must be smaller than NorthEast longitude");
  }

  for (const road of level.roads) {
    if (road.geometry.length < 2) throw new Error(`Road "${road.id}" must have at least 2 points`);
    road.geometry.forEach(p => {
      if (!insideBounds(p)) throw new Error(`Road "${road.id}" has coordinate outside level bounds`);
    });
  }
  
  for (const b of level.buildings) {
    if (b.footprint.length < 3) throw new Error(`Building "${b.id}" footprint must have at least 3 points`);
    b.footprint.forEach(p => {
      if (!insideBounds(p)) throw new Error(`Building "${b.id}" has coordinate outside level bounds`);
    });
  }
  
  const buildingIds = new Set(level.buildings.map(b => b.id));
  
  for (const p of level.population) {
    if (!insideBounds(p.coordinate)) throw new Error(`Population record "${p.id}" has coordinate outside level bounds`);
    if (p.buildingId && !buildingIds.has(p.buildingId)) {
      throw new Error(`Population record "${p.id}" references missing buildingId "${p.buildingId}"`);
    }
  }
  
  for (const w of level.workplaces) {
    if (!insideBounds(w.coordinate)) throw new Error(`Workplace "${w.id}" has coordinate outside level bounds`);
    if (w.buildingId && !buildingIds.has(w.buildingId)) {
      throw new Error(`Workplace "${w.id}" references missing buildingId "${w.buildingId}"`);
    }
  }
  
  for (const poi of level.pointsOfInterest) {
    if (!insideBounds(poi.coordinate)) throw new Error(`POI "${poi.id}" has coordinate outside level bounds`);
    if (poi.buildingId && !buildingIds.has(poi.buildingId)) {
      throw new Error(`POI "${poi.id}" references missing buildingId "${poi.buildingId}"`);
    }
  }
  
  console.log("Success: Level layout matches all structural validations!");
}

function writeLevelFile(level) {
  const levelsDir = path.join(process.cwd(), 'src', 'levels');
  const outputPath = path.join(levelsDir, `${level.metadata.id}.ts`);
  
  const varName = toCamelCase(level.metadata.id);
  const content = `import type { LevelDefinition } from '../world/types';

export const ${varName}: LevelDefinition = ${JSON.stringify(level, null, 2)};
`;

  fs.writeFileSync(outputPath, content, 'utf8');
  console.log(`Saved typescript level file to: ${outputPath}`);
}

function updateLevelManifest() {
  const levelsDir = path.join(process.cwd(), 'src', 'levels');
  const manifestPath = path.join(levelsDir, 'manifest.ts');
  
  const files = fs.readdirSync(levelsDir);
  const levelFiles = files.filter(f => f.endsWith('.ts') && f !== 'manifest.ts' && f !== 'levels.test.ts');
  
  const imports = [];
  const entries = [];
  
  for (const file of levelFiles) {
    const name = file.replace('.ts', '');
    const camelName = toCamelCase(name);
    imports.push(`import { ${camelName} } from './${name}';`);
    entries.push(`entry(${camelName})`);
  }
  
  const content = `import { createLevelRegistry } from '../world/registry';
${imports.join('\n')}

const entry = (level: any) => ({
  summary: {
    id: level.metadata.id,
    name: level.metadata.name,
    description: level.metadata.description,
    approximatePopulation: level.metadata.approximatePopulation,
    bounds: level.bounds
  },
  load: async () => level
});

export const levelRegistry = createLevelRegistry([
  ${entries.join(',\n  ')}
]);
`;

  fs.writeFileSync(manifestPath, content, 'utf8');
  console.log(`Level registry manifest updated successfully!`);
}

// MAIN FUNCTION EXECUTION
async function main() {
  const rawData = await fetchOSMData();
  const level = parseOSMData(rawData);
  validateLevelLocal(level);
  writeLevelFile(level);
  updateLevelManifest();
  console.log("Done!");
}

main().catch(err => {
  console.error("Importer failed:", err);
  process.exit(1);
});
