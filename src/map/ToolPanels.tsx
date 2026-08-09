import type { ReactNode } from 'react';
import type { World } from '../world';
import { modeRegistry, type ModeId } from '../modes';
import type { TransitNetwork } from '../transit';
import type { SimulationSnapshot } from '../time';
import { buildingEmployment, buildingPopulation } from './queries';
import type { MapDiagnostic, MapLayerVisibility, MapSelection, TransitOverlay } from './types';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function ModeSummary({ modeId, children }: { readonly modeId: ModeId; readonly children: ReactNode }) {
  const mode = modeRegistry.getModeDefinition(modeId); const vehicle = modeRegistry.getVehicleDefinitionsForMode(modeId)[0];
  const running = mode.infrastructure.constrainedToRoads ? 'Road-running' : mode.infrastructure.kind === 'underground-guideway' ? 'Underground guideway' : 'Dedicated guideway';
  return <section className="mode-workflow" style={{ '--mode-color': mode.color } as React.CSSProperties}><header><span className="mode-symbol">{mode.symbol}</span><div><p className="eyebrow">{mode.name.toUpperCase()}</p><h2>{vehicle.name}</h2></div></header><div className="mode-facts"><span><strong>{vehicle.capacity}</strong> riders</span><span>{running}</span><span>Default fare <strong>${(mode.operations.defaultFare.fareCents / 100).toFixed(2)}</strong></span></div><p className="mode-summary">{mode.summary}</p>{children}</section>;
}

export function NetworkOverview({ world, network, simulation, onNavigate }: { readonly world: World; readonly network: TransitNetwork; readonly simulation: SimulationSnapshot; readonly onNavigate: (panel: 'transit' | 'data' | 'finance') => void }) {
  return <section className="overview-panel"><p className="eyebrow">CITY OVERVIEW</p><h2>{world.definition.metadata.name}</h2><p className="context-intro">Inspect the city or choose a transport tool to begin building a network.</p><div className="overview-metrics"><div><span>Population represented</span><strong>{world.definition.metadata.approximatePopulation?.toLocaleString() ?? '—'}</strong></div><div><span>Active lines</span><strong>{network.definition.lines.filter((line) => line.active).length}</strong></div><div><span>Stops</span><strong>{network.definition.stops.length}</strong></div><div><span>Active trip requests</span><strong>{simulation.population.activeRequests}</strong></div></div><div className="context-actions"><button type="button" onClick={() => onNavigate('transit')}>Plan a line</button><button className="secondary" type="button" onClick={() => onNavigate('data')}>View transport data</button><button className="secondary" type="button" onClick={() => onNavigate('finance')}>Open finance</button></div></section>;
}

