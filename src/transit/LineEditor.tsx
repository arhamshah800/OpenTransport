import { useMemo, useState } from 'react';
import type { World } from '../world';
import {
  createTransferComplex, deleteLine, removeStopFromLine, renameLine, reorderLineStops, setLineAlignment, setLineColor, setLineVisible,
  TransitNetwork,
} from './index';
import type { TransitMode } from './types';
import { canCreateTransfer, makeServiceLine, routeBusSegments, routeGuidewaySegments } from './serviceBuilder';
import { lineDisplayColor } from './lineStyle';
import type { ConstructionState } from '../construction';
import { LineOperationsPanel } from '../operations';
import type { SimulationEngine, SimulationSnapshot } from '../time';

export function LineEditor({ world, network, lineId, mode, construction, onNetwork, onClose, onMessage, engine, snapshot, onSnapshot, onPurchaseVehicle }: {
  readonly world: World;
  readonly network: TransitNetwork;
  readonly lineId: string;
  readonly mode: TransitMode;
  readonly construction?: ConstructionState;
  readonly onNetwork: (network: TransitNetwork) => void;
  readonly onClose: () => void;
  readonly onMessage: (message: string) => void;
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly onPurchaseVehicle?: (lineId: string, vehicleId: string, purchaseCost: number) => boolean;
}) {
  const line = network.getLine(lineId);
  const [name, setName] = useState(line?.name ?? '');
  const [color, setColor] = useState(line?.color ?? lineDisplayColor(line!));
  const [transferStopId, setTransferStopId] = useState<string | null>(null);
  const stops = useMemo(() => line?.stopIds.map((id) => network.getStop(id)).filter(Boolean) ?? [], [line, network]);

  if (!line) return <p className="builder-message">Line not found.</p>;

  const rebuildGeometry = (nextNetwork: TransitNetwork, stopIds: readonly string[]): TransitNetwork => {
    const stopRecords = stopIds.map((id) => nextNetwork.getStop(id)!);
    if (mode === 'BUS') {
      const routed = routeBusSegments(world, stopRecords);
      if (routed.error) throw new Error(routed.error);
      const rebuilt = makeServiceLine(line.id, line.name, mode, stopIds, nextNetwork, { geometries: routed.geometries, color: line.color, plannedHeadwayMinutes: line.serviceSettings?.plannedHeadwayMinutes });
      return setLineAlignment(nextNetwork, line.id, rebuilt.segments);
    }
    if (!construction) throw new Error(mode === 'TRAM' ? 'Tram alignment has not been constructed.' : 'No constructed subway tunnel connects these stations.');
    const routed = routeGuidewaySegments(construction, mode, stopRecords);
    if (routed.error) throw new Error(routed.error);
    const rebuilt = makeServiceLine(line.id, line.name, mode, stopIds, nextNetwork, {
      geometries: routed.geometries,
      engineeringBySegment: routed.engineeringBySegment,
      color: line.color,
      reservedRightOfWay: true,
      plannedHeadwayMinutes: line.serviceSettings?.plannedHeadwayMinutes,
    });
    return setLineAlignment(nextNetwork, line.id, rebuilt.segments);
  };

  const saveName = (): void => {
    try { onNetwork(renameLine(network, line.id, name.trim() || line.name)); onMessage('Line renamed.'); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Unable to rename line.'); }
  };

  const removeStop = (stopId: string): void => {
    try {
      let next = removeStopFromLine(network, line.id, stopId);
      next = rebuildGeometry(next, next.getLine(line.id)!.stopIds);
      onNetwork(next); onMessage('Stop removed from line.');
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Unable to remove stop.'); }
  };
  const moveStop = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= line.stopIds.length) return;
    try {
      const ids = [...line.stopIds]; [ids[index], ids[target]] = [ids[target], ids[index]];
      const next = reorderLineStops(network, line.id, ids);
      onNetwork(rebuildGeometry(next, ids)); onMessage('Stop order updated.');
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Unable to reorder stops.'); }
  };
  const saveColor = (): void => {
    try { onNetwork(setLineColor(network, line.id, color)); onMessage('Line color updated.'); }
    catch (error) { onMessage(error instanceof Error ? error.message : 'Unable to update line color.'); }
  };

  const removeLine = (): void => {
    onNetwork(deleteLine(network, line.id));
    onMessage('Line deleted. Stops and constructed infrastructure remain.');
    onClose();
  };

  const linkTransfer = (stopId: string): void => {
    if (!transferStopId) { setTransferStopId(stopId); onMessage('Select another nearby stop to create a transfer.'); return; }
    const first = network.getStop(transferStopId); const second = network.getStop(stopId);
    if (!first || !second) return;
    const check = canCreateTransfer(first, second);
    if (!check.ok) { onMessage(check.reason); setTransferStopId(null); return; }
    try {
      onNetwork(createTransferComplex(network, `transfer-${network.definition.transferComplexes.length + 1}`, `${first.name} ↔ ${second.name}`, [first.id, second.id]));
      setTransferStopId(null); onMessage(`Transfer linked between ${first.name} and ${second.name}.`);
    } catch (error) { onMessage(error instanceof Error ? error.message : 'Unable to create transfer.'); setTransferStopId(null); }
  };

  return <section className="line-editor" aria-label={`${line.name} editor`}>
    <header className="line-editor-header" style={{ borderLeftColor: lineDisplayColor(line) }}>
      <div><p className="eyebrow">{mode} LINE</p><h3>{line.name}</h3></div>
      <button type="button" className="secondary" onClick={onClose}>Back</button>
    </header>
    <label>Name <input aria-label="Rename line" value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="proposal-actions"><button type="button" onClick={saveName}>Save name</button></div>
    <label>Line color <input aria-label="Line color" type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
    <div className="proposal-actions"><button type="button" onClick={saveColor}>Save color</button></div>
    <label className="settings-switch"><span><strong>Show line on map</strong><small>Hides this line visually without stopping service.</small></span><input aria-label="Show line on map" type="checkbox" role="switch" checked={line.visible !== false} onChange={(event) => onNetwork(setLineVisible(network, line.id, event.target.checked))} /></label>
    <p className="debug-note">Use Start/Stop Service in Operations below to run the line. Topology stays available for editing.</p>
    <h3>Stops in order</h3>
    <p className="debug-note">Termini: <strong>{stops[0]?.name ?? '—'}</strong> → <strong>{stops.at(-1)?.name ?? '—'}</strong>. A line needs at least two distinct stops.</p>
    <ol className="stop-order-list">{stops.map((stop, index) => stop && <li key={stop.id}><span>{stop.name}</span><div><button type="button" className="secondary" disabled={index === 0} onClick={() => moveStop(index, -1)} aria-label={`Move ${stop.name} earlier`}>↑</button><button type="button" className="secondary" disabled={index === stops.length - 1} onClick={() => moveStop(index, 1)} aria-label={`Move ${stop.name} later`}>↓</button><button type="button" className="secondary" onClick={() => removeStop(stop.id)}>Remove</button></div></li>)}</ol>
    <h3>Transfers</h3>
    <ul className="network-list">{stops.map((stop) => stop && <li key={`transfer-${stop.id}`}><button type="button" className="secondary" onClick={() => linkTransfer(stop.id)}>{transferStopId === stop.id ? 'Linking… ' : ''}{stop.name}</button></li>)}</ul>
    <LineOperationsPanel network={network} lineId={line.id} engine={engine} snapshot={snapshot} onSnapshot={onSnapshot} onNetwork={onNetwork} onPurchaseVehicle={onPurchaseVehicle ? (vehicleId, purchaseCost) => onPurchaseVehicle(line.id, vehicleId, purchaseCost) : undefined} />
    <div className="proposal-actions">
      <button type="button" className="danger" onClick={removeLine}>Delete line</button>
    </div>
  </section>;
}
