import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import { stationFootprintPolygon, type ConstructionWorkflowSnapshot } from '../construction';
import type { World } from '../world';
import type { TransitOverlay } from './types';

type Collection = FeatureCollection<Geometry, GeoJsonProperties>;
const coordinate = ({ latitude, longitude }: { readonly latitude: number; readonly longitude: number }): [number, number] => [longitude, latitude];
const collection = (features: Collection['features']): Collection => ({ type: 'FeatureCollection', features });
export function createBaseSources(world: World): Record<string, Collection> { const level = world.definition; return {
  roads: collection(level.roads.map((road) => ({ type: 'Feature', properties: { id: road.id, name: road.name ?? '', classification: road.classification, speedKph: road.speedKph ?? null }, geometry: { type: 'LineString', coordinates: road.geometry.map(coordinate) } }))),
  buildings: collection(level.buildings.map((building) => ({ type: 'Feature', properties: { id: building.id, category: building.category ?? '', displayName: building.displayName ?? '', acquisitionValue: building.acquisitionValue }, geometry: { type: 'Polygon', coordinates: [[...building.footprint.map(coordinate), coordinate(building.footprint[0])]] } }))),
  'acquisition-costs': collection(level.buildings.map((building) => {
    const points = building.footprint;
    const center = points.reduce((sum, point) => ({ latitude: sum.latitude + point.latitude, longitude: sum.longitude + point.longitude }), { latitude: 0, longitude: 0 });
    return { type: 'Feature' as const, properties: { id: building.id, acquisitionValue: building.acquisitionValue, displayName: building.displayName ?? '' }, geometry: { type: 'Point' as const, coordinates: coordinate({ latitude: center.latitude / points.length, longitude: center.longitude / points.length }) } };
  })),
  water: collection(level.waterways.map((waterway) => ({ type: 'Feature', properties: { id: waterway.id, kind: waterway.kind }, geometry: waterway.kind === 'lake' && waterway.geometry.length >= 3 ? { type: 'Polygon' as const, coordinates: [[...waterway.geometry.map(coordinate), coordinate(waterway.geometry[0])]] } : { type: 'LineString' as const, coordinates: waterway.geometry.map(coordinate) } }))),
  population: collection(level.population.map((record) => ({ type: 'Feature', properties: { id: record.id, residents: record.residents }, geometry: { type: 'Point', coordinates: coordinate(record.coordinate) } }))),
  workplaces: collection(level.workplaces.map((workplace) => ({ type: 'Feature', properties: { id: workplace.id, jobs: workplace.jobs, displayName: workplace.displayName ?? '', buildingId: workplace.buildingId ?? '' }, geometry: { type: 'Point', coordinates: coordinate(workplace.coordinate) } }))),
  pois: collection([...level.pointsOfInterest.map((poi) => ({ type: 'Feature' as const, properties: { id: poi.id, category: poi.category, displayName: poi.displayName ?? '' }, geometry: { type: 'Point' as const, coordinates: coordinate(poi.coordinate) } })), ...level.landmarks.map((landmark) => ({ type: 'Feature' as const, properties: { id: landmark.id, category: 'landmark', displayName: landmark.name }, geometry: { type: 'Point' as const, coordinates: coordinate(landmark.coordinate) } }))]),
  bounds: collection([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[coordinate(level.bounds.southWest), [level.bounds.northEast.longitude, level.bounds.southWest.latitude], coordinate(level.bounds.northEast), [level.bounds.southWest.longitude, level.bounds.northEast.latitude], coordinate(level.bounds.southWest)]] } }]),
  context: createCityContext(world),
}; }

