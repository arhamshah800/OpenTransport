import type { Coordinate, World } from '../world';
import { distanceMeters, nearestPointOnPolyline, segmentsIntersect } from './geometry';
import { findNearestRoad } from './queries';

export interface RoadSnap {
  readonly roadId: string;
  readonly coordinate: Coordinate;
  readonly segmentIndex: number;
  readonly fraction: number;
  readonly distanceMeters: number;
}

export interface RoadRoute {
  readonly geometry: readonly Coordinate[];
  readonly lengthMeters: number;
}

interface GraphEdge {
  readonly to: string;
  readonly weight: number;
  readonly geometry: readonly Coordinate[];
}

export interface RoadGraph {
  readonly adjacency: ReadonlyMap<string, readonly GraphEdge[]>;
  readonly coordinates: ReadonlyMap<string, Coordinate>;
}

const keyFor = (coordinate: Coordinate): string => `${coordinate.latitude.toFixed(6)},${coordinate.longitude.toFixed(6)}`;

/** Snap a map click to the nearest road within tolerance. */
export function snapToRoad(world: World, coordinate: Coordinate, maxDistanceMeters: number): RoadSnap | null {
  const nearest = findNearestRoad(world, coordinate);
  if (!nearest || nearest.nearest.distanceMeters > maxDistanceMeters) return null;
  return {
    roadId: nearest.road.id,
    coordinate: nearest.nearest.coordinate,
    segmentIndex: nearest.nearest.segmentIndex,
    fraction: nearest.nearest.fraction,
    distanceMeters: nearest.nearest.distanceMeters,
  };
}

/**
 * Build a reusable road graph from level road polylines.
 * Junction nodes are inserted where road segments intersect so pathfinding works on
 * grids that only store polyline endpoints.
 */
export function buildRoadGraph(world: World): RoadGraph {
  const coordinates = new Map<string, Coordinate>();
  const adjacency = new Map<string, GraphEdge[]>();
  const ensure = (coordinate: Coordinate): string => {
    const id = keyFor(coordinate);
    if (!coordinates.has(id)) coordinates.set(id, coordinate);
    if (!adjacency.has(id)) adjacency.set(id, []);
    return id;
  };
  const link = (a: Coordinate, b: Coordinate): void => {
    if (keyFor(a) === keyFor(b)) return;
    const from = ensure(a); const to = ensure(b); const weight = distanceMeters(a, b);
    adjacency.get(from)!.push({ to, weight, geometry: [a, b] });
    adjacency.get(to)!.push({ to: from, weight, geometry: [b, a] });
  };

  const roads = world.definition.roads;
  for (let index = 0; index < roads.length; index += 1) {
    const road = roads[index];
    const splits: Coordinate[] = [...road.geometry];
    for (let otherIndex = 0; otherIndex < roads.length; otherIndex += 1) {
      if (otherIndex === index) continue;
      const other = roads[otherIndex];
      for (let segment = 0; segment < road.geometry.length - 1; segment += 1) {
        const a = road.geometry[segment]; const b = road.geometry[segment + 1];
        for (let otherSegment = 0; otherSegment < other.geometry.length - 1; otherSegment += 1) {
          const c = other.geometry[otherSegment]; const d = other.geometry[otherSegment + 1];
          if (!segmentsIntersect(a, b, c, d)) continue;
          splits.push(nearestPointOnPolyline(c, [a, b]).coordinate);
        }
      }
    }
    const origin = road.geometry[0];
    const ordered = [...splits]
      .sort((left, right) => distanceMeters(origin, left) - distanceMeters(origin, right))
      .filter((point, pointIndex, list) => pointIndex === 0 || keyFor(point) !== keyFor(list[pointIndex - 1]));
    for (let pointIndex = 0; pointIndex < ordered.length - 1; pointIndex += 1) link(ordered[pointIndex], ordered[pointIndex + 1]);
  }

  return { adjacency, coordinates };
}

function dijkstra(adjacency: ReadonlyMap<string, readonly GraphEdge[]>, startId: string, endId: string): Coordinate[] | null {
  const distances = new Map<string, number>([[startId, 0]]);
  const previous = new Map<string, { readonly from: string; readonly edge: GraphEdge }>();
  const pending = new Set<string>(adjacency.keys());
  if (!pending.has(startId)) pending.add(startId);
  if (!pending.has(endId)) pending.add(endId);
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
  const chunks: Coordinate[][] = [];
  let cursor = endId;
  while (cursor !== startId) {
    const step = previous.get(cursor);
    if (!step) return null;
    chunks.push([...step.edge.geometry]);
    cursor = step.from;
  }
  chunks.reverse();
  const geometry: Coordinate[] = [];
  for (const chunk of chunks) {
    for (const point of chunk) {
      const last = geometry[geometry.length - 1];
      if (last && keyFor(last) === keyFor(point)) continue;
      geometry.push(point);
    }
  }
  return geometry;
}

/** Shortest path along the road network between two points (snapped first). */
export function routeAlongRoads(world: World, from: Coordinate, to: Coordinate, maxSnapMeters: number, graph = buildRoadGraph(world)): RoadRoute | null {
  const startSnap = snapToRoad(world, from, maxSnapMeters);
  const endSnap = snapToRoad(world, to, maxSnapMeters);
  if (!startSnap || !endSnap) return null;
  if (distanceMeters(startSnap.coordinate, endSnap.coordinate) < 1) {
    return { geometry: [startSnap.coordinate, endSnap.coordinate], lengthMeters: distanceMeters(startSnap.coordinate, endSnap.coordinate) };
  }

  const startRoad = world.roadsById.get(startSnap.roadId);
  const endRoad = world.roadsById.get(endSnap.roadId);
  if (!startRoad || !endRoad) return null;

  const adjacency = new Map<string, GraphEdge[]>([...graph.adjacency.entries()].map(([id, edges]) => [id, [...edges]]));
  const attach = (snap: RoadSnap, roadGeometry: readonly Coordinate[]): string => {
    const id = keyFor(snap.coordinate);
    if (!adjacency.has(id)) adjacency.set(id, []);
    const start = roadGeometry[snap.segmentIndex];
    const end = roadGeometry[snap.segmentIndex + 1];
    for (const anchor of [start, end]) {
      const anchorId = keyFor(anchor);
      if (!adjacency.has(anchorId)) continue;
      const weight = Math.max(distanceMeters(snap.coordinate, anchor), 0.01);
      adjacency.get(id)!.push({ to: anchorId, weight, geometry: [snap.coordinate, anchor] });
      adjacency.get(anchorId)!.push({ to: id, weight, geometry: [anchor, snap.coordinate] });
    }
    return id;
  };

  const startId = attach(startSnap, startRoad.geometry);
  const endId = attach(endSnap, endRoad.geometry);
  const geometry = dijkstra(adjacency, startId, endId);
  if (!geometry || geometry.length < 2) return null;
  const lengthMeters = geometry.slice(1).reduce((total, point, index) => total + distanceMeters(geometry[index], point), 0);
  return { geometry, lengthMeters };
}
