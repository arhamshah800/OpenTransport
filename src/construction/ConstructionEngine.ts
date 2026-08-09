import { distanceMeters, nearestPointOnPolyline, pointInPolygon, segmentsIntersect } from '../map';
import type { World, Coordinate } from '../world';
import type { EngineeringConfiguration, ConstructionEvaluation, ConstructionIssue, ConstructionProposal, ConstructionState, EngineeringSegment, ConstructionEstimate, StationFootprint } from './types';
import { defaultEngineeringConfiguration } from './config';
import { modeRegistry } from '../modes';

const emptyState = (): ConstructionState => ({ demolishedBuildingIds: [], engineeringSegments: [], stations: [] });
const polylineLength = (line: readonly Coordinate[]): number => line.slice(1).reduce((total, point, index) => total + distanceMeters(line[index], point), 0);
export const stationFootprintPolygon = (footprint: StationFootprint): Coordinate[] => {
  const latScale = 1 / 111_111; const lonScale = 1 / (111_111 * Math.cos(footprint.center.latitude * Math.PI / 180));
  const halfLat = footprint.lengthMeters * latScale / 2; const halfLon = footprint.widthMeters * lonScale / 2;
  return [{ latitude: footprint.center.latitude - halfLat, longitude: footprint.center.longitude - halfLon }, { latitude: footprint.center.latitude - halfLat, longitude: footprint.center.longitude + halfLon }, { latitude: footprint.center.latitude + halfLat, longitude: footprint.center.longitude + halfLon }, { latitude: footprint.center.latitude + halfLat, longitude: footprint.center.longitude - halfLon }];
};
const polygonsIntersect = (first: readonly Coordinate[], second: readonly Coordinate[]): boolean => first.some((point) => pointInPolygon(point, second)) || second.some((point) => pointInPolygon(point, first)) || first.some((a, index) => second.some((b, otherIndex) => segmentsIntersect(a, first[(index + 1) % first.length], b, second[(otherIndex + 1) % second.length])));
const linesIntersect = (first: readonly Coordinate[], second: readonly Coordinate[]): boolean => first.slice(1).some((point, index) => second.slice(1).some((other, otherIndex) => segmentsIntersect(first[index], point, second[otherIndex], other)));

