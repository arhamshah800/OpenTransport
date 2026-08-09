import { Economy } from '../economy';
import { journeyWalkSeconds, planJourney } from '../journey';
import { modeRegistry } from '../modes';
import { OperationsSimulation, type LineServiceConfiguration, type StopPassengerStats } from '../operations';
import { PopulationSimulation } from '../population';
import { TransitNetwork } from '../transit';
import type { World } from '../world';
import type { ScheduledEvent, SimulationCalendar, SimulationEngineState, SimulationSnapshot, SimulationSpeed, SimulationTickContext } from './types';

const fixedStepSeconds = 1;
const weekDays: readonly SimulationCalendar['dayOfWeek'][] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const calendarAt = (seconds: number): SimulationCalendar => {
  const whole = Math.floor(seconds);
  const day = Math.floor(whole / 86_400) + 1;
  const withinDay = whole % 86_400;
  return { day, dayOfWeek: weekDays[(day - 1) % 7], hour: Math.floor(withinDay / 3600), minute: Math.floor((withinDay % 3600) / 60), second: withinDay % 60 };
};

export const defaultLineService = (network: TransitNetwork, lineId: string): LineServiceConfiguration => {
  const line = network.getLine(lineId);
  if (!line) throw new Error(`Unknown line "${lineId}"`);
  const mode = modeRegistry.getModeDefinition(line.mode);
  const planned = line.serviceSettings?.plannedHeadwayMinutes;
  return {
    lineId: line.id,
    active: line.active,
    vehicleTypeId: mode.vehicleIds[0],
    assignedVehicleCount: 2,
    frequency: {
      ...mode.operations.defaultFrequency,
      daytimeHeadwayMinutes: planned ?? mode.operations.defaultFrequency.daytimeHeadwayMinutes,
    },
  };
};

const defaultServices = (network: TransitNetwork, previous: readonly LineServiceConfiguration[] = []): readonly LineServiceConfiguration[] => {
  const prior = new Map(previous.map((item) => [item.lineId, item]));
  return network.definition.lines.map((line) => prior.get(line.id) ?? defaultLineService(network, line.id));
};

/** Deterministic, DOM-free game heartbeat. Browser adapters supply real-time deltas but never mutate gameplay directly. */
export class SimulationEngine {
  private timestampSeconds: number;
  private speed: SimulationSpeed;
  private accumulatorSeconds = 0;
  private scheduledEvents: ScheduledEvent[];
  private readonly population: PopulationSimulation;
  private operations?: OperationsSimulation;
  private network: TransitNetwork;
  private demandCursor = 0;

  public constructor(world: World, private readonly economy: Economy, network: TransitNetwork, options: { readonly seed?: number; readonly state?: SimulationEngineState } = {}) {
    const state = options.state;
    this.network = network;
    this.timestampSeconds = state?.timestampSeconds ?? 0;
    this.speed = state?.speed ?? 0;
    this.scheduledEvents = [...(state?.scheduledEvents ?? [])];
    this.population = new PopulationSimulation(world, { seed: options.seed ?? 12345 });
    if (network.definition.lines.length) {
      this.operations = new OperationsSimulation(network, state?.operationsServices?.length ? defaultServices(network, state.operationsServices) : defaultServices(network));
    }
    this.population.tick({ absoluteMinutes: this.timestampSeconds / 60 });
  }

  public syncNetwork(network: TransitNetwork): void {
    this.network = network;
    if (!network.definition.lines.length) {
      this.operations = undefined;
      return;
    }
    if (!this.operations) {
      this.operations = new OperationsSimulation(network, defaultServices(network));
      return;
    }
    this.operations.replaceNetwork(network, defaultServices(network, this.operations.listConfigurations()));
  }

  public configureLineService(configuration: LineServiceConfiguration): void {
    if (!this.operations) this.operations = new OperationsSimulation(this.network, []);
    this.operations.configureLine(configuration);
  }

  public getLineService(lineId: string): LineServiceConfiguration | undefined { return this.operations?.getConfiguration(lineId); }
  public listLineServices(): readonly LineServiceConfiguration[] { return this.operations?.listConfigurations() ?? []; }
  public getPopulation(): PopulationSimulation { return this.population; }
  public getOperations(): OperationsSimulation | undefined { return this.operations; }
  public stopPassengerStats(stopId: string): StopPassengerStats | undefined { return this.operations?.stopPassengerStats(stopId); }

  public setSpeed(speed: SimulationSpeed): void { this.speed = speed; }
  public getSpeed(): SimulationSpeed { return this.speed; }

  public advanceRealTime(realSeconds: number): number {
    if (!Number.isFinite(realSeconds) || realSeconds < 0) throw new Error('Real-time delta must be nonnegative.');
    this.accumulatorSeconds += realSeconds * this.speed;
    let ticks = 0;
    while (this.accumulatorSeconds >= fixedStepSeconds) {
      this.advanceFixedStep();
      this.accumulatorSeconds -= fixedStepSeconds;
      ticks += 1;
    }
    return ticks;
  }

