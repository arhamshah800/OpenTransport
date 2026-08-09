import { describe, expect, it } from 'vitest';
import { Economy } from '../economy';
import { createLine, createStop, createTransferComplex, makeLine, TransitNetwork } from '../transit';
import { SimulationEngine } from '../time';
import { World } from '../world';
import { testCity } from '../levels/test-city';
import { OperationsSimulation } from '../operations';
import { planJourney } from './planner';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });

const service = (lineId: string, active = true, daytime = 5) => ({
  lineId,
  active,
  vehicleTypeId: 'standard-bus',
  assignedVehicleCount: 4,
  frequency: { daytimeHeadwayMinutes: daytime, nighttimeHeadwayMinutes: 20, daytimeStartHour: 0, nighttimeStartHour: 22 },
});

const directBusNetwork = (): TransitNetwork => {
  let network = new TransitNetwork();
  network = createStop(network, { id: 'a', name: 'A', coordinate: point(41.88, -87.63), kind: 'stop', supportedModes: ['BUS'] });
  network = createStop(network, { id: 'b', name: 'B', coordinate: point(41.88, -87.629), kind: 'stop', supportedModes: ['BUS'] });
  return createLine(network, makeLine('bus', 'Bus', 'BUS', ['a', 'b'], network));
};

const busToSubwayNetwork = (): TransitNetwork => {
  let network = new TransitNetwork();
  network = createStop(network, { id: 'bus-a', name: 'Bus A', coordinate: point(41.88, -87.64), kind: 'stop', supportedModes: ['BUS'] });
  network = createStop(network, { id: 'bus-xfer', name: 'Bus Transfer', coordinate: point(41.88, -87.635), kind: 'stop', supportedModes: ['BUS'] });
  network = createStop(network, { id: 'sub-xfer', name: 'Subway Transfer', coordinate: point(41.88005, -87.63495), kind: 'station', supportedModes: ['SUBWAY'] });
  network = createStop(network, { id: 'sub-b', name: 'Subway B', coordinate: point(41.88, -87.62), kind: 'station', supportedModes: ['SUBWAY'] });
  network = createLine(network, makeLine('bus', 'Bus', 'BUS', ['bus-a', 'bus-xfer'], network));
  network = createLine(network, makeLine('subway', 'Subway', 'SUBWAY', ['sub-xfer', 'sub-b'], network));
  return createTransferComplex(network, 'xfer', 'Transfer Hub', ['bus-xfer', 'sub-xfer']);
};

const corridorFor = (home: { latitude: number; longitude: number }, job: { latitude: number; longitude: number }): TransitNetwork => {
  let network = new TransitNetwork();
  network = createStop(network, { id: 'home', name: 'Home', coordinate: home, kind: 'stop', supportedModes: ['BUS'] });
  network = createStop(network, { id: 'job', name: 'Job', coordinate: job, kind: 'stop', supportedModes: ['BUS'] });
  return createLine(network, makeLine('bus', 'Bus', 'BUS', ['home', 'job'], network));
};

