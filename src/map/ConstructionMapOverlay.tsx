import { stationFootprintPolygon, type ConstructionWorkflowSnapshot } from '../construction';
import type { World } from '../world';

export function ConstructionMapOverlay({ world, overlay }: { readonly world: World; readonly overlay: ConstructionWorkflowSnapshot }) {
  const { southWest, northEast } = world.definition.bounds;
  const x = (longitude: number): number => (longitude - southWest.longitude) / (northEast.longitude - southWest.longitude) * 1000;
  const y = (latitude: number): number => (northEast.latitude - latitude) / (northEast.latitude - southWest.latitude) * 1000;
  const points = (geometry: readonly { readonly latitude: number; readonly longitude: number }[]): string => geometry.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(' ');
  const pending = overlay.pending;
  const valid = Boolean(pending?.evaluation.valid && pending.affordable);
  const riverIds = new Set(pending?.evaluation.estimate.riverCrossingIds ?? []);
  return <svg className="construction-map-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {overlay.state.demolishedBuildingIds.map((id) => {
      const building = world.definition.buildings.find((item) => item.id === id);
      return building ? <polygon key={id} points={points(building.footprint)} className="committed-demolition" /> : null;
    })}
    {overlay.state.engineeringSegments.map((segment) => <polyline key={segment.id} points={points(segment.geometry)} className={`committed-engineering ${segment.mode.toLowerCase()}`} />)}
    {overlay.state.stations.map((station, index) => <polygon key={index} points={points(stationFootprintPolygon(station))} className="committed-station" />)}
    {pending?.evaluation.estimate.demolitionImpacts.map((impact) => {
      const building = world.definition.buildings.find((item) => item.id === impact.buildingId);
      return building ? <polygon key={impact.buildingId} points={points(building.footprint)} className="pending-demolition" /> : null;
    })}
    {[...riverIds].map((id) => {
      const waterway = world.definition.waterways.find((item) => item.id === id);
      return waterway ? <polyline key={`river-${id}`} points={points(waterway.geometry)} className="pending-river-crossing" /> : null;
    })}
    {pending?.proposal.kind === 'station' && <polygon points={points(stationFootprintPolygon(pending.proposal.footprint))} className={`pending-construction ${valid ? 'valid' : 'invalid'}`} />}
    {pending?.proposal.kind === 'alignment' && <polyline points={points(pending.proposal.geometry)} className={`pending-alignment ${valid ? 'valid' : 'invalid'}${riverIds.size ? ' river' : ''}`} />}
  </svg>;
}