  public advanceBy(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Simulation advancement requires nonnegative seconds.');
    const target = this.timestampSeconds + seconds;
    while (this.timestampSeconds < target) {
      const remaining = target - this.timestampSeconds;
      // When no vehicles or waiting passengers are active, jump by the minute to keep multi-hour tests practical.
      const idle = !this.operations || this.operations.isIdle();
      const step = idle && remaining >= 60 ? Math.min(60, remaining) : Math.min(fixedStepSeconds, remaining);
      this.advanceStep(step);
    }
  }

  public schedule(event: ScheduledEvent): void {
    if (!Number.isFinite(event.timestampSeconds) || event.timestampSeconds < this.timestampSeconds) throw new Error('Scheduled events must occur at or after the current simulation time.');
    if (this.scheduledEvents.some((item) => item.id === event.id)) throw new Error(`Scheduled event "${event.id}" already exists.`);
    this.scheduledEvents = [...this.scheduledEvents, event].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  }

  public drainDueEvents(): readonly ScheduledEvent[] {
    const due = this.scheduledEvents.filter((event) => event.timestampSeconds <= this.timestampSeconds);
    this.scheduledEvents = this.scheduledEvents.filter((event) => event.timestampSeconds > this.timestampSeconds);
    return due;
  }

  private advanceFixedStep(): void { this.advanceStep(fixedStepSeconds); }

  private advanceStep(deltaSeconds: number): void {
    const previousSeconds = this.timestampSeconds;
    this.timestampSeconds += deltaSeconds;
    const calendar = calendarAt(this.timestampSeconds);
    const context: SimulationTickContext = {
      previousSeconds,
      currentSeconds: this.timestampSeconds,
      deltaSeconds,
      crossedDayBoundary: Math.floor(previousSeconds / 86_400) !== Math.floor(this.timestampSeconds / 86_400),
      crossedHourBoundary: Math.floor(previousSeconds / 3600) !== Math.floor(this.timestampSeconds / 3600),
      calendar,
    };
    this.population.tick({ absoluteMinutes: context.currentSeconds / 60 });
    this.processTravelDemand(calendar.hour);
    if (this.operations) {
      this.operations.advance(context.deltaSeconds);
      this.economy.consumeOperationsEvents(this.operations.drainEvents());
      for (const passengerId of this.operations.drainCompletedTrips()) {
        this.population.completeTransitJourney(passengerId);
      }
    }
    this.economy.processScheduledPayments(context.currentSeconds);
  }

  /** Plan unresolved population requests against the live network and enqueue journeys into Operations. */
  private processTravelDemand(hourOfDay: number): void {
    const requests = this.population.getTravelRequests();
    if (this.demandCursor > requests.length) this.demandCursor = 0;
    if (this.demandCursor >= requests.length) return;
    const services = this.operations?.listConfigurations() ?? [];
    const hasActiveService = Boolean(this.operations && this.network.definition.lines.some((line) => line.active));
    for (; this.demandCursor < requests.length; this.demandCursor += 1) {
      const request = requests[this.demandCursor];
      if (request.status !== 'unresolved') continue;
      if (!hasActiveService || !this.operations) {
        this.population.markRequestUnserved(request.id);
        this.operations?.recordUnservedDemand();
        continue;
      }
      const plan = planJourney(request.origin, request.destination, this.network, services, { hourOfDay });
      if (plan.status === 'unserved') {
        this.population.markRequestUnserved(request.id);
        this.operations.recordUnservedDemand();
        continue;
      }
      const delaySeconds = journeyWalkSeconds(plan.accessWalkMeters);
      const enqueued = this.operations.enqueueJourney(request.id, plan.legs, { delaySeconds });
      if (!enqueued) {
        this.population.markRequestUnserved(request.id);
        continue;
      }
      this.population.assignTransitJourney(request.id);
    }
  }

  public snapshot(): SimulationSnapshot {
    const calendar = calendarAt(this.timestampSeconds);
    const servicePeriod = calendar.hour >= 6 && calendar.hour < 22 ? 'daytime' : 'nighttime';
    return {
      timestampSeconds: this.timestampSeconds,
      speed: this.speed,
      paused: this.speed === 0,
      calendar,
      servicePeriod,
      population: this.population.summary(),
      operations: this.operations?.snapshot(),
      finances: this.economy.getFinancialSummary(this.timestampSeconds),
    };
  }

  public serialize(): SimulationEngineState {
    return {
      version: 1,
      timestampSeconds: this.timestampSeconds,
      speed: this.speed,
      scheduledEvents: this.scheduledEvents,
      operationsServices: this.operations?.serializeServices(),
    };
  }
}
