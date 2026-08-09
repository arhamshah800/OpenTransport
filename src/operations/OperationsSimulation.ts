import { distanceMeters, interpolatePolyline } from '../map';
import { modeRegistry, validateServiceFrequency } from '../modes';
import { journeyWalkSeconds, type JourneyLeg } from '../journey';
import { TransitNetwork } from '../transit';
import type { TransitLine } from '../transit';
import { estimateSupportedHeadwayMinutes } from './fleetPlanning';
import type { LineServiceConfiguration, OperationsEvent, OperationsSnapshot, OperationsStatistics, StopPassengerStats, VehicleRuntime, WaitingPassenger } from './types';

const emptyStats = (): OperationsStatistics => ({ boardings: 0, alightings: 0, deniedBoardings: 0, unservedDemand: 0, totalWaitSeconds: 0, maximumWaitSeconds: 0, operatingVehicleSeconds: 0, completedTrips: 0, byLine: {} });
const lineLength = (line: TransitLine): number => line.segments.reduce((total, segment) => total + segment.geometry.slice(1).reduce((sum, point, index) => sum + distanceMeters(segment.geometry[index], point), 0), 0);

interface PendingArrival {
  readonly availableAtSeconds: number;
  readonly boardStopId: string;
  readonly passenger: WaitingPassenger;
}

/** Deterministic service simulator advanced solely by explicit simulation seconds. */
export class OperationsSimulation {
  private timeSeconds = 0;
  private vehicles: VehicleRuntime[] = [];
  private readonly queues = new Map<string, WaitingPassenger[]>();
  private readonly lastDispatch = new Map<string, number>();
  private readonly configurations = new Map<string, LineServiceConfiguration>();
  private stats = emptyStats();
  private events: OperationsEvent[] = [];
  private warnings: string[] = [];
  private pendingArrivals: PendingArrival[] = [];
  private completedPassengerIds: string[] = [];
  private readonly recentBoardingsByStop = new Map<string, number>();
  private readonly deniedByStop = new Map<string, number>();

  public constructor(private network: TransitNetwork, configurations: readonly LineServiceConfiguration[]) {
    configurations.forEach((configuration) => this.configureLine(configuration));
  }

  public configureLine(configuration: LineServiceConfiguration): void {
    const line = this.network.getLine(configuration.lineId);
    if (!line) throw new Error(`Unknown line "${configuration.lineId}"`);
    const vehicle = modeRegistry.getVehicleDefinition(configuration.vehicleTypeId);
    if (vehicle.modeId !== line.mode) throw new Error(`Vehicle "${vehicle.id}" is not compatible with line "${line.id}"`);
    validateServiceFrequency(configuration.frequency, modeRegistry.getModeDefinition(line.mode).operations.minimumHeadwayMinutes);
    if (!Number.isInteger(configuration.assignedVehicleCount) || configuration.assignedVehicleCount < 0) throw new Error('Assigned vehicle count must be a nonnegative integer.');
    this.configurations.set(line.id, configuration);
    this.warnings = this.warnings.filter((warning) => !warning.includes(`Line ${line.id}`) && !warning.startsWith('Requested: every'));
  }

  /** Keep runtime service when the player edits topology. Existing moving vehicles finish their trips. */
  public replaceNetwork(network: TransitNetwork, defaultConfigurations: readonly LineServiceConfiguration[] = []): void {
    this.network = network;
    for (const lineId of [...this.configurations.keys()]) {
      if (!network.getLine(lineId)) this.configurations.delete(lineId);
    }
    this.vehicles = this.vehicles.filter((vehicle) => Boolean(network.getLine(vehicle.lineId)));
    for (const configuration of defaultConfigurations) {
      if (network.getLine(configuration.lineId) && !this.configurations.has(configuration.lineId)) this.configureLine(configuration);
    }
  }

  public getConfiguration(lineId: string): LineServiceConfiguration | undefined { return this.configurations.get(lineId); }
  public listConfigurations(): readonly LineServiceConfiguration[] { return [...this.configurations.values()]; }

  public enqueuePassenger(id: string, originStopId: string, destinationStopId: string): boolean {
    const direct = this.network.definition.lines.find((line) => line.active && line.stopIds.indexOf(originStopId) >= 0 && line.stopIds.indexOf(destinationStopId) > line.stopIds.indexOf(originStopId));
    if (!direct) { this.stats = { ...this.stats, unservedDemand: this.stats.unservedDemand + 1 }; return false; }
    this.queuePassenger(originStopId, { id, destinationStopId, arrivedAtSeconds: this.timeSeconds, farePaid: false });
    return true;
  }

