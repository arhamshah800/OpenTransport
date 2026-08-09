import { distanceMeters } from '../map';
import { modeRegistry } from '../modes';
import type { LineServiceConfiguration } from '../operations';
import { TransitGraph, type TransitNetwork } from '../transit';
import type { Coordinate } from '../world';
import type { JourneyLeg, JourneyPlannerOptions, JourneyResult } from './types';

const DEFAULT_ACCESS_METERS = 800;
const DEFAULT_WALK_MPS = 1.35;
const DEFAULT_TRANSFER_PENALTY = 240;
const DEFAULT_MAX_TRANSFERS = 2;

interface RideConnection {
  readonly fromStopId: string;
  readonly toStopId: string;
  readonly lineId: string;
  readonly rideSeconds: number;
  readonly waitSeconds: number;
}

interface SearchNode {
  readonly stopId: string;
  readonly transfers: number;
  readonly cost: number;
  readonly via?: { readonly previousStopId: string; readonly lineId: string | null; readonly waitSeconds: number; readonly rideSeconds: number };
}

const walkSeconds = (meters: number, speed: number): number => (speed <= 0 ? Number.POSITIVE_INFINITY : meters / speed);

const headwayMinutesFor = (config: LineServiceConfiguration, hour: number): number => {
  const { frequency } = config;
  return hour >= frequency.daytimeStartHour && hour < frequency.nighttimeStartHour
    ? frequency.daytimeHeadwayMinutes
    : frequency.nighttimeHeadwayMinutes;
};

