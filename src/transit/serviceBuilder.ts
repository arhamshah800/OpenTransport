import { distanceMeters, nearestPointOnPolyline, segmentsIntersect } from '../map/geometry';
import { routeAlongRoads, snapToRoad } from '../map/roadGraph';
import type { World, Coordinate } from '../world';
import type { ConstructionState, StationFootprint } from '../construction';
import { defaultEngineeringConfiguration } from '../construction';
import type { TransitInfrastructureValidator, TransitLine, TransitMode, TransitSegment, TransitStop } from './types';
import type { TransitNetwork } from './TransitNetwork';
import { nextLineColor } from './lineStyle';

const GUIDEWAY_STOP_TOLERANCE_METERS = 55;
const STATION_LINK_TOLERANCE_METERS = 90;
const JUNCTION_TOLERANCE_METERS = 45;

export interface LineBuildOptions {
  readonly geometries?: readonly (readonly Coordinate[])[];
  readonly reservedRightOfWay?: boolean;
  readonly color?: string;
  readonly engineeringBySegment?: readonly ({ readonly verticalProfileReference?: string; readonly reservedRightOfWay?: boolean } | undefined)[];
  readonly plannedHeadwayMinutes?: number;
}

export function makeServiceLine(id: string, name: string, mode: TransitMode, stopIds: readonly string[], network: TransitNetwork, options: LineBuildOptions = {}): TransitLine {
  const segments = stopIds.slice(0, -1).map((startStopId, index) => {
    const endStopId = stopIds[index + 1];
    const start = network.getStop(startStopId); const end = network.getStop(endStopId);
    if (!start || !end) throw new Error('Cannot create alignment for unknown stop');
    const geometry = options.geometries?.[index] ?? [start.coordinate, end.coordinate];
    if (geometry.length < 2) throw new Error('Segment geometry requires at least two coordinates');
    const engineering = options.engineeringBySegment?.[index] ?? { reservedRightOfWay: options.reservedRightOfWay ?? false };
    return { id: `${id}-segment-${index + 1}`, startStopId, endStopId, geometry, engineering };
  });
  return {
    id, name, mode, stopIds, segments, direction: 'bidirectional', active: true,
    color: options.color ?? nextLineColor(network, mode),
    serviceSettings: { plannedHeadwayMinutes: options.plannedHeadwayMinutes ?? 12 },
  };
}

export function busStopValidator(world: World, maxDistanceMeters = defaultEngineeringConfiguration.busRoadSnapToleranceMeters): TransitInfrastructureValidator {
  return {
    validateProposal(proposal) {
      if (proposal.kind !== 'stop' || !proposal.modes.includes('BUS')) return { valid: true, reasons: [] };
      return snapToRoad(world, proposal.coordinate, maxDistanceMeters)
        ? { valid: true, reasons: [] }
        : { valid: false, reasons: ['Bus stop must be placed near a road.'] };
    },
  };
}

export function routeBusSegments(world: World, stops: readonly TransitStop[], maxSnapMeters = defaultEngineeringConfiguration.busRoadSnapToleranceMeters): { readonly geometries: Coordinate[][]; readonly error?: string } {
  const geometries: Coordinate[][] = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const route = routeAlongRoads(world, stops[index].coordinate, stops[index + 1].coordinate, maxSnapMeters);
    if (!route) return { geometries, error: 'Bus route must follow existing roads between stops.' };
    geometries.push([...route.geometry]);
  }
  return { geometries };
}

export function snapBusStopCoordinate(world: World, coordinate: Coordinate, maxSnapMeters = defaultEngineeringConfiguration.busRoadSnapToleranceMeters): Coordinate | null {
  return snapToRoad(world, coordinate, maxSnapMeters)?.coordinate ?? null;
}

function guidewaySegments(state: ConstructionState, mode: TransitMode): readonly { readonly id: string; readonly geometry: readonly Coordinate[] }[] {
  return state.engineeringSegments.filter((segment) => segment.mode === mode).map((segment) => ({ id: segment.id, geometry: segment.geometry }));
}

export function nearestGuidewayPoint(state: ConstructionState, mode: TransitMode, coordinate: Coordinate, maxDistanceMeters = GUIDEWAY_STOP_TOLERANCE_METERS): { readonly coordinate: Coordinate; readonly segmentId: string; readonly distanceMeters: number } | null {
  let best: { coordinate: Coordinate; segmentId: string; distanceMeters: number } | null = null;
  for (const segment of guidewaySegments(state, mode)) {
    if (segment.geometry.length < 2) continue;
    const nearest = nearestPointOnPolyline(coordinate, segment.geometry);
    if (nearest.distanceMeters > maxDistanceMeters) continue;
    if (!best || nearest.distanceMeters < best.distanceMeters) best = { coordinate: nearest.coordinate, segmentId: segment.id, distanceMeters: nearest.distanceMeters };
  }
  return best;
}