  /** Enqueue the first leg of a planned multi-leg journey. Later legs activate after alighting. */
  public enqueueJourney(id: string, legs: readonly JourneyLeg[], options: { readonly farePaid?: boolean; readonly delaySeconds?: number } = {}): boolean {
    if (!legs.length) { this.stats = { ...this.stats, unservedDemand: this.stats.unservedDemand + 1 }; return false; }
    const [first, ...remaining] = legs;
    const line = this.network.getLine(first.lineId);
    if (!line?.active) { this.stats = { ...this.stats, unservedDemand: this.stats.unservedDemand + 1 }; return false; }
    const from = line.stopIds.indexOf(first.boardStopId);
    const to = line.stopIds.indexOf(first.alightStopId);
    if (from < 0 || to <= from) { this.stats = { ...this.stats, unservedDemand: this.stats.unservedDemand + 1 }; return false; }
    const passenger: WaitingPassenger = {
      id,
      destinationStopId: first.alightStopId,
      arrivedAtSeconds: this.timeSeconds + Math.max(0, options.delaySeconds ?? 0),
      remainingLegs: remaining.length ? remaining : undefined,
      farePaid: options.farePaid ?? false,
    };
    const delay = Math.max(0, options.delaySeconds ?? 0);
    if (delay > 0) this.pendingArrivals = [...this.pendingArrivals, { availableAtSeconds: this.timeSeconds + delay, boardStopId: first.boardStopId, passenger }];
    else this.queuePassenger(first.boardStopId, { ...passenger, arrivedAtSeconds: this.timeSeconds });
    return true;
  }

  public recordUnservedDemand(count = 1): void {
    this.stats = { ...this.stats, unservedDemand: this.stats.unservedDemand + count };
  }

