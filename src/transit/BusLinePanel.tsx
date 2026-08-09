import { useEffect, useMemo, useState } from 'react';
import type { Coordinate, World } from '../world';
import { defaultEngineeringConfiguration } from '../construction';
import {
  createLine, createStop, createTransferComplex,
  TransitNetwork, type TransitStop,
} from './index';
import { busStopValidator, canCreateTransfer, makeServiceLine, routeBusSegments, snapBusStopCoordinate } from './serviceBuilder';
import { lineDisplayColor } from './lineStyle';
import type { TransitOverlay } from '../map/types';
import { LineEditor } from './LineEditor';
import type { SimulationEngine, SimulationSnapshot } from '../time';

export function networkToOverlay(network: TransitNetwork, highlightLineId?: string): TransitOverlay {
  return {
    lines: network.definition.lines.filter((line) => line.active || line.id === highlightLineId).flatMap((line) => line.segments.map((segment) => ({
      id: segment.id,
      geometry: segment.geometry,
      color: line.id === highlightLineId ? lineDisplayColor(line) : `${lineDisplayColor(line)}cc`,
    }))),
    stops: network.definition.stops.map((stop) => ({ id: stop.id, coordinate: stop.coordinate, name: stop.name })),
  };
}

export function BusLinePanel({ world, network, coordinate, clickVersion, hoverCoordinate, active, onNetwork, onOverlay, onSelectLine, selectedLineId, engine, snapshot, onSnapshot }: {
  readonly world: World;
  readonly network: TransitNetwork;
  readonly coordinate: Coordinate | null;
  readonly clickVersion: number;
  readonly hoverCoordinate: Coordinate | null;
  readonly active: boolean;
  readonly onNetwork: (network: TransitNetwork) => void;
  readonly onOverlay: (overlay: TransitOverlay) => void;
  readonly onSelectLine: (lineId: string | null) => void;
  readonly selectedLineId: string | null;
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftStops, setDraftStops] = useState<TransitStop[]>([]);
  const [lineName, setLineName] = useState('Bus Line');
  const [headway, setHeadway] = useState(12);
  const [message, setMessage] = useState('Start a new bus line, then click roads to place stops.');
  const [transferStopId, setTransferStopId] = useState<string | null>(null);
  const graph = useMemo(() => busStopValidator(world), [world]);
  const busLines = network.definition.lines.filter((line) => line.mode === 'BUS');

  useEffect(() => {
    if (!active) { setDrafting(false); setDraftStops([]); return; }
    const previewGeometry = draftStops.length >= 2 ? routeBusSegments(world, draftStops).geometries.flat() : [];
    const hoverSnap = drafting && hoverCoordinate ? snapBusStopCoordinate(world, hoverCoordinate) : null;
    onOverlay({
      ...networkToOverlay(network, selectedLineId ?? undefined),
      lines: [
        ...networkToOverlay(network, selectedLineId ?? undefined).lines,
        ...(previewGeometry.length >= 2 ? [{ id: 'draft-bus', geometry: previewGeometry, color: '#3d78ad' }] : []),
        ...(draftStops.length > 0 && hoverSnap ? [{ id: 'draft-bus-hover', geometry: [draftStops[draftStops.length - 1].coordinate, hoverSnap], color: '#3d78ad88' }] : []),
      ],
      stops: [
        ...network.definition.stops.map((stop) => ({ id: stop.id, coordinate: stop.coordinate, name: stop.name })),
        ...draftStops.map((stop) => ({ id: stop.id, coordinate: stop.coordinate, name: stop.name })),
        ...(hoverSnap ? [{ id: 'draft-hover-stop', coordinate: hoverSnap, name: 'Next stop' }] : []),
      ],
    });
  }, [active, draftStops, drafting, hoverCoordinate, network, onOverlay, selectedLineId, world]);

  useEffect(() => {
    if (!active || !drafting || clickVersion === 0 || !coordinate) return;
    const snapped = snapBusStopCoordinate(world, coordinate);
    if (!snapped) { setMessage('Bus stop must be placed near a road.'); return; }
    const id = `bus-stop-${network.definition.stops.length + draftStops.length + 1}`;
    setDraftStops((current) => [...current, { id, name: `Bus Stop ${current.length + 1}`, coordinate: snapped, kind: 'stop', supportedModes: ['BUS'] }]);
    setMessage(`Placed stop ${draftStops.length + 1}. Continue along roads, or finish the line.`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickVersion]);

  const beginLine = (): void => {
    setDrafting(true); setDraftStops([]); setLineName(`Bus Line ${busLines.length + 1}`); setMessage('Click a road to place the first stop.'); onSelectLine(null);
  };

  const cancelDraft = (): void => {
    setDrafting(false); setDraftStops([]); setMessage('Bus line cancelled. Existing network unchanged.');
  };

  const finishLine = (): void => {
    if (draftStops.length < 2) { setMessage('Line requires at least two stops.'); return; }
    const routed = routeBusSegments(world, draftStops);
    if (routed.error || routed.geometries.length !== draftStops.length - 1) { setMessage(routed.error ?? 'Bus route must follow existing roads between stops.'); return; }
    try {
      let next = network;
      for (const stop of draftStops) next = createStop(next, stop, graph);
      const line = makeServiceLine(`bus-line-${next.definition.lines.length + 1}`, lineName.trim() || `Bus Line ${busLines.length + 1}`, 'BUS', draftStops.map((stop) => stop.id), next, {
        geometries: routed.geometries,
        plannedHeadwayMinutes: headway,
      });
      next = createLine(next, line, graph);
      onNetwork(next);
      setDrafting(false); setDraftStops([]); onSelectLine(line.id);
      setMessage(`Created ${line.name} along city streets.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create bus line.');
    }
  };

  const linkTransfer = (stopId: string): void => {
    if (!transferStopId) { setTransferStopId(stopId); setMessage('Select a nearby stop to link as a transfer.'); return; }
    const first = network.getStop(transferStopId); const second = network.getStop(stopId);
    if (!first || !second) return;
    const check = canCreateTransfer(first, second);
    if (!check.ok) { setMessage(check.reason); setTransferStopId(null); return; }
    try {
      const next = createTransferComplex(network, `transfer-${network.definition.transferComplexes.length + 1}`, `${first.name} ↔ ${second.name}`, [first.id, second.id]);
      onNetwork(next); setTransferStopId(null); setMessage(`Linked ${first.name} and ${second.name} as a transfer.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create transfer.'); setTransferStopId(null);
    }
  };

  if (selectedLineId && network.getLine(selectedLineId)?.mode === 'BUS') {
    return <LineEditor world={world} network={network} lineId={selectedLineId} mode="BUS" onNetwork={onNetwork} onClose={() => onSelectLine(null)} onMessage={setMessage} engine={engine} snapshot={snapshot} onSnapshot={onSnapshot} />;
  }

  return <section className="line-workflow" aria-label="Bus line builder">
    <div className="construction-action-tabs" role="group" aria-label="Bus actions">
      <button type="button" className={drafting ? 'active' : ''} onClick={beginLine}>New Bus Line</button>
      <button type="button" className={!drafting ? 'active' : ''} onClick={cancelDraft}>Lines</button>
    </div>
    <p className="builder-message">{message}</p>
    {drafting ? <>
      <label>Line name <input aria-label="Bus line name" value={lineName} onChange={(event) => setLineName(event.target.value)} /></label>
      <label>Daytime headway (min) <input aria-label="Bus headway" type="number" min={4} max={60} value={headway} onChange={(event) => setHeadway(Number(event.target.value))} /></label>
      <ol className="stop-order-list">{draftStops.map((stop) => <li key={stop.id}>{stop.name}</li>)}</ol>
      <div className="proposal-actions">
        <button type="button" className="secondary" onClick={cancelDraft}>Cancel</button>
        <button type="button" disabled={draftStops.length < 2} onClick={finishLine}>Finish Line</button>
      </div>
    </> : <>
      <h3>Bus lines <span>{busLines.length}</span></h3>
      {busLines.length === 0 ? <p className="empty-state">No bus lines yet. Start a new line and click along roads.</p> : <ul className="network-list">{busLines.map((line) => <li key={line.id}><button type="button" className="line-pick" style={{ borderLeftColor: lineDisplayColor(line) }} onClick={() => onSelectLine(line.id)}>{line.name} <small>{line.stopIds.length} stops</small></button></li>)}</ul>}
      <h3>Transfers</h3>
      <p className="empty-state">Select two nearby stops to link them for passenger transfers.</p>
      <ul className="network-list">{network.definition.stops.filter((stop) => stop.supportedModes.includes('BUS')).map((stop) => <li key={stop.id}><button type="button" className="secondary" onClick={() => linkTransfer(stop.id)}>{transferStopId === stop.id ? 'Linking… ' : ''}{stop.name}</button></li>)}</ul>
    </>}
    <p className="builder-message">Snap tolerance {defaultEngineeringConfiguration.busRoadSnapToleranceMeters} m · routes follow the road network.</p>
  </section>;
}
