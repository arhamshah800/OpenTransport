import type { EngineeringConfiguration } from './types';

/** Prototype balancing inputs, deliberately centralized; these are not real-world cost claims. */
export const defaultEngineeringConfiguration: EngineeringConfiguration = {
  subwayTunnelCostPerMeter: 85_000, tramGuidewayCostPerMeter: 24_000, subwayStationBaseCost: 7_500_000,
  depthCostPerMeter: 18_000, maxSubwayGrade: 0.04, minimumTunnelClearanceMeters: 6,
  riverMinimumElevationMeters: -24, riverCrossingSurcharge: 3_000_000, stationWidthMeters: 28,
  stationLengthMeters: 140, busRoadSnapToleranceMeters: 45,
};
