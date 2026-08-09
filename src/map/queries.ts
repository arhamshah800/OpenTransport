import type { World } from '../world';
import type { Coordinate } from '../world';
import { nearestPointOnPolyline, segmentsIntersect } from './geometry';

export function findNearestRoad(world: World, coordinate: Coordinate) { return [...world.roadsById.values()].map((road) => ({ road, nearest: nearestPointOnPolyline(coordinate, road.geometry) })).reduce((best, candidate) => !best || candidate.nearest.distanceMeters < best.nearest.distanceMeters ? candidate : best, undefined as { readonly road: (typeof world.definition.roads)[number]; readonly nearest: ReturnType<typeof nearestPointOnPolyline> } | undefined); }
export function doesSegmentCrossWater(world: World, start: Coordinate, end: Coordinate): boolean { return world.definition.waterways.some((waterway) => waterway.geometry.slice(0, -1).some((waterStart, index) => segmentsIntersect(start, end, waterStart, waterway.geometry[index + 1]))); }
export function buildingPopulation(world: World, buildingId: string): number { return world.definition.population.filter((record) => record.buildingId === buildingId).reduce((total, record) => total + record.residents, 0); }
export function buildingEmployment(world: World, buildingId: string): number { return world.definition.workplaces.filter((record) => record.buildingId === buildingId).reduce((total, record) => total + record.jobs, 0); }