/** A small, authored context layer keeps the regional game readable even when tiles are unavailable. */
function createCityContext(world: World): Collection {
  if (world.definition.metadata.id !== 'dallas') return collection([]);
  const point = (id: string, name: string, longitude: number, latitude: number, kind: string) => ({ type: 'Feature' as const, properties: { id, name, kind }, geometry: { type: 'Point' as const, coordinates: [longitude, latitude] } });
  const polygon = (id: string, name: string, ring: readonly [number, number][], kind: string) => ({ type: 'Feature' as const, properties: { id, name, kind }, geometry: { type: 'Polygon' as const, coordinates: [[...ring, ring[0]]] } });
  return collection([
    point('district-downtown', 'DOWNTOWN', -96.7969, 32.7785, 'district'),
    point('district-uptown', 'UPTOWN', -96.8067, 32.7945, 'district'),
    point('district-medical', 'MEDICAL DISTRICT', -96.8208, 32.811, 'district'),
    point('district-las-colinas', 'LAS COLINAS', -96.949, 32.868, 'district'),
    point('district-plano', 'PLANO', -96.698, 33.02, 'district'),
    point('district-frisco', 'FRISCO', -96.824, 33.15, 'district'),
    point('district-oak-cliff', 'OAK CLIFF', -96.835, 32.735, 'district'),
    point('district-deep-ellum', 'DEEP ELLUM', -96.783, 32.784, 'district'),
    point('place-white-rock', 'WHITE ROCK LAKE', -96.726, 32.842, 'water-label'),
    point('place-trinity', 'TRINITY RIVER', -96.83, 32.77, 'water-label'),
    polygon('airport-dfw', 'DFW INTERNATIONAL AIRPORT', [[-97.09, 32.875], [-97.02, 32.875], [-97.02, 32.92], [-97.09, 32.92]], 'airport'),
    polygon('airport-love', 'DALLAS LOVE FIELD', [[-96.87, 32.835], [-96.84, 32.835], [-96.84, 32.857], [-96.87, 32.857]], 'airport'),
    polygon('park-klyde-warren', 'KLYDE WARREN PARK', [[-96.806, 32.79], [-96.8, 32.79], [-96.8, 32.794], [-96.806, 32.794]], 'park'),
    polygon('park-trinity', 'TRINITY OVERLOOK', [[-96.85, 32.76], [-96.825, 32.76], [-96.825, 32.778], [-96.85, 32.778]], 'park'),
  ]);
}
export function createTransitSource(overlay: TransitOverlay): Collection { return collection(overlay.lines.map((line) => ({ type: 'Feature', properties: { id: line.id, color: line.color ?? '#ef6c45' }, geometry: { type: 'LineString', coordinates: line.geometry.map(coordinate) } }))); }
export function createTransitStopsSource(overlay: TransitOverlay): Collection { return collection(overlay.stops.map((stop) => ({ type: 'Feature', properties: { id: stop.id, name: stop.name ?? '', draftRole: stop.draftRole ?? '' }, geometry: { type: 'Point', coordinates: coordinate(stop.coordinate) } }))); }
export function createTransitVehiclesSource(overlay: TransitOverlay): Collection { return collection((overlay.vehicles ?? []).map((vehicle) => ({ type: 'Feature', properties: { id: vehicle.id, color: vehicle.color ?? '#17211e', modeId: vehicle.modeId ?? '', lineId: vehicle.lineId ?? '', vehicleTypeId: vehicle.vehicleTypeId ?? '', state: vehicle.state ?? '' }, geometry: { type: 'Point', coordinates: coordinate(vehicle.coordinate) } }))); }
export function createDemandSource(points: readonly { readonly id: string; readonly coordinate: { readonly latitude: number; readonly longitude: number }; readonly weight: number }[]): Collection {
  return collection(points.map((point) => ({ type: 'Feature', properties: { id: point.id, weight: point.weight }, geometry: { type: 'Point', coordinates: coordinate(point.coordinate) } })));
}