export function DataPanel({
  visibility,
  developerMode,
  population,
  operations,
  setPopulation,
  setToggle,
  emptyDemandHint = false,
  onReplan,
}: {
  readonly visibility: MapLayerVisibility;
  readonly developerMode: boolean;
  readonly population: SimulationSnapshot['population'];
  readonly operations?: SimulationSnapshot['operations'];
  readonly setPopulation: (mode: MapLayerVisibility['population']) => void;
  readonly setToggle: (key: keyof Omit<MapLayerVisibility, 'population'>, value: boolean) => void;
  readonly emptyDemandHint?: boolean;
  readonly onReplan?: () => void;
}) {
  const boardings = operations?.statistics.boardings ?? 0;
  const unserved = population.unservedTrips;
  const served = population.servedTrips;
  const coverage = boardings + unserved > 0 ? Math.round((boardings / (boardings + unserved)) * 100) : 0;
  return (
    <section className="layer-panel">
      <p className="eyebrow">TRANSPORT DATA</p>
      <h2>Understand the city</h2>
      <p className="context-intro">Use planning overlays to find residents, jobs, and trip demand against your network.</p>
      <div className="overview-metrics">
        <div><span>Traveling now</span><strong>{population.traveling}</strong></div>
        <div><span>Served trips</span><strong>{served}</strong></div>
        <div><span>Unserved trips</span><strong>{unserved}</strong></div>
        <div><span>Boardings</span><strong>{boardings}</strong></div>
      </div>
      <p className="context-intro">Approx. served share of resolved demand: <strong>{coverage}%</strong>. Avg wait {operations?.statistics.boardings ? Math.round(operations.statistics.totalWaitSeconds / operations.statistics.boardings) : 0}s.</p>
      {emptyDemandHint && <p className="debug-note" role="status">No active requests yet — resume simulation or wait for morning demand.</p>}
      <fieldset>
        <legend>Population</legend>
        <div className="segmented-control">{(['hidden', 'points', 'density'] as const).map((mode) => <label className={visibility.population === mode ? 'active' : ''} key={mode}><input type="radio" name="population" checked={visibility.population === mode} onChange={() => setPopulation(mode)} /><span>{mode === 'hidden' ? 'Off' : `${mode[0].toUpperCase()}${mode.slice(1)}`}</span></label>)}</div>
      </fieldset>
      <fieldset>
        <legend>Planning overlays</legend>
        <label><input type="checkbox" checked={visibility.workplaces} onChange={(event) => setToggle('workplaces', event.target.checked)} /><span>Jobs / Employment</span></label>
        <label><input type="checkbox" checked={visibility.tripDemand} onChange={(event) => setToggle('tripDemand', event.target.checked)} /><span>Active & served demand <small>{population.activeRequests} active requests</small></span></label>
        <label><input type="checkbox" checked={visibility.unservedDemand} onChange={(event) => setToggle('unservedDemand', event.target.checked)} /><span>Unserved demand <small>{unserved} trips</small></span></label>
        <label><input type="checkbox" checked={visibility.buildings} onChange={(event) => setToggle('buildings', event.target.checked)} /><span>Buildings</span></label>
        <label><input type="checkbox" checked={visibility.pois} onChange={(event) => setToggle('pois', event.target.checked)} /><span>Destinations</span></label>
        <label><input type="checkbox" checked={visibility.water} onChange={(event) => setToggle('water', event.target.checked)} /><span>Water</span></label>
      </fieldset>
      {developerMode && (
        <fieldset className="developer-layers">
          <legend>Developer overlays</legend>
          {(['roadIds', 'buildingIds', 'bounds'] as const).map((key) => <label key={key}><input type="checkbox" checked={visibility[key]} onChange={(event) => setToggle(key, event.target.checked)} /><span>{({ roadIds: 'Road IDs', buildingIds: 'Building IDs', bounds: 'Level bounds' } as const)[key]}</span></label>)}
          <p className="debug-note">Raw counts — requesting {population.requestingRoute}, at home {population.atHome}, at destination {population.atDestination}.</p>
          {onReplan && <button type="button" className="secondary" onClick={onReplan}>Replan pending demand</button>}
        </fieldset>
      )}
    </section>
  );
}

export function SettingsPanel({ developerMode, onDeveloperModeChange }: { readonly developerMode: boolean; readonly onDeveloperModeChange: (enabled: boolean) => void }) {
  return <section className="settings-panel"><p className="eyebrow">SETTINGS</p><h2>Game interface</h2><label className="settings-switch"><span><strong>Developer Mode</strong><small>Reveal diagnostics, manual time controls, raw IDs, and topology tools.</small></span><input type="checkbox" role="switch" checked={developerMode} onChange={(event) => onDeveloperModeChange(event.target.checked)} /></label><p className="settings-status">Developer Mode is <strong>{developerMode ? 'on' : 'off'}</strong>.</p><div className="shortcut-list"><p className="eyebrow">KEYBOARD SHORTCUTS</p><dl><dt>Escape</dt><dd>Cancel proposal, or return to Select</dd><dt>1</dt><dd>Bus</dd><dt>2</dt><dd>Tram</dd><dt>3</dt><dd>Subway</dd></dl></div></section>;
}

