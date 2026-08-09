import type { Coordinate } from '../world';

/** One ride between two stops on a single active line. */
export interface JourneyLeg {
  readonly lineId: string;
  readonly boardStopId: string;
  readonly alightStopId: string;
}

export interface JourneyPlan {
  readonly status: 'planned';
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  readonly accessWalkMeters: number;
  readonly egressWalkMeters: number;
  readonly legs: readonly JourneyLeg[];
  readonly transferCount: number;
  readonly generalizedCostSeconds: number;
  readonly expectedWaitSeconds: number;
  readonly inVehicleSeconds: number;
}

export interface UnservedJourney {
  readonly status: 'unserved';
  readonly origin: Coordinate;
  readonly destination: Coordinate;
  readonly reason: string;
}

export type JourneyResult = JourneyPlan | UnservedJourney;

export interface JourneyPlannerOptions {
  readonly maxAccessWalkMeters?: number;
  readonly maxEgressWalkMeters?: number;
  readonly walkSpeedMetersPerSecond?: number;
  readonly transferPenaltySeconds?: number;
  readonly maxTransfers?: number;
  readonly hourOfDay?: number;
}
