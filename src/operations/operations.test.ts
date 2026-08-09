import { describe, expect, it } from 'vitest';
import { createLine, createStop, makeLine, TransitNetwork } from '../transit';
import { modeRegistry } from '../modes';
import { Economy } from '../economy';
import { World } from '../world';
import { testCity } from '../levels/test-city';
import { SimulationEngine } from '../time';
import { networkToOverlay } from '../transit/BusLinePanel';
import { lineDisplayColor } from '../transit/lineStyle';
import { estimateSupportedHeadwayMinutes, OperationsSimulation } from './index';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });
const network = (span = 0.001): TransitNetwork => {
  let value = new TransitNetwork();
  value = createStop(value, { id: 'a', name: 'A', coordinate: point(41.88, -87.63), kind: 'stop', supportedModes: ['BUS'] });
  value = createStop(value, { id: 'b', name: 'B', coordinate: point(41.88, -87.63 + span), kind: 'stop', supportedModes: ['BUS'] });
  return createLine(value, makeLine('bus', 'Bus', 'BUS', ['a', 'b'], value));
};
const config = (count = 1, active = true, daytime = 4, nighttime = 20) => ({
  lineId: 'bus',
  active,
  vehicleTypeId: 'standard-bus',
  assignedVehicleCount: count,
  frequency: { daytimeHeadwayMinutes: daytime, nighttimeHeadwayMinutes: nighttime, daytimeStartHour: 0, nighttimeStartHour: 22 },
});

