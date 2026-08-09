import type { Coordinate } from '../world';
import type { ServiceFrequency } from '../modes';
import type { JourneyLeg } from '../journey';

export interface LineServiceConfiguration { readonly lineId: string; readonly active: boolean; readonly vehicleTypeId: string; readonly assignedVehicleCount: number; readonly frequency: ServiceFrequency; }

/** Runtime passenger waiting at a stop or riding a vehicle for the current leg. */
export interface WaitingPassenger {
  readonly id: string;
  readonly destinationStopId: string;
  readonly arrivedAtSeconds: number;
  /** Remaining journey legs after the current alight (board → alight on subsequent lines). */
  readonly remainingLegs?: readonly JourneyLeg[];
  readonly farePaid: boolean;
}

export interface VehicleRuntime { readonly id: string; readonly lineId: string; readonly vehicleTypeId: string; readonly state: 'DWELLING' | 'TRAVELING'; readonly stopIndex: number; readonly segmentProgressMeters: number; readonly dwellRemainingSeconds: number; readonly passengers: readonly WaitingPassenger[]; readonly coordinate: Coordinate; }
export interface FareChargedEvent { readonly type: 'FARE_CHARGED'; readonly lineId: string; readonly vehicleId: string; readonly passengerId: string; readonly amountCents: number; readonly timestampSeconds: number; }
export interface VehicleOperatingCostEvent { readonly type: 'VEHICLE_OPERATING_COST'; readonly lineId: string; readonly vehicleId: string; readonly amountCents: number; readonly timestampSeconds: number; }
export type OperationsEvent = FareChargedEvent | VehicleOperatingCostEvent;
export interface OperationsStatistics { readonly boardings: number; readonly alightings: number; readonly deniedBoardings: number; readonly unservedDemand: number; readonly totalWaitSeconds: number; readonly maximumWaitSeconds: number; readonly operatingVehicleSeconds: number; readonly completedTrips: number; readonly byLine: Readonly<Record<string, { readonly boardings: number; readonly alightings: number }>>; }
export interface OperationsSnapshot { readonly simulationSeconds: number; readonly vehicles: readonly VehicleRuntime[]; readonly queues: Readonly<Record<string, readonly WaitingPassenger[]>>; readonly statistics: OperationsStatistics; readonly warnings: readonly string[]; }
export interface StopPassengerStats {
  readonly stopId: string;
  readonly waitingCount: number;
  readonly averageWaitSeconds: number;
  readonly recentBoardings: number;
  readonly deniedBoardingsNearby: number;
  readonly lineIds: readonly string[];
  readonly capacityPressure: boolean;
}
