import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import { stationFootprintPolygon, type ConstructionWorkflowSnapshot } from '../construction';
import type { World } from '../world';
import type { TransitOverlay } from './types';

type Collection = FeatureCollection<Geometry, GeoJsonProperties>;
const coordinate = ({ latitude, longitude }: { readonly latitude: number; readonly longitude: number }): [number, number] => [longitude, latitude];
const collection = (features: Collection['features']): Collection => ({ type: 'FeatureCollection', features });
export function createBaseSources(world: World): Record<string, Collection> { const level = world.definition; return {
  roads: collection(level.roads.map((road) => ({ type: 'Feature', properties: { id: road.id, name: road.name ?? '', classification: road.classification, speedKph: road.speedKph ?? null }, geometry: { type: 'LineString', coordinates: road.geometry.map(coordinate) } }))),
  buildings: collection(level.buildings.map((building) => ({ type: 'Feature', properties: { id: building.id, category: building.category ?? '', displayName: building.displayName ?? '' }, geometry: { type: 'Polygon', coordinates: [[...building.footprint.map(coordinate), coordinate(building.footprint[0])]] } }))),
  water: collection(level.waterways.map((waterway) => ({ type: 'Feature', properties: { id: waterway.id, kind: waterway.kind }, geometry: waterway.kind === 'lake' && waterway.geometry.length >= 3 ? { type: 'Polygon' as const, coordinates: [[...waterway.geometry.map(coordinate), coordinate(waterway.geometry[0])]] } : { type: 'LineString' as const, coordinates: waterway.geometry.map(coordinate) } }))),
  population: collection(level.population.map((record) => ({ type: 'Feature', properties: { id: record.id, residents: record.residents }, geometry: { type: 'Point', coordinates: coordinate(record.coordinate) } }))),
  workplaces: collection(level.workplaces.map((workplace) => ({ type: 'Feature', properties: { id: workplace.id, jobs: workplace.jobs, displayName: workplace.displayName ?? '', buildingId: workplace.buildingId ?? '' }, geometry: { type: 'Point', coordinates: coordinate(workplace.coordinate) } }))),
  pois: collection([...level.pointsOfInterest.map((poi) => ({ type: 'Feature' as const, properties: { id: poi.id, category: poi.category, displayName: poi.displayName ?? '' }, geometry: { type: 'Point' as const, coordinates: coordinate(poi.coordinate) } })), ...level.landmarks.map((landmark) => ({ type: 'Feature' as const, properties: { id: landmark.id, category: 'landmark', displayName: landmark.name }, geometry: { type: 'Point' as const, coordinates: coordinate(landmark.coordinate) } }))]),
  bounds: collection([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[coordinate(level.bounds.southWest), [level.bounds.northEast.longitude, level.bounds.southWest.latitude], coordinate(level.bounds.northEast), [level.bounds.southWest.longitude, level.bounds.northEast.latitude], coordinate(level.bounds.southWest)]] } }]),
}; }
export function createTransitSource(overlay: TransitOverlay): Collection { return collection(overlay.lines.map((line) => ({ type: 'Feature', properties: { id: line.id, color: line.color ?? '#ef6c45' }, geometry: { type: 'LineString', coordinates: line.geometry.map(coordinate) } }))); }
export function createTransitStopsSource(overlay: TransitOverlay): Collection { return collection(overlay.stops.map((stop) => ({ type: 'Feature', properties: { id: stop.id, name: stop.name ?? '' }, geometry: { type: 'Point', coordinates: coordinate(stop.coordinate) } }))); }
export function createTransitVehiclesSource(overlay: TransitOverlay): Collection { return collection((overlay.vehicles ?? []).map((vehicle) => ({ type: 'Feature', properties: { id: vehicle.id, color: vehicle.color ?? '#17211e', modeId: vehicle.modeId ?? '', lineId: vehicle.lineId ?? '', vehicleTypeId: vehicle.vehicleTypeId ?? '' }, geometry: { type: 'Point', coordinates: coordinate(vehicle.coordinate) } }))); }
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
      properties: { id: segment.id, kind: 'committed', mode: segment.mode },
      geometry: { type: 'LineString' as const, coordinates: segment.geometry.map(coordinate) },
    })),
    ...(pending?.proposal.kind === 'alignment' ? [{
      type: 'Feature' as const,
      properties: { id: pending.proposal.id, kind: valid ? 'pending-valid' : 'pending-invalid', river: riverIds.size > 0 },
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
  return { 'construction-demolitions': demolitions, 'construction-alignments': alignments, 'construction-stations': stations };
}