export function InspectorPanel({ world, selection, coordinate, network, transit, simulation, stopStats, developerMode = false, onOpenLine }: { readonly world: World; readonly selection: MapSelection; readonly coordinate: { readonly latitude: number; readonly longitude: number } | null; readonly network: TransitNetwork; readonly transit: TransitOverlay; readonly simulation: SimulationSnapshot; readonly stopStats?: import('../operations').StopPassengerStats; readonly developerMode?: boolean; readonly onOpenLine?: (lineId: string) => void }) {
  let heading = world.definition.metadata.name; let content: ReactNode = <><p className="context-intro">Use Select to inspect the city. Current network information is shown below.</p><div className="overview-metrics"><div><span>Population represented</span><strong>{world.definition.metadata.approximatePopulation?.toLocaleString() ?? '—'}</strong></div><div><span>Active lines</span><strong>{network.definition.lines.filter((line) => line.active).length}</strong></div><div><span>Stops</span><strong>{network.definition.stops.length}</strong></div><div><span>Active trip requests</span><strong>{simulation.population.activeRequests}</strong></div></div></>;
  if (selection?.kind === 'road') { const item = world.roadsById.get(selection.id); heading = item?.name ?? 'Unnamed road'; content = item && <dl><dt>Road name</dt><dd>{item.name ?? 'Unnamed'}</dd><dt>Road class</dt><dd>{item.classification}</dd><dt>Assumed speed</dt><dd>{item.speedKph ? `${item.speedKph} km/h` : 'Not specified'}</dd></dl>; }
  if (selection?.kind === 'building') { const item = world.buildingsById.get(selection.id); heading = item?.displayName ?? 'Building'; content = item && <dl><dt>Category</dt><dd>{item.category ?? 'Not specified'}</dd><dt>Residential population</dt><dd>{buildingPopulation(world, item.id).toLocaleString()}</dd><dt>Jobs</dt><dd>{buildingEmployment(world, item.id).toLocaleString()}</dd><dt>Acquisition / demolition cost</dt><dd>{currency.format(item.acquisitionValue)}</dd>{developerMode && <><dt>Building ID</dt><dd>{item.id}</dd></>}</dl>; }
  if (selection?.kind === 'workplace') { const item = world.workplacesById.get(selection.id); heading = item?.displayName ?? 'Workplace'; content = item && <dl><dt>Jobs</dt><dd>{item.jobs.toLocaleString()}</dd><dt>Building</dt><dd>{item.buildingId ?? 'None'}</dd></dl>; }
  if (selection?.kind === 'poi') { const item = world.pointsOfInterestById.get(selection.id); heading = item?.displayName ?? 'Landmark'; content = item ? <dl><dt>Category</dt><dd>{item.category}</dd><dt>Attraction weight</dt><dd>{item.attractionWeight ?? 'Not specified'}</dd><dt>Building</dt><dd>{item.buildingId ?? 'None'}</dd></dl> : <p>City landmark: {selection.id}</p>; }
  if (selection?.kind === 'station') {
    const item = network.getStop(selection.id);
    heading = item?.name ?? 'Station';
    const lineNames = (stopStats?.lineIds ?? []).map((id) => network.getLine(id)?.name ?? id).join(', ') || 'None';
    content = item && <>
      <dl>
        <dt>Type</dt><dd>{item.kind}</dd>
        <dt>Modes</dt><dd>{item.supportedModes.join(', ')}</dd>
        <dt>Lines serving</dt><dd>{lineNames}</dd>
        <dt>Passengers waiting</dt><dd>{stopStats?.waitingCount ?? 0}</dd>
        <dt>Average wait</dt><dd>{stopStats ? `${Math.round(stopStats.averageWaitSeconds)}s` : '—'}</dd>
        <dt>Recent boardings</dt><dd>{stopStats?.recentBoardings ?? 0}</dd>
        <dt>Capacity pressure</dt><dd>{stopStats?.capacityPressure ? 'Yes — vehicles leaving riders behind' : 'No'}</dd>
        {developerMode && <><dt>Station ID</dt><dd>{item.id}</dd></>}
      </dl>
      {(stopStats?.lineIds ?? []).slice(0, 1).map((lineId) => onOpenLine ? <button key={lineId} type="button" className="secondary" onClick={() => onOpenLine(lineId)}>Open line editor</button> : null)}
    </>;
  }
  if (selection?.kind === 'line') {
    const item = network.definition.lines.find((line) => line.id === selection.id || line.segments.some((segment) => segment.id === selection.id));
    heading = item?.name ?? 'Transit line';
    content = item && <>
      <dl><dt>Mode</dt><dd>{modeRegistry.getModeDefinition(item.mode).name}</dd><dt>Stops</dt><dd>{item.stopIds.length}</dd><dt>Status</dt><dd>{item.active ? 'Active' : 'Inactive'}</dd></dl>
      {onOpenLine && <button type="button" onClick={() => onOpenLine(item.id)}>Open line editor</button>}
    </>;
  }
  if (selection?.kind === 'vehicle') {
    const overlay = transit.vehicles?.find((vehicle) => vehicle.id === selection.id);
    const runtime = simulation.operations?.vehicles.find((vehicle) => vehicle.id === selection.id);
    const line = runtime ? network.getLine(runtime.lineId) : undefined;
    const template = runtime ? modeRegistry.getVehicleDefinition(runtime.vehicleTypeId) : undefined;
    const stopIds = line?.stopIds ?? [];
    const direction = runtime?.direction ?? 1;
    const currentStop = runtime && stopIds[runtime.stopIndex] ? network.getStop(stopIds[runtime.stopIndex]) : undefined;
    const nextIndex = runtime ? runtime.stopIndex + direction : -1;
    const nextStop = nextIndex >= 0 && nextIndex < stopIds.length ? network.getStop(stopIds[nextIndex]) : undefined;
    heading = template?.name ?? 'Transit vehicle';
    content = <dl>
      <dt>Line</dt><dd>{line?.name ?? runtime?.lineId ?? 'Unknown'}</dd>
      <dt>Vehicle type</dt><dd>{template?.name ?? overlay?.vehicleTypeId ?? 'Unknown'}</dd>
      <dt>Occupancy</dt><dd>{runtime ? `${runtime.passengers.length} / ${template?.capacity ?? '—'}` : 'Unavailable'}</dd>
      <dt>Current stop</dt><dd>{currentStop?.name ?? (runtime?.state === 'TRAVELING' ? 'En route' : '—')}</dd>
      <dt>Next stop</dt><dd>{nextStop?.name ?? 'End of line'}</dd>
      <dt>Direction</dt><dd>{direction === -1 ? 'Inbound' : line?.direction === 'one-way' ? 'Outbound (one-way)' : 'Outbound'}</dd>
      <dt>Operational state</dt><dd>{runtime?.state ?? 'Unknown'}</dd>
      {developerMode && <><dt>Vehicle ID</dt><dd>{selection.id}</dd></>}
      {line && onOpenLine && <dd><button type="button" className="secondary" onClick={() => onOpenLine(line.id)}>Open operations</button></dd>}
    </dl>;
  }
  return <section className="inspection"><p className="eyebrow">INSPECTOR</p><h2>{heading}</h2>{content}{coordinate && <p className="coordinate">Map coordinate: {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)}</p>}</section>;
}

export function DeveloperPanel({ diagnostic }: { readonly diagnostic?: MapDiagnostic }) { return <section className="developer-drawer"><div><p className="eyebrow">MAP DIAGNOSTIC</p>{diagnostic ? <dl><dt>Initialized</dt><dd>{String(diagnostic.initialized)}</dd><dt>Sources</dt><dd>{diagnostic.sourceCount}</dd><dt>Game layers</dt><dd>{diagnostic.expectedLayersLoaded ? 'Loaded' : 'Missing'}</dd><dt>Zoom</dt><dd>{diagnostic.zoom.toFixed(2)}</dd><dt>Center</dt><dd>{diagnostic.center.latitude.toFixed(4)}, {diagnostic.center.longitude.toFixed(4)}</dd><dt>Level bounds</dt><dd>{diagnostic.levelBounds.southWest.latitude.toFixed(3)}, {diagnostic.levelBounds.southWest.longitude.toFixed(3)} → {diagnostic.levelBounds.northEast.latitude.toFixed(3)}, {diagnostic.levelBounds.northEast.longitude.toFixed(3)}</dd></dl> : <p>Map diagnostic unavailable.</p>}</div></section>; }