/** GeoJSON for construction previews so MapLibre keeps ghosts aligned with the camera. */
export function createConstructionSources(world: World, overlay: ConstructionWorkflowSnapshot): Record<string, Collection> {
  const pending = overlay.pending;
  const valid = Boolean(pending?.evaluation.valid && pending.affordable);
  const riverIds = new Set(pending?.evaluation.estimate.riverCrossingIds ?? []);
  const demolitions = collection([
    ...overlay.state.demolishedBuildingIds.flatMap((id) => {
      const building = world.definition.buildings.find((item) => item.id === id);
      return building ? [{ type: 'Feature' as const, properties: { id, kind: 'committed' }, geometry: { type: 'Polygon' as const, coordinates: [[...building.footprint.map(coordinate), coordinate(building.footprint[0])]] } }] : [];
    }),
    ...(pending?.evaluation.estimate.demolitionImpacts ?? []).flatMap((impact) => {
      const building = world.definition.buildings.find((item) => item.id === impact.buildingId);
      return building ? [{ type: 'Feature' as const, properties: { id: impact.buildingId, kind: 'pending' }, geometry: { type: 'Polygon' as const, coordinates: [[...building.footprint.map(coordinate), coordinate(building.footprint[0])]] } }] : [];
    }),
  ]);
  const alignments = collection([
    ...overlay.state.engineeringSegments.map((segment) => ({
      type: 'Feature' as const,
      properties: { id: segment.id, kind: 'committed', mode: segment.mode, elevated: Boolean(segment.verticalProfile && segment.verticalProfile.startElevationMeters > 0) },
      geometry: { type: 'LineString' as const, coordinates: segment.geometry.map(coordinate) },
    })),
    ...(pending?.proposal.kind === 'alignment' ? [{
      type: 'Feature' as const,
      properties: { id: pending.proposal.id, kind: valid ? 'pending-valid' : 'pending-invalid', river: riverIds.size > 0, elevated: Boolean(pending.proposal.verticalProfile && pending.proposal.verticalProfile.startElevationMeters > 0) },
      geometry: { type: 'LineString' as const, coordinates: pending.proposal.geometry.map(coordinate) },
    }] : []),
    ...[...riverIds].flatMap((id) => {
      const waterway = world.definition.waterways.find((item) => item.id === id);
      return waterway ? [{ type: 'Feature' as const, properties: { id: `river-${id}`, kind: 'river' }, geometry: { type: 'LineString' as const, coordinates: waterway.geometry.map(coordinate) } }] : [];
    }),
  ]);
  const stations = collection([
    ...overlay.state.stations.map((station, index) => {
      const ring = stationFootprintPolygon(station);
      return {
        type: 'Feature' as const,
        properties: { id: `station-${index}`, kind: 'committed' },
        geometry: { type: 'Polygon' as const, coordinates: [[...ring.map(coordinate), coordinate(ring[0])]] },
      };
    }),
    ...(pending?.proposal.kind === 'station' ? (() => {
      const ring = stationFootprintPolygon(pending.proposal.footprint);
      return [{
        type: 'Feature' as const,
        properties: { id: pending.proposal.id, kind: valid ? 'pending-valid' : 'pending-invalid' },
        geometry: { type: 'Polygon' as const, coordinates: [[...ring.map(coordinate), coordinate(ring[0])]] },
      }];
    })() : []),
  ]);
  const catchments = collection((pending?.proposal.kind === 'station' ? [pending.proposal.footprint.center] : []).map((center) => ({ type: 'Feature' as const, properties: { id: 'station-catchment' }, geometry: { type: 'Point' as const, coordinates: coordinate(center) } })));
  const entrances = collection([
    ...overlay.state.stations.flatMap((station, stationIndex) => (station.entrances ?? []).map((entrance, entranceIndex) => ({ type: 'Feature' as const, properties: { id: `station-${stationIndex}-entrance-${entranceIndex}`, kind: 'committed' }, geometry: { type: 'Point' as const, coordinates: coordinate(entrance) } }))),
    ...(pending?.proposal.kind === 'station' ? (pending.proposal.footprint.entrances ?? []).map((entrance, index) => ({ type: 'Feature' as const, properties: { id: `pending-entrance-${index}`, kind: valid ? 'pending-valid' : 'pending-invalid' }, geometry: { type: 'Point' as const, coordinates: coordinate(entrance) } })) : []),
  ]);
  return { 'construction-demolitions': demolitions, 'construction-alignments': alignments, 'construction-stations': stations, 'construction-catchments': catchments, 'construction-entrances': entrances };
}
