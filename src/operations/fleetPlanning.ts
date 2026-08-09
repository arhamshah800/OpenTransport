import { distanceMeters } from '../map';
import { modeRegistry } from '../modes';
import type { TransitNetwork } from '../transit';

/** One-way trip time used for fleet planning. Reverse/layover loops are not simulated yet. */
export function estimateOneWayTripSeconds(network: TransitNetwork, lineId: string, vehicleTypeId: string): number {
  const line = network.getLine(lineId);
  if (!line) throw new Error(`Unknown line "${lineId}"`);
  const vehicle = modeRegistry.getVehicleDefinition(vehicleTypeId);
  const mode = modeRegistry.getModeDefinition(line.mode);
  const speedMetersPerSecond = vehicle.maximumSpeedKph * 1000 / 3600;
  let travelSeconds = 0;
  for (const segment of line.segments) {
    const length = segment.geometry.slice(1).reduce((total, point, index) => total + distanceMeters(segment.geometry[index], point), 0);
    travelSeconds += speedMetersPerSecond <= 0 ? 0 : length / speedMetersPerSecond;
  }
  const dwellSeconds = line.stopIds.length * mode.operations.defaultDwellSeconds * vehicle.dwellTimeModifier;
  return travelSeconds + dwellSeconds;
}

/** Headway the assigned fleet can sustain if vehicles reused the line (planning estimate). */
export function estimateSupportedHeadwayMinutes(network: TransitNetwork, lineId: string, vehicleTypeId: string, assignedVehicleCount: number): number {
  const line = network.getLine(lineId);
  if (!line) throw new Error(`Unknown line "${lineId}"`);
  const minimum = modeRegistry.getModeDefinition(line.mode).operations.minimumHeadwayMinutes;
  if (assignedVehicleCount <= 0) return Number.POSITIVE_INFINITY;
  const cycleMinutes = estimateOneWayTripSeconds(network, lineId, vehicleTypeId) / 60;
  return Math.max(minimum, Math.ceil(cycleMinutes / assignedVehicleCount));
}

/** Fleet size needed to meet a requested headway (planning estimate; assumes recirculation). */
export function estimateRequiredVehicles(network: TransitNetwork, lineId: string, vehicleTypeId: string, headwayMinutes: number): number {
  if (!Number.isFinite(headwayMinutes) || headwayMinutes <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.ceil((estimateOneWayTripSeconds(network, lineId, vehicleTypeId) / 60) / headwayMinutes));
}

export function formatHeadwayLabel(minutes: number): string {
  if (!Number.isFinite(minutes)) return 'No service';
  if (minutes === 1) return 'Every 1 minute';
  return `Every ${minutes} minutes`;
}
