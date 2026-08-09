import { describe, expect, it } from 'vitest';
import { Economy } from '../economy';
import { createLine, createStop, makeLine, TransitNetwork } from '../transit';
import { World } from '../world';
import { testCity } from '../levels/test-city';
import { SimulationEngine } from './SimulationEngine';

const network = (): TransitNetwork => { let value = new TransitNetwork(); value = createStop(value, { id: 'a', name: 'A', coordinate: { latitude: 41.88, longitude: -87.63 }, kind: 'stop', supportedModes: ['BUS'] }); value = createStop(value, { id: 'b', name: 'B', coordinate: { latitude: 41.88, longitude: -87.629 }, kind: 'stop', supportedModes: ['BUS'] }); return createLine(value, makeLine('bus', 'Bus', 'BUS', ['a', 'b'], value)); };
const create = (withNetwork = false): { engine: SimulationEngine; economy: Economy } => { const economy = new Economy(testCity.economy.startingBudget); return { economy, engine: new SimulationEngine(new World(testCity), economy, withNetwork ? network() : new TransitNetwork(), { seed: 7 }) }; };
describe('Time & Simulation Engine', () => {
  it('pauses, advances at configured speeds, and uses fixed logical seconds', () => { const { engine } = create(); engine.advanceRealTime(10); expect(engine.snapshot().timestampSeconds).toBe(0); engine.setSpeed(2); engine.advanceRealTime(2.6); expect(engine.snapshot().timestampSeconds).toBe(5); engine.setSpeed(4); engine.advanceRealTime(0.5); expect(engine.snapshot().timestampSeconds).toBe(7); });
  it('rolls calendar days and weeks deterministically', () => { const { engine } = create(); engine.advanceBy(86_400 * 7 + 61); const snapshot = engine.snapshot(); expect(snapshot.calendar).toMatchObject({ day: 8, dayOfWeek: 'Monday', hour: 0, minute: 1, second: 1 }); expect(snapshot.servicePeriod).toBe('nighttime'); engine.advanceBy(6 * 3600); expect(engine.snapshot().servicePeriod).toBe('daytime'); }, 20_000);
  it('coordinates population, dispatch, economics, and scheduled loan payments on shared time', () => { const { engine } = create(true); engine.advanceBy(9 * 3600 + 30 * 60); expect(engine.snapshot().population.requestingRoute + engine.snapshot().population.traveling + engine.snapshot().population.atDestination + engine.snapshot().population.unservedTrips).toBeGreaterThan(0); expect(engine.snapshot().operations?.vehicles.length).toBeGreaterThan(0); expect(engine.snapshot().finances.allTime.operatingCostCents).toBeGreaterThan(0); const loanEconomy = new Economy(0); const loan = loanEconomy.takeLoan('small-expansion', 0); const nearDue = new SimulationEngine(new World(testCity), loanEconomy, new TransitNetwork(), { seed: 7, state: { version: 1, timestampSeconds: loan.nextPaymentAtSeconds - 1, speed: 0, scheduledEvents: [] } }); nearDue.advanceBy(1); expect(loanEconomy.getLedger().some((entry) => entry.category === 'LOAN_INTEREST')).toBe(true); }, 30_000);
  it('serializes time and can run multiple days without browser waiting', () => { const first = create(); first.engine.advanceBy(86_400 * 3); const saved = first.engine.serialize(); const restored = new SimulationEngine(new World(testCity), first.economy, new TransitNetwork(), { seed: 7, state: saved }); expect(restored.snapshot().timestampSeconds).toBe(first.engine.snapshot().timestampSeconds); expect(restored.snapshot().calendar.day).toBe(4); }, 20_000);
  it('preserves operations service settings across network sync', () => {
    const { engine } = create(true);
    engine.configureLineService({ lineId: 'bus', active: true, vehicleTypeId: 'articulated-bus', assignedVehicleCount: 4, frequency: { daytimeHeadwayMinutes: 8, nighttimeHeadwayMinutes: 18, daytimeStartHour: 6, nighttimeStartHour: 22 } });
    engine.syncNetwork(network());
    expect(engine.getLineService('bus')).toMatchObject({ vehicleTypeId: 'articulated-bus', assignedVehicleCount: 4 });
  });
});