interface GuidewayGraphEdge { readonly to: string; readonly weight: number; readonly geometry: readonly Coordinate[]; readonly segmentId?: string }

function buildGuidewayGraph(state: ConstructionState, mode: TransitMode): { readonly adjacency: Map<string, GuidewayGraphEdge[]>; readonly coordinates: Map<string, Coordinate> } {
  const adjacency = new Map<string, GuidewayGraphEdge[]>();
  const coordinates = new Map<string, Coordinate>();
  const keyFor = (coordinate: Coordinate): string => `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;
  const ensure = (coordinate: Coordinate): string => {
    const id = keyFor(coordinate);
    if (!coordinates.has(id)) coordinates.set(id, coordinate);
    if (!adjacency.has(id)) adjacency.set(id, []);
    return id;
  };
  const link = (a: Coordinate, b: Coordinate, segmentId?: string): void => {
    if (keyFor(a) === keyFor(b)) return;
    const from = ensure(a); const to = ensure(b); const weight = distanceMeters(a, b);
    adjacency.get(from)!.push({ to, weight, geometry: [a, b], segmentId });
    adjacency.get(to)!.push({ to: from, weight, geometry: [b, a], segmentId });
  };

  for (const segment of guidewaySegments(state, mode)) {
    for (let index = 0; index < segment.geometry.length - 1; index += 1) link(segment.geometry[index], segment.geometry[index + 1], segment.id);
  }

  // Connect nearby endpoints so separately built tunnels/guideways can form a network.
  const nodes = [...coordinates.values()];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (distanceMeters(nodes[i], nodes[j]) <= JUNCTION_TOLERANCE_METERS) link(nodes[i], nodes[j]);
    }
  }
  return { adjacency, coordinates };
}

function pathOnGuideway(state: ConstructionState, mode: TransitMode, from: Coordinate, to: Coordinate): { readonly geometry: Coordinate[]; readonly segmentIds: string[] } | null {
  const { adjacency } = buildGuidewayGraph(state, mode);
  if (adjacency.size === 0) return null;
  const keyFor = (coordinate: Coordinate): string => `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;
  const attach = (point: Coordinate): string => {
    const id = keyFor(point);
    if (!adjacency.has(id)) adjacency.set(id, []);
    let best: { snap: Coordinate; segmentId: string; start: Coordinate; end: Coordinate } | null = null;
    let bestDistance = Infinity;
    for (const segment of guidewaySegments(state, mode)) {
      if (segment.geometry.length < 2) continue;
      const nearest = nearestPointOnPolyline(point, segment.geometry);
      if (nearest.distanceMeters > GUIDEWAY_STOP_TOLERANCE_METERS * 2 || nearest.distanceMeters >= bestDistance) continue;
      bestDistance = nearest.distanceMeters;
      best = {
        snap: nearest.coordinate,
        segmentId: segment.id,
        start: segment.geometry[nearest.segmentIndex],
        end: segment.geometry[nearest.segmentIndex + 1],
      };
    }
    if (!best) return id;
    const snapId = keyFor(best.snap);
    if (!adjacency.has(snapId)) adjacency.set(snapId, []);
    const links: Array<readonly [string, Coordinate, string, Coordinate]> = [
      [id, point, snapId, best.snap],
      [snapId, best.snap, keyFor(best.start), best.start],
      [snapId, best.snap, keyFor(best.end), best.end],
    ];
    for (const [fromId, fromCoord, toId, toCoord] of links) {
      if (!adjacency.has(toId)) adjacency.set(toId, []);
      const weight = Math.max(distanceMeters(fromCoord, toCoord), 0.01);
      adjacency.get(fromId)!.push({ to: toId, weight, geometry: [fromCoord, toCoord], segmentId: best.segmentId });
      adjacency.get(toId)!.push({ to: fromId, weight, geometry: [toCoord, fromCoord], segmentId: best.segmentId });
    }
    return id;
  };
  const startId = attach(from); const endId = attach(to);
  const distances = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { readonly from: string; readonly edge: GuidewayGraphEdge }>();
  const pending = new Set<string>(adjacency.keys());
  while (pending.size > 0) {
    let current: string | undefined; let best = Infinity;
    for (const id of pending) {
      const distance = distances.get(id) ?? Infinity;
      if (distance < best) { best = distance; current = id; }
    }
    if (!current || best === Infinity) break;
    pending.delete(current);
    if (current === endId) break;
    for (const edge of adjacency.get(current) ?? []) {
      const next = best + edge.weight;
      if (next < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, next);
        previous.set(edge.to, { from: current, edge });
      }
    }
  }
  if (!distances.has(endId)) return null;
  const chunks: GuidewayGraphEdge[] = [];
  let cursor = endId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) return null;
    chunks.push(step.edge);
    cursor = step.from;
  }
  chunks.reverse();
  const geometry: Coordinate[] = [from];
  const segmentIds: string[] = [];
  for (const edge of chunks) {
    if (edge.segmentId) segmentIds.push(edge.segmentId);
    for (const point of edge.geometry) {
      const last = geometry[geometry.length - 1];
      if (last.latitude === point.latitude && last.longitude === point.longitude) continue;
      geometry.push(point);
    }
  }
  if (geometry.length < 2) geometry.push(to);
  return { geometry, segmentIds: [...new Set(segmentIds)] };
}

