import { describe, expect, it } from 'vitest';
import { levelRegistry } from '../levels/manifest';
import { testCity } from '../levels/test-city';
import { distanceMeters, interpolatePolyline, nearestPointOnSegment, pointInPolygon } from './geometry';
import { doesSegmentCrossWater, findNearestRoad } from './queries';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });
describe('geographic utilities', () => {
  it('measures WGS84 coordinate distance in meters', () => { expect(distanceMeters(point(0, 0), point(0, 1))).toBeCloseTo(111_195, -2); });
  it('interpolates along a polyline by meter distance', () => { const line = [point(0, 0), point(0, .01), point(.01, .01)]; const coordinate = interpolatePolyline(line, distanceMeters(line[0], line[1]) + distanceMeters(line[1], line[2]) / 2); expect(coordinate.latitude).toBeCloseTo(.005, 4); expect(coordinate.longitude).toBeCloseTo(.01, 4); });
  it('finds the nearest point on a road segment', () => { const nearest = nearestPointOnSegment(point(1, 5), point(0, 0), point(0, 10)); expect(nearest.coordinate.longitude).toBeCloseTo(5, 5); expect(nearest.coordinate.latitude).toBeCloseTo(0, 5); });
  it('checks a point against a polygon', () => { const square = [point(0, 0), point(0, 10), point(10, 10), point(10, 0)]; expect(pointInPolygon(point(5, 5), square)).toBe(true); expect(pointInPolygon(point(15, 5), square)).toBe(false); });
  it('finds roads and detects water crossings through world queries', async () => { const world = await levelRegistry.loadLevel('test-city'); expect(findNearestRoad(world, testCity.roads[0].geometry[0])?.road.id).toBe('road-ns-1'); expect(doesSegmentCrossWater(world, point(41.869, -87.632), point(41.869, -87.626))).toBe(true); });
});
