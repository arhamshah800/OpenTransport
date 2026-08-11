import { useEffect, useState } from 'react';
import type { Coordinate, World } from '../world';
import type { ConstructionState } from '../construction';
import {
  createLine, createStop, TransitNetwork, type TransitStop,
} from './index';
import {
  constructionServiceValidator, findConstructedStation, makeServiceLine, nearestGuidewayPoint, routeGuidewaySegments,
} from './serviceBuilder';
import { lineDisplayColor } from './lineStyle';
import type { TransitOverlay } from '../map/types';
import { LineEditor } from './LineEditor';
import { networkToOverlay } from './BusLinePanel';
import type { SimulationEngine, SimulationSnapshot } from '../time';

export function GuidewayLinePanel({ mode, world, network, construction, coordinate, clickVersion, hoverCoordinate, active, onNetwork, onOverlay, selectedLineId, onSelectLine, engine, snapshot, onSnapshot, onPurchaseVehicle }: {
  readonly mode: 'TRAM' | 'SUBWAY';
  readonly world: World;
  readonly network: TransitNetwork;
  readonly construction: ConstructionState;
  readonly coordinate: Coordinate | null;
  readonly clickVersion: number;
  readonly hoverCoordinate: Coordinate | null;
  readonly active: boolean;
  readonly onNetwork: (network: TransitNetwork) => void;
  readonly onOverlay: (overlay: TransitOverlay) => void;
  readonly selectedLineId: string | null;
  readonly onSelectLine: (lineId: string | null) => void;
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly onPurchaseVehicle?: (lineId: string, vehicleId: string, purchaseCost: number) => boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftStops, setDraftStops] = useState<TransitStop[]>([]);
  const [lineName, setLineName] = useState(mode === 'TRAM' ? 'Tram Line' : 'Subway Line');
  const [headway, setHeadway] = useState(mode === 'TRAM' ? 10 : 8);
  const [message, setMessage] = useState(mode === 'TRAM'
    ? 'Construct tram guideway first, then create a service line along it.'
    : 'Construct stations and tunnels first, then create a subway service line.');
  const lines = network.definition.lines.filter((line) => line.mode === mode);
  const validator = constructionServiceValidator(construction);
  const guideways = construction.engineeringSegments.filter((segment) => segment.mode === mode);
  const stations = construction.stations;

  useEffect(() => {
    if (!active) { setDrafting(false); setDraftStops([]); return; }
    const preview = draftStops.length >= 2 ? routeGuidewaySegments(construction, mode, draftStops) : undefined;
    const hoverPoint = drafting && hoverCoordinate
      ? (mode === 'SUBWAY' ? findConstructedStation(construction, hoverCoordinate)?.center ?? null : nearestGuidewayPoint(construction, mode, hoverCoordinate)?.coordinate ?? null)
      : null;
    onOverlay({
      ...networkToOverlay(network, selectedLineId ?? undefined),
      lines: [
        ...networkToOverlay(network, selectedLineId ?? undefined).lines,
        ...(preview?.geometries?.length ? [{ id: `draft-${mode.toLowerCase()}`, geometry: preview.geometries.flat(), color: mode === 'TRAM' ? '#2d936c' : '#a14eaa' }] : []),
      ],
      stops: [
        ...network.definition.stops.map((stop) => ({ id: stop.id, coordinate: stop.coordinate, name: stop.name })),
        ...draftStops.map((stop) => ({ id: stop.id, coordinate: stop.coordinate, name: stop.name })),
        ...(hoverPoint ? [{ id: 'draft-guideway-hover', coordinate: hoverPoint, name: 'Next stop' }] : []),
        ...stations.map((station, index) => ({ id: station.id ?? `station-footprint-${index}`, coordinate: station.center, name: station.name ?? station.id ?? `Station ${index + 1}` })),
      ],
    });
  }, [active, construction, draftStops, drafting, hoverCoordinate, mode, network, onOverlay, selectedLineId, stations]);

  useEffect(() => {
    if (!active || !drafting || clickVersion === 0 || !coordinate) return;
    if (mode === 'TRAM') {
      const snap = nearestGuidewayPoint(construction, 'TRAM', coordinate);
      if (!snap) { setMessage('Tram alignment has not been constructed.'); return; }
      const id = `tram-stop-${network.definition.stops.length + draftStops.length + 1}`;
      setDraftStops((current) => [...current, { id, name: `Tram Stop ${current.length + 1}`, coordinate: snap.coordinate, kind: 'stop', supportedModes: ['TRAM'], infrastructure: { constructionSegmentId: snap.segmentId } }]);
      setMessage(`Placed tram stop ${draftStops.length + 1} on the guideway.`);
      return;
    }
    const station = findConstructedStation(construction, coordinate);
    if (!station?.id) { setMessage('Subway stops must be placed at constructed stations.'); return; }
    if (draftStops.some((stop) => stop.infrastructure?.constructionStationId === station.id)) { setMessage('That station is already on this draft line.'); return; }
    const id = `subway-stop-${station.id}`;
    if (network.getStop(id) || draftStops.some((stop) => stop.id === id)) {
      const existing = network.getStop(id);
      if (existing) setDraftStops((current) => current.some((stop) => stop.id === id) ? current : [...current, existing]);
      else setMessage('Station already used by another stop.');
      return;
    }
    setDraftStops((current) => [...current, {
      id, name: station.name ?? station.id ?? `Station ${current.length + 1}`, coordinate: station.center, kind: 'station', supportedModes: ['SUBWAY'],
      infrastructure: { constructionStationId: station.id },
    }]);
    setMessage(`Added ${station.name ?? station.id}. Select connected stations to continue.`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickVersion]);

  const begin = (): void => {
    if (mode === 'TRAM' && guideways.length === 0) { setMessage('Tram alignment has not been constructed.'); return; }
    if (mode === 'SUBWAY' && (stations.length < 2 || guideways.length === 0)) { setMessage('No constructed subway tunnel connects these stations.'); return; }
    setDrafting(true); setDraftStops([]); setLineName(`${mode === 'TRAM' ? 'Tram' : 'Subway'} Line ${lines.length + 1}`); onSelectLine(null);
    setMessage(mode === 'TRAM' ? 'Click along the constructed tram guideway to place stops.' : 'Click constructed subway stations in service order.');
  };

  const cancel = (): void => { setDrafting(false); setDraftStops([]); setMessage('Service line draft cancelled.'); };

  const finish = (): void => {
    if (draftStops.length < 2) { setMessage('Line requires at least two stops.'); return; }
    const routed = routeGuidewaySegments(construction, mode, draftStops);
    if (routed.error) { setMessage(routed.error); return; }
    try {
      let next = network;
      for (const stop of draftStops) {
        if (!next.getStop(stop.id)) next = createStop(next, stop, validator);
      }
      const line = makeServiceLine(`${mode.toLowerCase()}-line-${next.definition.lines.length + 1}`, lineName.trim() || `${mode} Line`, mode, draftStops.map((stop) => stop.id), next, {
        geometries: routed.geometries,
        engineeringBySegment: routed.engineeringBySegment,
        reservedRightOfWay: true,
        plannedHeadwayMinutes: headway,
      });
      next = createLine(next, line, validator);
      onNetwork(next); setDrafting(false); setDraftStops([]); onSelectLine(line.id);
      setMessage(`Created ${line.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^Infrastructure proposal rejected: /, '') : 'Unable to create line.');
    }
  };

  if (selectedLineId && network.getLine(selectedLineId)?.mode === mode) {
    return <LineEditor world={world} network={network} lineId={selectedLineId} mode={mode} construction={construction} onNetwork={onNetwork} onClose={() => onSelectLine(null)} onMessage={setMessage} engine={engine} snapshot={snapshot} onSnapshot={onSnapshot} onPurchaseVehicle={onPurchaseVehicle} />;
  }

  return <section className="line-workflow" aria-label={`${mode.toLowerCase()} service line builder`}>
    <div className="construction-action-tabs" role="group" aria-label="Service actions">
      <button type="button" className={drafting ? 'active' : ''} onClick={begin}>Create {mode === 'TRAM' ? 'Tram' : 'Subway'} Line</button>
      <button type="button" className={!drafting ? 'active' : ''} onClick={cancel}>Lines</button>
    </div>
    <p className="builder-message">{message}</p>
    <div className="project-counts">
      <span><strong>{mode === 'SUBWAY' ? stations.length : guideways.length}</strong> {mode === 'SUBWAY' ? 'stations built' : 'alignments built'}</span>
      <span><strong>{lines.length}</strong> service lines</span>
    </div>
    {drafting ? <>
      <label>Line name <input aria-label={`${mode} line name`} value={lineName} onChange={(event) => setLineName(event.target.value)} /></label>
      <label>Daytime headway (min) <input aria-label={`${mode} headway`} type="number" min={3} max={60} value={headway} onChange={(event) => setHeadway(Number(event.target.value))} /></label>
      <ol className="stop-order-list">{draftStops.map((stop) => <li key={stop.id}>{stop.name}</li>)}</ol>
      <div className="proposal-actions">
        <button type="button" className="secondary" onClick={cancel}>Cancel</button>
        <button type="button" disabled={draftStops.length < 2} onClick={finish}>Finish Line</button>
      </div>
    </> : <>
      {lines.length === 0 ? <p className="empty-state">No {mode.toLowerCase()} service lines yet.</p> : <ul className="network-list">{lines.map((line) => <li key={line.id}><button type="button" className="line-pick" style={{ borderLeftColor: lineDisplayColor(line) }} onClick={() => onSelectLine(line.id)}>{line.name} <small>{line.stopIds.length} stops</small></button></li>)}</ul>}
    </>}
  </section>;
}