export function stationsConnectedBySubway(state: ConstructionState, from: StationFootprint, to: StationFootprint): boolean {
  return Boolean(pathOnGuideway(state, 'SUBWAY', from.center, to.center));
}

export function routeGuidewaySegments(state: ConstructionState, mode: TransitMode, stops: readonly TransitStop[]): { readonly geometries: Coordinate[][]; readonly engineeringBySegment: LineBuildOptions['engineeringBySegment']; readonly error?: string } {
  if (guidewaySegments(state, mode).length === 0) {
    return { geometries: [], engineeringBySegment: [], error: mode === 'TRAM' ? 'Tram alignment has not been constructed.' : 'No constructed subway tunnel connects these stations.' };
  }
  const geometries: Coordinate[][] = [];
  const engineeringBySegment: Array<{ readonly verticalProfileReference?: string; readonly reservedRightOfWay?: boolean } | undefined> = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const path = pathOnGuideway(state, mode, stops[index].coordinate, stops[index + 1].coordinate);
    if (!path) {
      return {
        geometries,
        engineeringBySegment,
        error: mode === 'TRAM' ? 'Tram alignment has not been constructed.' : 'No constructed subway tunnel connects these stations.',
      };
    }
    geometries.push(path.geometry);
    engineeringBySegment.push({ reservedRightOfWay: true, verticalProfileReference: path.segmentIds[0] });
  }
  return { geometries, engineeringBySegment };
}

export function constructionServiceValidator(state: ConstructionState): TransitInfrastructureValidator {
  return {
    validateProposal(proposal) {
      if (proposal.kind === 'stop') {
        if (proposal.modes.includes('TRAM')) {
          return nearestGuidewayPoint(state, 'TRAM', proposal.coordinate)
            ? { valid: true, reasons: [] }
            : { valid: false, reasons: ['Tram alignment has not been constructed.'] };
        }
        if (proposal.modes.includes('SUBWAY')) {
          const nearStation = state.stations.some((station) => distanceMeters(station.center, proposal.coordinate) <= STATION_LINK_TOLERANCE_METERS);
          return nearStation ? { valid: true, reasons: [] } : { valid: false, reasons: ['Subway stops must be placed at constructed stations.'] };
        }
        return { valid: true, reasons: [] };
      }
      if (proposal.mode === 'TRAM') {
        return guidewaySegments(state, 'TRAM').length > 0
          ? { valid: true, reasons: [] }
          : { valid: false, reasons: ['Tram alignment has not been constructed.'] };
      }
      if (proposal.mode === 'SUBWAY') {
        if (proposal.stopIds.length < 2) return { valid: false, reasons: ['Line requires at least two stops.'] };
        // Connectivity is validated when geometries are built; keep a coarse station presence check here.
        return state.stations.length >= 2
          ? { valid: true, reasons: [] }
          : { valid: false, reasons: ['No constructed subway tunnel connects these stations.'] };
      }
      return { valid: true, reasons: [] };
    },
  };
}

export function findConstructedStation(state: ConstructionState, coordinate: Coordinate): StationFootprint | null {
  let best: StationFootprint | null = null; let bestDistance = Infinity;
  for (const station of state.stations) {
    const distance = distanceMeters(station.center, coordinate);
    if (distance <= STATION_LINK_TOLERANCE_METERS && distance < bestDistance) { best = station; bestDistance = distance; }
  }
  return best;
}

export function canCreateTransfer(a: TransitStop, b: TransitStop, maxDistanceMeters = 150): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (a.id === b.id) return { ok: false, reason: 'Choose two different stops.' };
  if (a.parentComplexId && a.parentComplexId === b.parentComplexId) return { ok: false, reason: 'These stops are already linked.' };
  const distance = distanceMeters(a.coordinate, b.coordinate);
  if (distance > maxDistanceMeters) return { ok: false, reason: 'Stops are too far apart to form a transfer.' };
  return { ok: true };
}

/** Detect whether a straight bus hop would illegally cross water without a bridge road route. */
export function straightRouteCrossesWaterWithoutRoad(world: World, start: Coordinate, end: Coordinate): boolean {
  const waterHit = world.definition.waterways.some((waterway) => waterway.geometry.slice(0, -1).some((waterStart, index) => segmentsIntersect(start, end, waterStart, waterway.geometry[index + 1])));
  if (!waterHit) return false;
  return routeAlongRoads(world, start, end, defaultEngineeringConfiguration.busRoadSnapToleranceMeters) === null;
}

export type { TransitSegment };