  public advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new Error('Operations advancement requires nonnegative simulation seconds.');
    const target = this.timeSeconds + deltaSeconds;
    const costBucket = new Map<string, { lineId: string; vehicleId: string; amountCents: number }>();
    while (this.timeSeconds < target) {
      const step = Math.min(1, target - this.timeSeconds);
      this.releasePendingArrivals();
      this.dispatch();
      this.moveVehicles(step);
      this.accumulateOperatingCosts(step, costBucket);
      this.timeSeconds += step;
    }
    for (const entry of costBucket.values()) {
      this.events.push({ type: 'VEHICLE_OPERATING_COST', lineId: entry.lineId, vehicleId: entry.vehicleId, amountCents: entry.amountCents, timestampSeconds: this.timeSeconds });
    }
  }

  private releasePendingArrivals(): void {
    const ready = this.pendingArrivals.filter((item) => item.availableAtSeconds <= this.timeSeconds);
    if (!ready.length) return;
    this.pendingArrivals = this.pendingArrivals.filter((item) => item.availableAtSeconds > this.timeSeconds);
    for (const item of ready) this.queuePassenger(item.boardStopId, { ...item.passenger, arrivedAtSeconds: this.timeSeconds });
  }

  private queuePassenger(stopId: string, passenger: WaitingPassenger): void {
    const queue = this.queues.get(stopId) ?? [];
    this.queues.set(stopId, [...queue, passenger]);
  }

  private dispatch(): void {
    const hour = Math.floor((this.timeSeconds / 3600) % 24);
    for (const line of this.network.definition.lines) {
      const config = this.configurations.get(line.id);
      if (!config?.active || !line.active) continue;
      const headwayMinutes = hour >= config.frequency.daytimeStartHour && hour < config.frequency.nighttimeStartHour ? config.frequency.daytimeHeadwayMinutes : config.frequency.nighttimeHeadwayMinutes;
      // Idle terminus vehicles stay visible but do not consume fleet slots (simplified depot recirculation).
      const activeCount = this.vehicles.filter((vehicle) => vehicle.lineId === line.id && this.countsAgainstFleet(vehicle)).length;
      const last = this.lastDispatch.get(line.id) ?? -Infinity;
      if (activeCount < config.assignedVehicleCount && this.timeSeconds - last >= headwayMinutes * 60) {
        this.vehicles = this.vehicles.filter((vehicle) => !(vehicle.lineId === line.id && this.isIdleAtTerminus(vehicle)));
        const start = this.network.getStop(line.stopIds[0])!;
        const id = `${line.id}-vehicle-${activeCount + 1}-${Math.floor(this.timeSeconds)}`;
        const vehicle: VehicleRuntime = { id, lineId: line.id, vehicleTypeId: config.vehicleTypeId, state: 'DWELLING', stopIndex: 0, segmentProgressMeters: 0, dwellRemainingSeconds: 0, passengers: [], coordinate: start.coordinate };
        this.vehicles = [...this.vehicles, this.serviceStop(vehicle)];
        this.lastDispatch.set(line.id, this.timeSeconds);
      } else if (activeCount >= config.assignedVehicleCount && this.timeSeconds - last >= headwayMinutes * 60) {
        const supported = estimateSupportedHeadwayMinutes(this.network, line.id, config.vehicleTypeId, config.assignedVehicleCount);
        if (supported > headwayMinutes) {
          const warning = Number.isFinite(supported)
            ? `Requested: every ${headwayMinutes} min. Available fleet supports: every ${supported} min.`
            : `Line ${line.id} has insufficient assigned vehicles for its requested headway.`;
          if (!this.warnings.includes(warning)) {
            this.warnings = [...this.warnings.filter((item) => !item.includes(`Line ${line.id}`) && !item.includes(`line ${line.id}`) && !(item.startsWith('Requested:') && item.includes(`${headwayMinutes} min`))), warning];
          }
        }
      }
    }
  }

  private isIdleAtTerminus(vehicle: VehicleRuntime): boolean {
    const line = this.network.getLine(vehicle.lineId);
    if (!line) return false;
    return vehicle.stopIndex >= line.stopIds.length - 1 && !line.segments[vehicle.stopIndex] && vehicle.dwellRemainingSeconds <= 0;
  }

  private countsAgainstFleet(vehicle: VehicleRuntime): boolean {
    return !this.isIdleAtTerminus(vehicle);
  }

  private moveVehicles(step: number): void {
    this.vehicles = this.vehicles.map((vehicle) => {
      const line = this.network.getLine(vehicle.lineId)!;
      const template = modeRegistry.getVehicleDefinition(vehicle.vehicleTypeId);
      if (vehicle.state === 'DWELLING') {
        const remaining = vehicle.dwellRemainingSeconds - step;
        if (remaining > 0) return { ...vehicle, dwellRemainingSeconds: remaining };
        // Finished terminus dwell: remain idle for map display until a replacement trip is dispatched.
        if (!line.segments[vehicle.stopIndex]) return { ...vehicle, state: 'DWELLING', dwellRemainingSeconds: 0 };
        return { ...vehicle, state: 'TRAVELING', dwellRemainingSeconds: 0 };
      }
      const segment = line.segments[vehicle.stopIndex];
      if (!segment) return vehicle;
      const length = lineLength({ ...line, segments: [segment] });
      const progressed = vehicle.segmentProgressMeters + template.maximumSpeedKph * 1000 / 3600 * step;
      if (progressed < length) return { ...vehicle, segmentProgressMeters: progressed, coordinate: interpolatePolyline(segment.geometry, progressed) };
      const nextIndex = vehicle.stopIndex + 1;
      const arrived = { ...vehicle, stopIndex: nextIndex, segmentProgressMeters: 0, coordinate: this.network.getStop(line.stopIds[nextIndex])!.coordinate };
      return this.serviceStop(arrived);
    });
  }

  private serviceStop(vehicle: VehicleRuntime): VehicleRuntime {
    const line = this.network.getLine(vehicle.lineId)!;
    const template = modeRegistry.getVehicleDefinition(vehicle.vehicleTypeId);
    const stopId = line.stopIds[vehicle.stopIndex];
    const alighting = vehicle.passengers.filter((passenger) => passenger.destinationStopId === stopId);
    const continuing = vehicle.passengers.filter((passenger) => passenger.destinationStopId !== stopId);
    if (alighting.length) {
      this.stats = {
        ...this.stats,
        alightings: this.stats.alightings + alighting.length,
        byLine: { ...this.stats.byLine, [line.id]: { boardings: this.stats.byLine[line.id]?.boardings ?? 0, alightings: (this.stats.byLine[line.id]?.alightings ?? 0) + alighting.length } },
      };
      for (const passenger of alighting) this.handleAlight(passenger, stopId, line.mode);
    }

    const queue = this.queues.get(stopId) ?? [];
    // Only board passengers whose current destination is later on this vehicle's line.
    const eligible = queue.filter((passenger) => line.stopIds.indexOf(passenger.destinationStopId) > vehicle.stopIndex);
    const ineligible = queue.filter((passenger) => line.stopIds.indexOf(passenger.destinationStopId) <= vehicle.stopIndex);
    const available = template.capacity - continuing.length;
    const boarding = eligible.slice(0, Math.max(0, available));
    const leftEligible = eligible.slice(boarding.length);
    this.queues.set(stopId, [...ineligible, ...leftEligible]);
    if (leftEligible.length > 0) {
      this.stats = { ...this.stats, deniedBoardings: this.stats.deniedBoardings + leftEligible.length };
      this.deniedByStop.set(stopId, (this.deniedByStop.get(stopId) ?? 0) + leftEligible.length);
    }
    const mode = modeRegistry.getModeDefinition(line.mode);
    for (const passenger of boarding) {
      const wait = Math.max(0, this.timeSeconds - passenger.arrivedAtSeconds);
      this.stats = {
        ...this.stats,
        boardings: this.stats.boardings + 1,
        totalWaitSeconds: this.stats.totalWaitSeconds + wait,
        maximumWaitSeconds: Math.max(this.stats.maximumWaitSeconds, wait),
        byLine: { ...this.stats.byLine, [line.id]: { boardings: (this.stats.byLine[line.id]?.boardings ?? 0) + 1, alightings: this.stats.byLine[line.id]?.alightings ?? 0 } },
      };
      this.recentBoardingsByStop.set(stopId, (this.recentBoardingsByStop.get(stopId) ?? 0) + 1);
      const shouldCharge = !passenger.farePaid || !mode.operations.defaultFare.freeTransfers;
      if (shouldCharge) {
        this.events.push({ type: 'FARE_CHARGED', lineId: line.id, vehicleId: vehicle.id, passengerId: passenger.id, amountCents: mode.operations.defaultFare.fareCents, timestampSeconds: this.timeSeconds });
      }
    }
    const dwell = (mode.operations.defaultDwellSeconds + boarding.length + alighting.length) * template.dwellTimeModifier;
    return {
      ...vehicle,
      state: 'DWELLING',
      dwellRemainingSeconds: dwell,
      passengers: [...continuing, ...boarding.map((passenger) => ({ ...passenger, farePaid: true }))],
    };
  }

  private handleAlight(passenger: WaitingPassenger, stopId: string, modeId: string): void {
    const remaining = passenger.remainingLegs ?? [];
    if (!remaining.length) {
      this.completedPassengerIds = [...this.completedPassengerIds, passenger.id];
      this.stats = { ...this.stats, completedTrips: this.stats.completedTrips + 1 };
      return;
    }
    const mode = modeRegistry.getModeDefinition(modeId);
    const [next, ...rest] = remaining;
    const fromStop = this.network.getStop(stopId);
    const boardStop = this.network.getStop(next.boardStopId);
    const transferMeters = fromStop && boardStop ? distanceMeters(fromStop.coordinate, boardStop.coordinate) : 0;
    const delaySeconds = journeyWalkSeconds(transferMeters);
    this.enqueueJourney(passenger.id, [{ ...next }, ...rest], {
      farePaid: Boolean(passenger.farePaid && mode.operations.defaultFare.freeTransfers),
      delaySeconds,
    });
  }

  private accumulateOperatingCosts(step: number, bucket: Map<string, { lineId: string; vehicleId: string; amountCents: number }>): void {
    this.vehicles.forEach((vehicle) => {
      const cost = Math.round(modeRegistry.getVehicleDefinition(vehicle.vehicleTypeId).operatingCostPerHour * 100 * step / 3600);
      const previous = bucket.get(vehicle.id);
      bucket.set(vehicle.id, { lineId: vehicle.lineId, vehicleId: vehicle.id, amountCents: (previous?.amountCents ?? 0) + cost });
    });
    this.stats = { ...this.stats, operatingVehicleSeconds: this.stats.operatingVehicleSeconds + this.vehicles.length * step };
  }

  public drainEvents(): readonly OperationsEvent[] { const events = this.events; this.events = []; return events; }
  public drainCompletedTrips(): readonly string[] { const ids = this.completedPassengerIds; this.completedPassengerIds = []; return ids; }

  public stopPassengerStats(stopId: string): StopPassengerStats {
    const queue = this.queues.get(stopId) ?? [];
    const waitingCount = queue.length;
    const averageWaitSeconds = waitingCount
      ? queue.reduce((total, passenger) => total + Math.max(0, this.timeSeconds - passenger.arrivedAtSeconds), 0) / waitingCount
      : 0;
    const lineIds = this.network.definition.lines.filter((line) => line.stopIds.includes(stopId)).map((line) => line.id).sort();
    const denied = this.deniedByStop.get(stopId) ?? 0;
    return {
      stopId,
      waitingCount,
      averageWaitSeconds,
      recentBoardings: this.recentBoardingsByStop.get(stopId) ?? 0,
      deniedBoardingsNearby: denied,
      lineIds,
      capacityPressure: denied > 0 || waitingCount >= 20,
    };
  }

  public snapshot(): OperationsSnapshot { return { simulationSeconds: this.timeSeconds, vehicles: this.vehicles, queues: Object.fromEntries(this.queues), statistics: this.stats, warnings: this.warnings }; }
  public isIdle(): boolean {
    if (this.vehicles.some((vehicle) => this.countsAgainstFleet(vehicle))) return false;
    if (this.pendingArrivals.length) return false;
    for (const queue of this.queues.values()) if (queue.length) return false;
    return true;
  }
  public serializeServices(): readonly LineServiceConfiguration[] { return this.listConfigurations(); }
}
