import { describe, expect, it } from 'vitest';
import { Economy } from '../economy';
import { ConstructionEngine } from '../construction';
import { testCity } from '../levels/test-city';
import { SimulationEngine } from '../time';
import {
  busStopValidator, constructionServiceValidator, createLine, createStop, makeServiceLine,
  routeBusSegments, routeGuidewaySegments, snapBusStopCoordinate, TransitNetwork,
} from '../transit';
import { World } from '../world';
import { networkToOverlay } from '../transit/BusLinePanel';
import { lineDisplayColor } from '../transit/lineStyle';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('Player operations gameplay path', () => {
  it('runs a configured bus line with moving map vehicles and operating costs', () => {
    const world = new World(testCity);
    const economy = new Economy(testCity.economy.startingBudget);
    const a = snapBusStopCoordinate(world, point(41.870, -87.64))!;
    const b = snapBusStopCoordinate(world, point(41.876, -87.636))!;
    let network = new TransitNetwork();
    const stops = [
      { id: 'bus-a', name: 'Harbor', coordinate: a, kind: 'stop' as const, supportedModes: ['BUS' as const] },
      { id: 'bus-b', name: 'Market', coordinate: b, kind: 'stop' as const, supportedModes: ['BUS' as const] },
    ];
    for (const stop of stops) network = createStop(network, stop, busStopValidator(world));
    const routed = routeBusSegments(world, stops);
    expect(routed.error).toBeUndefined();
    const line = makeServiceLine('harbor-flyer', 'Harbor Flyer', 'BUS', stops.map((stop) => stop.id), network, {
      geometries: routed.geometries,
      plannedHeadwayMinutes: 8,
    });
    network = createLine(network, line);
    const engine = new SimulationEngine(world, economy, network, { seed: 1 });
    engine.configureLineService({
      lineId: line.id,
      active: true,
      vehicleTypeId: 'articulated-bus',
      assignedVehicleCount: 3,
      frequency: { daytimeHeadwayMinutes: 8, nighttimeHeadwayMinutes: 20, daytimeStartHour: 0, nighttimeStartHour: 22 },
    });
    engine.advanceBy(30);
    const first = engine.snapshot().operations!.vehicles[0];
    expect(first).toBeDefined();
    engine.advanceBy(45);
    const second = engine.snapshot().operations!.vehicles.find((vehicle) => vehicle.id === first.id)!;
    const moved = second.coordinate.latitude !== first.coordinate.latitude
      || second.coordinate.longitude !== first.coordinate.longitude
      || second.state !== first.state
      || second.segmentProgressMeters !== first.segmentProgressMeters
      || second.stopIndex !== first.stopIndex;
    expect(moved).toBe(true);
    const overlayVehicles = engine.snapshot().operations!.vehicles.map((vehicle) => ({
      id: vehicle.id,
      coordinate: vehicle.coordinate,
      color: lineDisplayColor(network.getLine(vehicle.lineId)!),
      modeId: 'BUS' as const,
      lineId: vehicle.lineId,
      vehicleTypeId: vehicle.vehicleTypeId,
    }));
    expect(networkToOverlay(network, line.id).lines.length).toBeGreaterThan(0);
    expect(overlayVehicles[0]?.color).toMatch(/^#/);
    expect(engine.snapshot().finances.allTime.operatingCostCents).toBeGreaterThan(0);
    engine.configureLineService({ ...engine.getLineService(line.id)!, active: false });
    const stoppedCount = engine.snapshot().operations!.vehicles.length;
    engine.advanceBy(20 * 60);
    expect(engine.snapshot().operations!.vehicles.length).toBe(stoppedCount);
  });

  it('runs a tram line with visible moving vehicles after construction', () => {
    const world = new World(testCity);
    const economy = new Economy(testCity.economy.startingBudget);
    const construction = new ConstructionEngine(world);
    const evaluation = construction.evaluate({ kind: 'alignment', id: 'tram-1', mode: 'TRAM', geometry: [point(41.87, -87.64), point(41.876, -87.64)] });
    const state = construction.commit(evaluation.plan!);
    const stops = [
      { id: 't1', name: 'South', coordinate: point(41.8705, -87.64), kind: 'stop' as const, supportedModes: ['TRAM' as const] },
      { id: 't2', name: 'North', coordinate: point(41.8755, -87.64), kind: 'stop' as const, supportedModes: ['TRAM' as const] },
    ];
    const routed = routeGuidewaySegments(state, 'TRAM', stops);
    expect(routed.error).toBeUndefined();
    let network = new TransitNetwork();
    for (const stop of stops) network = createStop(network, stop, constructionServiceValidator(state));
    const line = makeServiceLine('tram-line', 'Market Tram', 'TRAM', ['t1', 't2'], network, {
      geometries: routed.geometries,
      reservedRightOfWay: true,
      engineeringBySegment: routed.engineeringBySegment,
    });
    network = createLine(network, line);
    const engine = new SimulationEngine(world, economy, network, { seed: 2 });
    engine.configureLineService({
      lineId: line.id,
      active: true,
      vehicleTypeId: 'standard-tram',
      assignedVehicleCount: 2,
      frequency: { daytimeHeadwayMinutes: 10, nighttimeHeadwayMinutes: 20, daytimeStartHour: 0, nighttimeStartHour: 22 },
    });
    engine.advanceBy(30);
    expect(engine.snapshot().operations!.vehicles.length).toBeGreaterThan(0);
    const vehicle = engine.snapshot().operations!.vehicles[0];
    engine.advanceBy(45);
    const later = engine.snapshot().operations!.vehicles.find((item) => item.id === vehicle.id)!;
    expect(later.segmentProgressMeters !== vehicle.segmentProgressMeters || later.state !== vehicle.state || later.coordinate.latitude !== vehicle.coordinate.latitude || later.stopIndex !== vehicle.stopIndex).toBe(true);
  });
});