describe('Journey planning and passenger lifecycle', () => {
  it('plans a direct one-line journey', () => {
    const network = directBusNetwork();
    const plan = planJourney(point(41.8801, -87.6301), point(41.8801, -87.6289), network, [service('bus')]);
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ lineId: 'bus', boardStopId: 'a', alightStopId: 'b' });
  });

  it('plans a return trip on a single bidirectional line', () => {
    const network = directBusNetwork();
    expect(network.getLine('bus')?.direction).toBe('bidirectional');
    const plan = planJourney(point(41.8801, -87.6289), point(41.8801, -87.6301), network, [service('bus')]);
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ lineId: 'bus', boardStopId: 'b', alightStopId: 'a' });
  });

  it('completes a reverse ride on a bidirectional line', () => {
    const network = directBusNetwork();
    const operations = new OperationsSimulation(network, [service('bus', true, 4)]);
    expect(operations.enqueueJourney('return-1', [{ lineId: 'bus', boardStopId: 'b', alightStopId: 'a' }])).toBe(true);
    operations.advance(20 * 60);
    expect(operations.drainCompletedTrips()).toContain('return-1');
    expect(operations.snapshot().statistics.completedTrips).toBe(1);
  });

  it('returns UNSERVED when no service is active', () => {
    const network = directBusNetwork();
    const inactive = planJourney(point(41.8801, -87.6301), point(41.8801, -87.6289), network, [service('bus', false)]);
    expect(inactive).toMatchObject({ status: 'unserved' });
    const empty = planJourney(point(41.8801, -87.6301), point(41.8801, -87.6289), network, []);
    expect(empty).toMatchObject({ status: 'unserved' });
  });

  it('plans a bus-to-subway transfer through a connected complex', () => {
    const network = busToSubwayNetwork();
    const plan = planJourney(point(41.8801, -87.6401), point(41.8801, -87.6201), network, [
      service('bus'),
      { ...service('subway'), vehicleTypeId: 'metro-4-car' },
    ]);
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(plan.legs.length).toBeGreaterThanOrEqual(2);
    expect(plan.legs[0].lineId).toBe('bus');
    expect(plan.legs.some((leg) => leg.lineId === 'subway')).toBe(true);
    expect(plan.transferCount).toBeGreaterThanOrEqual(1);
  });

  it('does not invent a disconnected transfer', () => {
    let network = new TransitNetwork();
    network = createStop(network, { id: 'bus-a', name: 'Bus A', coordinate: point(41.88, -87.64), kind: 'stop', supportedModes: ['BUS'] });
    network = createStop(network, { id: 'bus-b', name: 'Bus B', coordinate: point(41.88, -87.635), kind: 'stop', supportedModes: ['BUS'] });
    network = createStop(network, { id: 'sub-a', name: 'Sub A', coordinate: point(41.90, -87.62), kind: 'station', supportedModes: ['SUBWAY'] });
    network = createStop(network, { id: 'sub-b', name: 'Sub B', coordinate: point(41.90, -87.61), kind: 'station', supportedModes: ['SUBWAY'] });
    network = createLine(network, makeLine('bus', 'Bus', 'BUS', ['bus-a', 'bus-b'], network));
    network = createLine(network, makeLine('subway', 'Subway', 'SUBWAY', ['sub-a', 'sub-b'], network));
    const plan = planJourney(point(41.8801, -87.6401), point(41.9001, -87.6101), network, [
      service('bus'),
      { ...service('subway'), vehicleTypeId: 'metro-4-car' },
    ]);
    expect(plan.status).toBe('unserved');
  });

  it('denies boarding when full and boards a later vehicle', () => {
    const network = directBusNetwork();
    const operations = new OperationsSimulation(network, [service('bus', true, 4)]);
    for (let index = 0; index < 80; index += 1) {
      expect(operations.enqueueJourney(`p-${index}`, [{ lineId: 'bus', boardStopId: 'a', alightStopId: 'b' }])).toBe(true);
    }
    operations.advance(1);
    const first = operations.snapshot();
    expect(first.statistics.boardings).toBe(70);
    expect(first.statistics.deniedBoardings).toBeGreaterThan(0);
    expect(first.queues.a?.length ?? 0).toBeGreaterThan(0);
    operations.advance(4 * 60 + 5);
    expect(operations.snapshot().statistics.boardings).toBeGreaterThan(70);
  });

  it('completes a journey and emits a fare event on first boarding', () => {
    const network = directBusNetwork();
    const operations = new OperationsSimulation(network, [service('bus', true, 4)]);
    expect(operations.enqueueJourney('rider-1', [{ lineId: 'bus', boardStopId: 'a', alightStopId: 'b' }])).toBe(true);
    operations.advance(1);
    expect(operations.drainEvents().filter((event) => event.type === 'FARE_CHARGED')).toHaveLength(1);
    operations.advance(400);
    expect(operations.drainCompletedTrips()).toContain('rider-1');
    expect(operations.snapshot().statistics.completedTrips).toBe(1);
  });

  it('completes a transfer journey with free-transfer fare policy', () => {
    const network = busToSubwayNetwork();
    const operations = new OperationsSimulation(network, [
      service('bus', true, 4),
      { ...service('subway', true, 4), vehicleTypeId: 'metro-4-car' },
    ]);
    const plan = planJourney(point(41.8801, -87.6401), point(41.8801, -87.6201), network, operations.listConfigurations());
    expect(plan.status).toBe('planned');
    if (plan.status !== 'planned') return;
    expect(operations.enqueueJourney('xfer-rider', plan.legs)).toBe(true);
    operations.advance(45 * 60);
    expect(operations.drainCompletedTrips()).toContain('xfer-rider');
    const fares = operations.drainEvents().filter((event) => event.type === 'FARE_CHARGED');
    expect(fares.length).toBe(1);
  });

  it('connects population demand into operations for morning and evening trips', () => {
    const world = new World(testCity);
    const economy = new Economy(world.definition.economy.startingBudget);
    const probe = new SimulationEngine(world, economy, new TransitNetwork(), { seed: 12345 });
    const worker = probe.getPopulation().getResidents().find((resident) => resident.workplaceCoordinate);
    expect(worker?.workplaceCoordinate).toBeDefined();
    const network = corridorFor(worker!.home, worker!.workplaceCoordinate!);
    const engine = new SimulationEngine(world, economy, network, { seed: 12345 });
    engine.configureLineService({ ...service('bus', true, 5), lineId: 'bus', assignedVehicleCount: 8 });
    engine.advanceBy(9 * 3600 + 30 * 60);
    const morning = engine.snapshot();
    expect((morning.operations?.statistics.boardings ?? 0) + morning.population.traveling).toBeGreaterThan(0);
    engine.advanceBy(10 * 3600);
    const evening = engine.snapshot();
    expect(evening.population.servedTrips + (evening.operations?.statistics.completedTrips ?? 0)).toBeGreaterThan(0);
    expect(economy.getLedger().some((entry) => entry.category === 'FARE_REVENUE')).toBe(true);
  }, 60_000);

  it('replans pending same-day demand after network changes', () => {
    const world = new World(testCity);
    const economy = new Economy(world.definition.economy.startingBudget);
    const engine = new SimulationEngine(world, economy, new TransitNetwork(), { seed: 99 });
    const worker = engine.getPopulation().getResidents().find((resident) => resident.workplaceCoordinate)!;
    engine.advanceBy(worker.outboundDepartureMinute * 60 + 60);
    const pending = engine.getPopulation().getTravelRequests().filter((request) => request.status === 'unresolved').length;
    expect(pending).toBeGreaterThan(0);
    expect(engine.snapshot().population.unservedTrips).toBe(0);
    engine.syncNetwork(corridorFor(worker.home, worker.workplaceCoordinate!));
    engine.configureLineService({ ...service('bus', true, 5), lineId: 'bus', assignedVehicleCount: 6 });
    engine.replanPendingDemand();
    engine.advanceBy(2 * 3600);
    expect((engine.snapshot().operations?.statistics.boardings ?? 0) + engine.snapshot().population.traveling).toBeGreaterThan(0);
  }, 60_000);

  it('serves Port Junction corridor demand when a route covers home-to-work geography', () => {
    const world = new World(testCity);
    const economy = new Economy(world.definition.economy.startingBudget);
    const probe = new SimulationEngine(world, economy, new TransitNetwork(), { seed: 7 });
    const worker = probe.getPopulation().getResidents().find((resident) => resident.workplaceCoordinate)!;
    let network = new TransitNetwork();
    network = createStop(network, { id: 'home-stop', name: 'Home', coordinate: worker.home, kind: 'stop', supportedModes: ['BUS'] });
    network = createStop(network, { id: 'job-stop', name: 'Job', coordinate: worker.workplaceCoordinate!, kind: 'stop', supportedModes: ['BUS'] });
    network = createLine(network, makeLine('pj-bus', 'Port Junction Bus', 'BUS', ['home-stop', 'job-stop'], network));
    const plan = planJourney(worker.home, worker.workplaceCoordinate!, network, [{ ...service('pj-bus'), lineId: 'pj-bus' }]);
    expect(plan.status).toBe('planned');
    const engine = new SimulationEngine(world, economy, network, { seed: 7 });
    engine.configureLineService({ ...service('pj-bus', true, 4), lineId: 'pj-bus', assignedVehicleCount: 6 });
    engine.advanceBy(10 * 3600);
    const snapshot = engine.snapshot();
    expect((snapshot.operations?.statistics.boardings ?? 0) + snapshot.population.servedTrips).toBeGreaterThan(0);
  }, 60_000);
});