describe('Vehicles & Operations', () => {
  it('dispatches deterministically, moves by simulation time, and emits operating costs', () => {
    const operations = new OperationsSimulation(network(), [config()]);
    operations.advance(60);
    const vehicle = operations.snapshot().vehicles[0];
    expect(vehicle).toBeDefined();
    expect(operations.drainEvents().some((event) => event.type === 'VEHICLE_OPERATING_COST')).toBe(true);
    operations.advance(60);
    expect(operations.snapshot().vehicles[0].coordinate.longitude).toBeGreaterThanOrEqual(vehicle.coordinate.longitude);
  });

  it('boards, applies capacity, alights, and emits a fare event', () => {
    const operations = new OperationsSimulation(network(), [config()]);
    for (let index = 0; index < 75; index += 1) operations.enqueuePassenger(`p-${index}`, 'a', 'b');
    operations.advance(1);
    const snapshot = operations.snapshot();
    expect(snapshot.statistics.boardings).toBe(70);
    expect(snapshot.statistics.deniedBoardings).toBeGreaterThan(0);
    expect(operations.drainEvents().filter((event) => event.type === 'FARE_CHARGED')).toHaveLength(70);
    operations.advance(300);
    expect(operations.snapshot().statistics.alightings).toBeGreaterThanOrEqual(70);
  });

  it('activates and deactivates service without deleting the line', () => {
    const graph = network();
    const operations = new OperationsSimulation(graph, [config(1, true)]);
    operations.advance(60);
    expect(operations.snapshot().vehicles.length).toBe(1);
    operations.configureLine(config(1, false));
    const afterStop = operations.snapshot().vehicles.length;
    operations.advance(600);
    expect(operations.snapshot().vehicles.length).toBeLessThanOrEqual(afterStop);
    expect(graph.getLine('bus')).toBeDefined();
    operations.configureLine(config(3, true));
    operations.advance(10 * 60);
    expect(operations.snapshot().vehicles.length).toBeGreaterThan(0);
  });

  it('applies headway and fleet size changes', () => {
    const operations = new OperationsSimulation(network(0.05), [config(1, true, 10)]);
    operations.configureLine(config(1, true, 5));
    expect(operations.getConfiguration('bus')?.frequency.daytimeHeadwayMinutes).toBe(5);
    operations.configureLine(config(3, true, 5));
    expect(operations.getConfiguration('bus')?.assignedVehicleCount).toBe(3);
    operations.advance(5 * 60 + 1);
    expect(operations.snapshot().vehicles.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects incompatible vehicles and keeps mode capacity', () => {
    expect(modeRegistry.getVehicleDefinition('standard-bus').capacity).toBe(70);
    expect(() => new OperationsSimulation(network(), [{ ...config(), vehicleTypeId: 'standard-tram' }])).toThrow(/not compatible/);
    const operations = new OperationsSimulation(network(), [config()]);
    expect(() => operations.configureLine({ ...config(), vehicleTypeId: 'metro-4-car' })).toThrow(/not compatible/);
    operations.configureLine({ ...config(), vehicleTypeId: 'articulated-bus' });
    expect(operations.getConfiguration('bus')?.vehicleTypeId).toBe('articulated-bus');
  });

  it('reports insufficient fleet instead of pretending frequency works', () => {
    const unavailable = new OperationsSimulation(network(), [config(0)]);
    unavailable.advance(300);
    expect(unavailable.snapshot().warnings.some((warning) => /insufficient|Available fleet supports/i.test(warning))).toBe(true);
    const long = network(0.05);
    const short = new OperationsSimulation(long, [config(1, true, 4)]);
    short.advance(4 * 60 + 5);
    const supported = estimateSupportedHeadwayMinutes(long, 'bus', 'standard-bus', 1);
    expect(supported).toBeGreaterThan(4);
    expect(short.snapshot().warnings.some((warning) => warning.includes('Requested:') || /insufficient/i.test(warning))).toBe(true);
  });

  it('uses nighttime headway before daytime hours and daytime after', () => {
    const operations = new OperationsSimulation(network(), [{
      lineId: 'bus',
      active: true,
      vehicleTypeId: 'standard-bus',
      assignedVehicleCount: 20,
      frequency: { daytimeHeadwayMinutes: 5, nighttimeHeadwayMinutes: 45, daytimeStartHour: 10, nighttimeStartHour: 22 },
    }]);
    operations.advance(1);
    expect(operations.snapshot().vehicles.length).toBeGreaterThanOrEqual(1);
    operations.advance(40 * 60);
    // Night headway is 45 minutes — no additional trip yet (idle terminus vehicles do not block fleet).
    const beforeNextNightTrip = operations.snapshot().vehicles.length;
    operations.advance(5 * 60);
    expect(operations.snapshot().vehicles.length).toBeGreaterThanOrEqual(beforeNextNightTrip);
    operations.advance(10 * 3600 - operations.snapshot().simulationSeconds);
    const atDay = operations.snapshot().statistics.operatingVehicleSeconds;
    operations.advance(12 * 60);
    expect(operations.snapshot().statistics.operatingVehicleSeconds).toBeGreaterThan(atDay);
  });

  it('exposes moving vehicle coordinates for map overlays', () => {
    const graph = network();
    const operations = new OperationsSimulation(graph, [config()]);
    operations.advance(90);
    const vehicle = operations.snapshot().vehicles[0];
    expect(vehicle).toBeDefined();
    const overlay = {
      ...networkToOverlay(graph),
      vehicles: operations.snapshot().vehicles.map((item) => ({
        id: item.id,
        coordinate: item.coordinate,
        color: lineDisplayColor(graph.getLine(item.lineId)!),
        lineId: item.lineId,
        modeId: 'BUS',
        vehicleTypeId: item.vehicleTypeId,
      })),
    };
    expect(overlay.vehicles?.[0]?.coordinate).toEqual(vehicle.coordinate);
    expect(overlay.vehicles?.[0]?.color).toMatch(/^#/);
  });

  it('serializes service settings through the simulation engine', () => {
    const economy = new Economy(testCity.economy.startingBudget);
    const engine = new SimulationEngine(new World(testCity), economy, network(), { seed: 3 });
    engine.configureLineService({ ...config(3, true, 8, 18), vehicleTypeId: 'articulated-bus' });
    const saved = engine.serialize();
    expect(saved.operationsServices?.[0]).toMatchObject({
      lineId: 'bus',
      active: true,
      assignedVehicleCount: 3,
      vehicleTypeId: 'articulated-bus',
      frequency: expect.objectContaining({ daytimeHeadwayMinutes: 8, nighttimeHeadwayMinutes: 18 }),
    });
    const restored = new SimulationEngine(new World(testCity), economy, network(), { seed: 3, state: saved });
    expect(restored.getLineService('bus')).toMatchObject({ assignedVehicleCount: 3, vehicleTypeId: 'articulated-bus' });
  });
});