/** Pure proposal evaluator. It never mutates the immutable level or player network. */
export class ConstructionEngine {
  public constructor(private readonly world: World, private readonly configuration: EngineeringConfiguration = defaultEngineeringConfiguration) {}
  public evaluate(proposal: ConstructionProposal, state: ConstructionState = emptyState()): ConstructionEvaluation {
    const issues: ConstructionIssue[] = []; if (proposal.kind === 'alignment') modeRegistry.getModeDefinition(proposal.mode); const geometry = proposal.kind === 'alignment' ? proposal.geometry : stationFootprintPolygon(proposal.footprint);
    const length = proposal.kind === 'alignment' ? polylineLength(geometry) : 0;
    if (proposal.kind === 'alignment' && geometry.length < 2) issues.push({ code: 'INVALID_GEOMETRY', severity: 'error', message: 'An alignment needs at least two coordinates.' });
    const demolitions = proposal.kind === 'station' ? this.world.definition.buildings.filter((building) => !state.demolishedBuildingIds.includes(building.id) && polygonsIntersect(geometry, building.footprint)).map((building) => ({ buildingId: building.id, cost: building.acquisitionValue })) : [];
    const riverCrossingIds = proposal.kind === 'alignment' && proposal.mode === 'SUBWAY' ? this.world.definition.waterways.filter((water) => linesIntersect(geometry, water.geometry)).map((water) => water.id) : [];
    let depthSurcharge = 0; let riverEngineering = 0;
    if (proposal.kind === 'station') depthSurcharge = Math.abs(proposal.elevationMeters) * this.configuration.depthCostPerMeter;
    if (proposal.kind === 'alignment' && proposal.mode === 'SUBWAY' && proposal.verticalProfile) {
      const profile = proposal.verticalProfile; const grade = length === 0 ? Infinity : Math.abs(profile.endElevationMeters - profile.startElevationMeters) / length;
      depthSurcharge = ((Math.abs(profile.startElevationMeters) + Math.abs(profile.endElevationMeters)) / 2) * length * this.configuration.depthCostPerMeter / 100;
      if (grade > this.configuration.maxSubwayGrade) issues.push({ code: 'EXCESSIVE_GRADE', severity: 'error', message: `Required grade ${(grade * 100).toFixed(1)}% exceeds maximum permitted ${(this.configuration.maxSubwayGrade * 100).toFixed(1)}%.` });
      if (riverCrossingIds.length > 0 && Math.max(profile.startElevationMeters, profile.endElevationMeters) > this.configuration.riverMinimumElevationMeters) issues.push({ code: 'INSUFFICIENT_RIVER_DEPTH', severity: 'error', message: `River crossings require an elevation of ${this.configuration.riverMinimumElevationMeters}m or below.` });
      riverEngineering = riverCrossingIds.length * this.configuration.riverCrossingSurcharge;
      for (const existing of state.engineeringSegments.filter((segment) => segment.mode === 'SUBWAY' && segment.verticalProfile)) if (linesIntersect(geometry, existing.geometry)) { const existingElevation = (existing.verticalProfile!.startElevationMeters + existing.verticalProfile!.endElevationMeters) / 2; const proposedElevation = (profile.startElevationMeters + profile.endElevationMeters) / 2; if (Math.abs(existingElevation - proposedElevation) < this.configuration.minimumTunnelClearanceMeters) issues.push({ code: 'INSUFFICIENT_TUNNEL_CLEARANCE', severity: 'error', message: `Tunnel crossing has ${Math.abs(existingElevation - proposedElevation).toFixed(1)}m clearance; ${this.configuration.minimumTunnelClearanceMeters}m is required.` }); }
    }
    if (proposal.kind === 'alignment' && proposal.mode === 'BUS') for (const point of geometry) { const closest = Math.min(...this.world.definition.roads.map((road) => nearestPointOnPolyline(point, road.geometry).distanceMeters)); if (closest > this.configuration.busRoadSnapToleranceMeters) { issues.push({ code: 'BUS_OFF_ROAD', severity: 'error', message: `Bus alignment is ${closest.toFixed(0)}m from the nearest road; routes must follow roads.` }); break; } }
    const baseInfrastructure = proposal.kind === 'station' ? this.configuration.subwayStationBaseCost : proposal.mode === 'SUBWAY' ? length * this.configuration.subwayTunnelCostPerMeter : proposal.mode === 'TRAM' ? length * this.configuration.tramGuidewayCostPerMeter : 0;
    const demolition = demolitions.reduce((total, impact) => total + impact.cost, 0); const estimate: ConstructionEstimate = { demolitionImpacts: demolitions, riverCrossingIds, horizontalLengthMeters: length, cost: { baseInfrastructure, depthSurcharge, riverEngineering, demolition, total: baseInfrastructure + depthSurcharge + riverEngineering + demolition } };
    const valid = issues.every((issue) => issue.severity !== 'error'); const infrastructure: EngineeringSegment | StationFootprint = proposal.kind === 'station' ? proposal.footprint : { id: proposal.id, mode: proposal.mode, geometry: proposal.geometry, verticalProfile: proposal.verticalProfile };
    return { valid, issues, estimate, plan: valid ? { proposal, estimate, infrastructure, demolishedBuildingIds: demolitions.map((impact) => impact.buildingId) } : undefined };
  }
  public commit(plan: NonNullable<ConstructionEvaluation['plan']>, state: ConstructionState = emptyState()): ConstructionState {
    const stations = 'mode' in plan.infrastructure
      ? state.stations
      : [...state.stations, plan.proposal.kind === 'station' ? { ...plan.infrastructure, id: plan.proposal.id } : plan.infrastructure];
    return {
      demolishedBuildingIds: [...new Set([...state.demolishedBuildingIds, ...plan.demolishedBuildingIds])],
      engineeringSegments: 'mode' in plan.infrastructure ? [...state.engineeringSegments, plan.infrastructure] : state.engineeringSegments,
      stations,
    };
  }
}
