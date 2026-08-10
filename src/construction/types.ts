import type { Coordinate } from '../world';
import type { ModeId } from '../modes';

/** Elevations are meters relative to street level: surface is 0 and underground values are negative. */
export interface VerticalProfile { readonly startElevationMeters: number; readonly endElevationMeters: number; }
export interface EngineeringSegment { readonly id: string; readonly mode: ModeId; readonly geometry: readonly Coordinate[]; readonly verticalProfile?: VerticalProfile; }
export interface StationFootprint { readonly id?: string; readonly center: Coordinate; readonly widthMeters: number; readonly lengthMeters: number; readonly rotationDegrees?: number; }
export type ConstructionProposal =
  | { readonly kind: 'station'; readonly id: string; readonly mode: 'SUBWAY'; readonly footprint: StationFootprint; readonly elevationMeters: number; }
  | { readonly kind: 'alignment'; readonly id: string; readonly mode: ModeId; readonly geometry: readonly Coordinate[]; readonly verticalProfile?: VerticalProfile; };
export interface DemolitionImpact { readonly buildingId: string; readonly cost: number; }
export interface ConstructionIssue { readonly code: 'INVALID_GEOMETRY' | 'EXCESSIVE_GRADE' | 'INSUFFICIENT_TUNNEL_CLEARANCE' | 'INSUFFICIENT_RIVER_DEPTH' | 'BUS_OFF_ROAD' | 'STATION_IN_WATER'; readonly message: string; readonly severity: 'error' | 'warning'; }
export interface CostBreakdown { readonly baseInfrastructure: number; readonly depthSurcharge: number; readonly riverEngineering: number; readonly demolition: number; readonly total: number; }
export interface ConstructionEstimate { readonly demolitionImpacts: readonly DemolitionImpact[]; readonly riverCrossingIds: readonly string[]; readonly horizontalLengthMeters: number; readonly cost: CostBreakdown; }
export interface ValidatedConstructionPlan { readonly proposal: ConstructionProposal; readonly estimate: ConstructionEstimate; readonly infrastructure: EngineeringSegment | StationFootprint; readonly demolishedBuildingIds: readonly string[]; }
export interface ConstructionEvaluation { readonly valid: boolean; readonly issues: readonly ConstructionIssue[]; readonly estimate: ConstructionEstimate; readonly plan?: ValidatedConstructionPlan; }
export interface ConstructionState { readonly demolishedBuildingIds: readonly string[]; readonly engineeringSegments: readonly EngineeringSegment[]; readonly stations: readonly StationFootprint[]; }
export interface EngineeringConfiguration {
  readonly subwayTunnelCostPerMeter: number; readonly tramGuidewayCostPerMeter: number; readonly subwayStationBaseCost: number; readonly depthCostPerMeter: number; readonly maxSubwayGrade: number; readonly minimumTunnelClearanceMeters: number; readonly riverMinimumElevationMeters: number; readonly riverCrossingSurcharge: number; readonly stationWidthMeters: number; readonly stationLengthMeters: number; readonly busRoadSnapToleranceMeters: number;
}