const segmentRideSeconds = (network: TransitNetwork, lineId: string, fromStopId: string, toStopId: string): number | null => {
  const line = network.getLine(lineId);
  if (!line) return null;
  const fromIndex = line.stopIds.indexOf(fromStopId);
  const toIndex = line.stopIds.indexOf(toStopId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  const lo = Math.min(fromIndex, toIndex);
  const hi = Math.max(fromIndex, toIndex);
  const mode = modeRegistry.getModeDefinition(line.mode);
  const speed = mode.operations.defaultCruisingSpeedKph * 1000 / 3600;
  let meters = 0;
  for (let index = lo; index < hi; index += 1) {
    const segment = line.segments[index];
    if (!segment) return null;
    meters += segment.geometry.slice(1).reduce((total, point, pointIndex) => total + distanceMeters(segment.geometry[pointIndex], point), 0);
  }
  const dwell = (hi - lo) * mode.operations.defaultDwellSeconds;
  return (speed <= 0 ? Number.POSITIVE_INFINITY : meters / speed) + dwell;
};

/** Build direct ride connections on active lines (forward, plus reverse for bidirectional). */
const buildRideConnections = (
  network: TransitNetwork,
  services: readonly LineServiceConfiguration[],
  hourOfDay: number,
): readonly RideConnection[] => {
  const serviceByLine = new Map(services.map((item) => [item.lineId, item]));
  const connections: RideConnection[] = [];
  for (const line of network.definition.lines) {
    const config = serviceByLine.get(line.id);
    if (!line.active || !config?.active) continue;
    const waitSeconds = Math.max(30, (headwayMinutesFor(config, hourOfDay) * 60) / 2);
    for (let from = 0; from < line.stopIds.length - 1; from += 1) {
      for (let to = from + 1; to < line.stopIds.length; to += 1) {
        const rideSeconds = segmentRideSeconds(network, line.id, line.stopIds[from], line.stopIds[to]);
        if (rideSeconds == null || !Number.isFinite(rideSeconds)) continue;
        connections.push({
          fromStopId: line.stopIds[from],
          toStopId: line.stopIds[to],
          lineId: line.id,
          rideSeconds,
          waitSeconds,
        });
      }
    }
    if (line.direction !== 'bidirectional') continue;
    for (let from = line.stopIds.length - 1; from > 0; from -= 1) {
      for (let to = from - 1; to >= 0; to -= 1) {
        const rideSeconds = segmentRideSeconds(network, line.id, line.stopIds[from], line.stopIds[to]);
        if (rideSeconds == null || !Number.isFinite(rideSeconds)) continue;
        connections.push({
          fromStopId: line.stopIds[from],
          toStopId: line.stopIds[to],
          lineId: line.id,
          rideSeconds,
          waitSeconds,
        });
      }
    }
  }
  return connections;
};

const nearestStops = (network: TransitNetwork, coordinate: Coordinate, radiusMeters: number): readonly { readonly stopId: string; readonly walkMeters: number }[] =>
  network.definition.stops
    .map((stop) => ({ stopId: stop.id, walkMeters: distanceMeters(coordinate, stop.coordinate) }))
    .filter((item) => item.walkMeters <= radiusMeters)
    .sort((a, b) => a.walkMeters - b.walkMeters || a.stopId.localeCompare(b.stopId));

const reconstructLegs = (
  cameFrom: Map<string, { readonly previousKey: string; readonly previousStopId: string; readonly lineId: string | null }>,
  endKey: string,
  endStopId: string,
): readonly JourneyLeg[] => {
  const hops: { readonly fromStopId: string; readonly toStopId: string; readonly lineId: string }[] = [];
  let key = endKey;
  let stopId = endStopId;
  const guard = new Set<string>();
  while (cameFrom.has(key) && !guard.has(key)) {
    guard.add(key);
    const via = cameFrom.get(key)!;
    if (via.lineId) hops.push({ fromStopId: via.previousStopId, toStopId: stopId, lineId: via.lineId });
    key = via.previousKey;
    stopId = via.previousStopId;
  }
  hops.reverse();
  if (!hops.length) return [];
  const legs: JourneyLeg[] = [];
  let boardStopId = hops[0].fromStopId;
  let lineId = hops[0].lineId;
  let alightStopId = hops[0].toStopId;
  for (let index = 1; index < hops.length; index += 1) {
    const hop = hops[index];
    if (hop.lineId === lineId && hop.fromStopId === alightStopId) {
      alightStopId = hop.toStopId;
      continue;
    }
    legs.push({ lineId, boardStopId, alightStopId });
    boardStopId = hop.fromStopId;
    lineId = hop.lineId;
    alightStopId = hop.toStopId;
  }
  legs.push({ lineId, boardStopId, alightStopId });
  return legs;
};

/**
 * Deterministic generalized-cost journey planner.
 * Uses walk access/egress, expected half-headway waits, in-vehicle time, transfer walks, and a flat transfer penalty.
 * Only connected transfer edges from TransitGraph are used — disconnected stop pairs never invent transfers.
 */
export function planJourney(
  origin: Coordinate,
  destination: Coordinate,
  network: TransitNetwork,
  services: readonly LineServiceConfiguration[],
  options: JourneyPlannerOptions = {},
): JourneyResult {
  const maxAccess = options.maxAccessWalkMeters ?? DEFAULT_ACCESS_METERS;
  const maxEgress = options.maxEgressWalkMeters ?? DEFAULT_ACCESS_METERS;
  const walkSpeed = options.walkSpeedMetersPerSecond ?? DEFAULT_WALK_MPS;
  const transferPenalty = options.transferPenaltySeconds ?? DEFAULT_TRANSFER_PENALTY;
  const maxTransfers = options.maxTransfers ?? DEFAULT_MAX_TRANSFERS;
  const hour = options.hourOfDay ?? 8;

  const access = nearestStops(network, origin, maxAccess);
  const egress = nearestStops(network, destination, maxEgress);
  if (!access.length || !egress.length) {
    return { status: 'unserved', origin, destination, reason: 'No transit stop within walking distance.' };
  }

  const rides = buildRideConnections(network, services, hour);
  if (!rides.length) {
    return { status: 'unserved', origin, destination, reason: 'No active transit service.' };
  }

  const ridesByFrom = new Map<string, RideConnection[]>();
  for (const ride of rides) {
    const list = ridesByFrom.get(ride.fromStopId) ?? [];
    list.push(ride);
    ridesByFrom.set(ride.fromStopId, list);
  }

  const graph = new TransitGraph(network);
  const transfersByFrom = new Map<string, { readonly toStopId: string; readonly meters: number }[]>();
  for (const stop of network.definition.stops) {
    const edges = graph.transfers(stop.id).map((edge) => ({ toStopId: edge.toStopId, meters: edge.distanceMeters }));
    if (edges.length) transfersByFrom.set(stop.id, edges);
  }

  const egressSet = new Map(egress.map((item) => [item.stopId, item.walkMeters]));
  const keyOf = (stopId: string, transfers: number, lineId: string | null): string => `${stopId}|${transfers}|${lineId ?? '-'}`;

  const best = new Map<string, number>();
  const cameFrom = new Map<string, { readonly previousKey: string; readonly previousStopId: string; readonly lineId: string | null }>();
  const queue: SearchNode[] = [];

  for (const item of access) {
    const node: SearchNode = { stopId: item.stopId, transfers: 0, cost: walkSeconds(item.walkMeters, walkSpeed) };
    queue.push(node);
    best.set(keyOf(item.stopId, 0, null), node.cost);
  }

  let bestArrival: { readonly stopId: string; readonly key: string; readonly cost: number; readonly egressWalk: number } | undefined;

  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost || a.stopId.localeCompare(b.stopId) || a.transfers - b.transfers);
    const current = queue.shift()!;
    const currentLineId = current.via?.lineId ?? null;
    const currentKey = keyOf(current.stopId, current.transfers, currentLineId);
    if ((best.get(currentKey) ?? Number.POSITIVE_INFINITY) < current.cost) continue;

    const egressWalk = egressSet.get(current.stopId);
    if (egressWalk != null && currentLineId) {
      const total = current.cost + walkSeconds(egressWalk, walkSpeed);
      if (!bestArrival || total < bestArrival.cost || (total === bestArrival.cost && current.stopId.localeCompare(bestArrival.stopId) < 0)) {
        bestArrival = { stopId: current.stopId, key: currentKey, cost: total, egressWalk };
      }
    }

    for (const ride of ridesByFrom.get(current.stopId) ?? []) {
      const changingLine = Boolean(currentLineId && currentLineId !== ride.lineId);
      const nextTransfers = changingLine ? current.transfers + 1 : current.transfers;
      if (nextTransfers > maxTransfers) continue;
      const boardWait = currentLineId === ride.lineId ? 0 : ride.waitSeconds;
      const nextCost = current.cost + boardWait + ride.rideSeconds + (changingLine ? transferPenalty : 0);
      const nextKey = keyOf(ride.toStopId, nextTransfers, ride.lineId);
      if (nextCost >= (best.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(nextKey, nextCost);
      cameFrom.set(nextKey, { previousKey: currentKey, previousStopId: current.stopId, lineId: ride.lineId });
      queue.push({
        stopId: ride.toStopId,
        transfers: nextTransfers,
        cost: nextCost,
        via: { previousStopId: current.stopId, lineId: ride.lineId, waitSeconds: boardWait, rideSeconds: ride.rideSeconds },
      });
    }

    for (const transfer of transfersByFrom.get(current.stopId) ?? []) {
      const nextCost = current.cost + walkSeconds(transfer.meters, walkSpeed);
      const nextKey = keyOf(transfer.toStopId, current.transfers, null);
      if (nextCost >= (best.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      best.set(nextKey, nextCost);
      cameFrom.set(nextKey, { previousKey: currentKey, previousStopId: current.stopId, lineId: null });
      queue.push({
        stopId: transfer.toStopId,
        transfers: current.transfers,
        cost: nextCost,
        via: { previousStopId: current.stopId, lineId: null, waitSeconds: 0, rideSeconds: walkSeconds(transfer.meters, walkSpeed) },
      });
    }
  }

  if (!bestArrival) {
    return { status: 'unserved', origin, destination, reason: 'No connected transit path between origin and destination.' };
  }

  const legs = reconstructLegs(cameFrom, bestArrival.key, bestArrival.stopId);
  if (!legs.length) {
    return { status: 'unserved', origin, destination, reason: 'No connected transit path between origin and destination.' };
  }

  const accessWalk = access.find((item) => item.stopId === legs[0].boardStopId)?.walkMeters
    ?? distanceMeters(origin, network.getStop(legs[0].boardStopId)!.coordinate);
  const expectedWaitSeconds = legs.reduce((total, leg, index) => {
    const config = services.find((item) => item.lineId === leg.lineId);
    if (!config) return total;
    return total + (index === 0 || legs[index - 1].lineId !== leg.lineId ? Math.max(30, (headwayMinutesFor(config, hour) * 60) / 2) : 0);
  }, 0);
  const inVehicleSeconds = legs.reduce((total, leg) => total + (segmentRideSeconds(network, leg.lineId, leg.boardStopId, leg.alightStopId) ?? 0), 0);

  return {
    status: 'planned',
    origin,
    destination,
    accessWalkMeters: accessWalk,
    egressWalkMeters: bestArrival.egressWalk,
    legs,
    transferCount: Math.max(0, legs.length - 1),
    generalizedCostSeconds: bestArrival.cost,
    expectedWaitSeconds,
    inVehicleSeconds,
  };
}

export const journeyWalkSeconds = (meters: number, speedMetersPerSecond = DEFAULT_WALK_MPS): number => walkSeconds(meters, speedMetersPerSecond);
