import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import type { World } from '../world';
import type { TransitOverlay } from './types';

type Collection = FeatureCollection<Geometry, GeoJsonProperties>;
const coordinate = ({ latitude, longitude }: { readonly latitude: number; readonly longitude: number }): [number, number] => [longitude, latitude];
const collection = (features: Collection['features']): Collection => ({ type: 'FeatureCollection', features });
export function createBaseSources(world: World): Record<string, Collection> { const level = world.definition; return {
  roads: collection(level.roads.map((road) => ({ type: 'Feature', properties: { id: road.id, name: road.name ?? '', classification: road.classification, speedKph: road.speedKph ?? null }, geometry: { type: 'LineString', coordinates: road.geometry.map(coordinate) } }))),
  buildings: collection(level.buildings.map((building) => ({ type: 'Feature', properties: { id: building.id, category: building.category ?? '', displayName: building.displayName ?? '' }, geometry: { type: 'Polygon', coordinates: [[...building.footprint.map(coordinate), coordinate(building.footprint[0])]] } }))),
  water: collection(level.waterways.map((waterway) => ({ type: 'Feature', properties: { id: waterway.id, kind: waterway.kind }, geometry: { type: 'LineString', coordinates: waterway.geometry.map(coordinate) } }))),
  population: collection(level.population.map((record) => ({ type: 'Feature', properties: { id: record.id, residents: record.residents }, geometry: { type: 'Point', coordinates: coordinate(record.coordinate) } }))),
  workplaces: collection(level.workplaces.map((workplace) => ({ type: 'Feature', properties: { id: workplace.id, jobs: workplace.jobs, displayName: workplace.displayName ?? '', buildingId: workplace.buildingId ?? '' }, geometry: { type: 'Point', coordinates: coordinate(workplace.coordinate) } }))),
  pois: collection([...level.pointsOfInterest.map((poi) => ({ type: 'Feature' as const, properties: { id: poi.id, category: poi.category, displayName: poi.displayName ?? '' }, geometry: { type: 'Point' as const, coordinates: coordinate(poi.coordinate) } })), ...level.landmarks.map((landmark) => ({ type: 'Feature' as const, properties: { id: landmark.id, category: 'landmark', displayName: landmark.name }, geometry: { type: 'Point' as const, coordinates: coordinate(landmark.coordinate) } }))]),
  bounds: collection([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[coordinate(level.bounds.southWest), [level.bounds.northEast.longitude, level.bounds.southWest.latitude], coordinate(level.bounds.northEast), [level.bounds.southWest.longitude, level.bounds.northEast.latitude], coordinate(level.bounds.southWest)]] } }]),
}; }
export function createTransitSource(overlay: TransitOverlay): Collection { return collection(overlay.lines.map((line) => ({ type: 'Feature', properties: { id: line.id, color: line.color ?? '#ef6c45' }, geometry: { type: 'LineString', coordinates: line.geometry.map(coordinate) } }))); }
export function createTransitStopsSource(overlay: TransitOverlay): Collection { return collection(overlay.stops.map((stop) => ({ type: 'Feature', properties: { id: stop.id, name: stop.name ?? '' }, geometry: { type: 'Point', coordinates: coordinate(stop.coordinate) } }))); }
export function createTransitVehiclesSource(overlay: TransitOverlay): Collection { return collection((overlay.vehicles ?? []).map((vehicle) => ({ type: 'Feature', properties: { id: vehicle.id, color: vehicle.color ?? '#17211e' }, geometry: { type: 'Point', coordinates: coordinate(vehicle.coordinate) } }))); }
