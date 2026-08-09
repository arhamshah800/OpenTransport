import { describe, expect, it } from 'vitest';
import { testCity } from '../levels/test-city';
import { World } from '../world';
import { buildRoadGraph, routeAlongRoads, snapToRoad } from './roadGraph';
import { findNearestRoad } from './queries';

const world = new World(testCity);
const point = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('road graph pathfinding', () => {
  it('snaps coordinates to nearby roads and rejects far-away points', () => {
    const onRoad = snapToRoad(world, point(41.875, -87.64), 45);
    expect(onRoad).not.toBeNull();
    expect(onRoad!.distanceMeters).toBeLessThan(5);
    expect(snapToRoad(world, point(41.9, -87.7), 45)).toBeNull();
  });

  it('routes bus paths along the road network instead of through blocks', () => {
    const graph = buildRoadGraph(world);
    expect(graph.adjacency.size).toBeGreaterThan(10);
    const start = point(41.870, -87.64);
    const end = point(41.878, -87.628);
    const route = routeAlongRoads(world, start, end, 45, graph);
    expect(route).not.toBeNull();
    expect(route!.geometry.length).toBeGreaterThan(2);
    // A straight line would be much shorter than a street path around the grid.
    const straight = Math.hypot(
      (end.latitude - start.latitude) * 111_111,
      (end.longitude - start.longitude) * 111_111 * Math.cos(start.latitude * Math.PI / 180),
    );
    expect(route!.lengthMeters).toBeGreaterThan(straight * 0.9);
    // Every vertex should remain near some road.
    for (const coordinate of route!.geometry) {
      const nearest = findNearestRoad(world, coordinate);
      expect(nearest?.nearest.distanceMeters ?? 999).toBeLessThan(20);
    }
  });
});
