import type { World } from '../world';
import type { DemandOverlay, MapLayerVisibility, MapSelection, TransitOverlay } from './types';

/** Local-data underlay that keeps geography visible if WebGL fails to paint. */
export function LocalMapFallback({
  world,
  visibility,
  transit,
  onSelect,
  interactive = false,
  demand,
}: {
  readonly world: World;
  readonly visibility: MapLayerVisibility;
  readonly transit: TransitOverlay;
  readonly onSelect: (selection: Exclude<MapSelection, null>) => void;
  readonly interactive?: boolean;
  readonly demand?: DemandOverlay;
}) {
  const { southWest, northEast } = world.definition.bounds;
  const x = (longitude: number): number => (longitude - southWest.longitude) / (northEast.longitude - southWest.longitude) * 1000;
  const y = (latitude: number): number => (northEast.latitude - latitude) / (northEast.latitude - southWest.latitude) * 1000;
  const points = (geometry: readonly { readonly latitude: number; readonly longitude: number }[]): string => geometry.map((point) => `${x(point.longitude)},${y(point.latitude)}`).join(' ');
  const pick = interactive
    ? (selection: Exclude<MapSelection, null>) => onSelect(selection)
    : () => undefined;
  return (
    <svg className={`local-map-fallback ${interactive ? 'interactive' : 'passive'}`} viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {world.definition.waterways.map((water) => visibility.water && <polyline key={water.id} points={points(water.geometry)} className="fallback-water" />)}
      {visibility.buildings && world.definition.buildings.map((building) => (
        <polygon key={building.id} points={points(building.footprint)} className={`fallback-building ${interactive ? 'fallback-selectable' : ''}`} onClick={() => pick({ kind: 'building', id: building.id })} />
      ))}
      {world.definition.roads.map((road) => (
        <g key={road.id}>
          <polyline points={points(road.geometry)} className={`fallback-road ${road.classification}`} />
          {interactive && <polyline points={points(road.geometry)} className="fallback-road-hit" onClick={() => pick({ kind: 'road', id: road.id })} />}
        </g>
      ))}
      {visibility.population !== 'hidden' && world.definition.population.map((record) => (
        <circle key={record.id} cx={x(record.coordinate.longitude)} cy={y(record.coordinate.latitude)} r={visibility.population === 'density' ? 18 : 6} className={`fallback-population ${visibility.population}`} />
      ))}
      {visibility.workplaces && world.definition.workplaces.map((workplace) => (
        <circle key={workplace.id} cx={x(workplace.coordinate.longitude)} cy={y(workplace.coordinate.latitude)} r="8" className={`fallback-workplace ${interactive ? 'fallback-selectable' : ''}`} onClick={() => pick({ kind: 'workplace', id: workplace.id })} />
      ))}
      {visibility.pois && [...world.definition.pointsOfInterest, ...world.definition.landmarks].map((place) => (
        <circle key={place.id} cx={x(place.coordinate.longitude)} cy={y(place.coordinate.latitude)} r="7" className={`fallback-poi ${interactive ? 'fallback-selectable' : ''}`} onClick={() => pick({ kind: 'poi', id: place.id })} />
      ))}
      {transit.lines.map((line) => (
        <polyline key={line.id} points={points(line.geometry)} className={`fallback-transit-line ${interactive ? 'fallback-selectable' : ''}`} style={{ stroke: line.color ?? '#ef6c45' }} onClick={() => pick({ kind: 'line', id: line.id })} />
      ))}
      {transit.stops.map((stop) => (
        <circle key={stop.id} cx={x(stop.coordinate.longitude)} cy={y(stop.coordinate.latitude)} r="8" className={`fallback-transit-stop ${interactive ? 'fallback-selectable' : ''}`} onClick={() => pick({ kind: 'station', id: stop.id })} />
      ))}
      {(transit.vehicles ?? []).map((vehicle) => {
        const cx = x(vehicle.coordinate.longitude); const cy = y(vehicle.coordinate.latitude);
        const fill = vehicle.color ?? '#17211e';
        const common = { className: `fallback-transit-vehicle ${interactive ? 'fallback-selectable' : ''}`, style: { fill }, onClick: () => pick({ kind: 'vehicle', id: vehicle.id }) };
        if (vehicle.modeId === 'SUBWAY') return <rect key={vehicle.id} x={cx - 9} y={cy - 7} width="18" height="14" rx="2" {...common} />;
        if (vehicle.modeId === 'TRAM') return <polygon key={vehicle.id} points={`${cx},${cy - 10} ${cx + 9},${cy} ${cx},${cy + 10} ${cx - 9},${cy}`} {...common} />;
        return <circle key={vehicle.id} cx={cx} cy={cy} r="9" {...common} />;
      })}
      {demand && visibility.tripDemand && demand.activeOrigins.map((point) => (
        <circle key={point.id} cx={x(point.coordinate.longitude)} cy={y(point.coordinate.latitude)} r={Math.min(28, 6 + point.weight / 4)} className="fallback-demand-active" />
      ))}
      {demand && visibility.unservedDemand && demand.unservedOrigins.map((point) => (
        <circle key={point.id} cx={x(point.coordinate.longitude)} cy={y(point.coordinate.latitude)} r={Math.min(28, 6 + point.weight / 4)} className="fallback-demand-unserved" />
      ))}
    </svg>
  );
}
