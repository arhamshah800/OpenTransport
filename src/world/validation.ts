import { LevelValidationError } from './errors';
import type { Bounds, Coordinate, LevelDefinition } from './types';

const isCoordinate = (value: Coordinate): boolean => Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && value.latitude >= -90 && value.latitude <= 90 && value.longitude >= -180 && value.longitude <= 180;
const insideBounds = (coordinate: Coordinate, bounds: Bounds): boolean => coordinate.latitude >= bounds.southWest.latitude && coordinate.latitude <= bounds.northEast.latitude && coordinate.longitude >= bounds.southWest.longitude && coordinate.longitude <= bounds.northEast.longitude;

function assertCoordinate(coordinate: Coordinate, label: string, bounds: Bounds): void {
  if (!isCoordinate(coordinate)) throw new LevelValidationError(`${label} has invalid coordinates`);
  if (!insideBounds(coordinate, bounds)) throw new LevelValidationError(`${label} references coordinate outside level bounds`);
}

function assertUnique(items: readonly { readonly id: string }[], type: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new LevelValidationError(`${type} has an empty ID`);
    if (ids.has(item.id)) throw new LevelValidationError(`duplicate ${type} ID "${item.id}"`);
    ids.add(item.id);
  }
}

export function validateLevel(level: LevelDefinition): void {
  const { bounds } = level;
  if (!isCoordinate(bounds.southWest) || !isCoordinate(bounds.northEast) || bounds.southWest.latitude >= bounds.northEast.latitude || bounds.southWest.longitude >= bounds.northEast.longitude) throw new LevelValidationError('metadata has invalid bounds');
  if (!level.metadata.id.trim() || !level.metadata.name.trim() || !Number.isInteger(level.metadata.version) || level.metadata.version < 1) throw new LevelValidationError('metadata is invalid');
  if (!Number.isFinite(level.economy.startingBudget) || level.economy.startingBudget < 0) throw new LevelValidationError('starting budget must be a nonnegative monetary value');
  assertUnique(level.roads, 'road'); assertUnique(level.buildings, 'building'); assertUnique(level.population, 'population record'); assertUnique(level.workplaces, 'workplace'); assertUnique(level.pointsOfInterest, 'POI'); assertUnique(level.waterways, 'waterway'); assertUnique(level.landmarks, 'landmark');
  const buildingIds = new Set(level.buildings.map(({ id }) => id));
  for (const road of level.roads) { if (road.geometry.length < 2) throw new LevelValidationError(`road "${road.id}" must have at least two points`); if (!['local', 'arterial', 'highway'].includes(road.classification)) throw new LevelValidationError(`road "${road.id}" has an unknown class`); if (road.classification === 'highway' && road.busStopEligible === true) throw new LevelValidationError(`highway "${road.id}" cannot be bus-stop eligible`); road.geometry.forEach((point) => assertCoordinate(point, `road "${road.id}"`, bounds)); if (road.speedKph !== undefined && road.speedKph <= 0) throw new LevelValidationError(`road "${road.id}" has invalid speed`); }
  for (const building of level.buildings) { if (building.footprint.length < 3) throw new LevelValidationError(`building "${building.id}" must have a usable polygon`); if (!Number.isFinite(building.acquisitionValue) || building.acquisitionValue < 0) throw new LevelValidationError(`building "${building.id}" has invalid monetary value`); building.footprint.forEach((point) => assertCoordinate(point, `building "${building.id}"`, bounds)); }
  for (const record of level.population) { assertCoordinate(record.coordinate, `population record "${record.id}"`, bounds); if (!Number.isFinite(record.residents) || record.residents < 0) throw new LevelValidationError(`population record "${record.id}" has invalid residents`); if (record.buildingId && !buildingIds.has(record.buildingId)) throw new LevelValidationError(`population record "${record.id}" references missing building "${record.buildingId}"`); }
  for (const workplace of level.workplaces) { assertCoordinate(workplace.coordinate, `workplace "${workplace.id}"`, bounds); if (!Number.isFinite(workplace.jobs) || workplace.jobs < 0) throw new LevelValidationError(`workplace "${workplace.id}" has invalid jobs`); if (workplace.buildingId && !buildingIds.has(workplace.buildingId)) throw new LevelValidationError(`workplace "${workplace.id}" references missing building "${workplace.buildingId}"`); }
  for (const poi of level.pointsOfInterest) { assertCoordinate(poi.coordinate, `POI "${poi.id}"`, bounds); if (poi.buildingId && !buildingIds.has(poi.buildingId)) throw new LevelValidationError(`POI "${poi.id}" references missing building "${poi.buildingId}"`); }
  for (const waterway of level.waterways) { if (waterway.geometry.length < 2) throw new LevelValidationError(`waterway "${waterway.id}" must have at least two points`); waterway.geometry.forEach((point) => assertCoordinate(point, `waterway "${waterway.id}"`, bounds)); }
  for (const landmark of level.landmarks) { assertCoordinate(landmark.coordinate, `landmark "${landmark.id}"`, bounds); if (landmark.buildingId && !buildingIds.has(landmark.buildingId)) throw new LevelValidationError(`landmark "${landmark.id}" references missing building "${landmark.buildingId}"`); }
}
