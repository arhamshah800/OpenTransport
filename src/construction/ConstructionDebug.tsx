import { useState } from 'react';
import type { Coordinate, World } from '../world';
import type { ConstructionWorkflow, ConstructionWorkflowSnapshot } from './ConstructionWorkflow';
import type { Economy } from '../economy';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Developer tools that mutate the same ConstructionWorkflow as the player UI. */
export function ConstructionDebug({
  coordinate,
  economy,
  timestampSeconds,
  onEconomyChange,
  developerMode = false,
  workflow,
  onOverlayChange,
  onCommit,
}: {
  readonly world: World;
  readonly coordinate: Coordinate | null;
  readonly economy: Economy;
  readonly timestampSeconds: number;
  readonly onEconomyChange: () => void;
  readonly developerMode?: boolean;
  readonly workflow?: ConstructionWorkflow;
  readonly onOverlayChange?: (overlay: ConstructionWorkflowSnapshot) => void;
  readonly onCommit?: (estimate: { readonly riverCrossingIds: readonly string[] }) => void;
}) {
  const [mode, setMode] = useState<'BUS' | 'TRAM' | 'SUBWAY'>('SUBWAY');
  const [depth, setDepth] = useState(-24);
  const [start, setStart] = useState<Coordinate | null>(null);
  const [message, setMessage] = useState('Debug commits go through the shared player construction workflow.');
  const snapshot = workflow?.snapshot();
  const state = snapshot?.state ?? { demolishedBuildingIds: [], engineeringSegments: [], stations: [] };

  const previewStation = (): void => {
    if (!workflow || !coordinate || mode !== 'SUBWAY') return setMessage('Select a map location first (shared workflow required).');
    const preview = workflow.preview({
      kind: 'station',
      id: `station-${state.stations.length + 1}`,
      mode: 'SUBWAY',
      elevationMeters: depth,
      footprint: { center: coordinate, widthMeters: 28, lengthMeters: 140 },
    });
    onOverlayChange?.(workflow.snapshot());
    if (!preview.evaluation.valid) return setMessage(preview.evaluation.issues.map((issue) => issue.message).join(' '));
    const result = workflow.confirm(timestampSeconds);
    if (!result.ok) return setMessage(result.reason === 'UNAFFORDABLE' ? `Unaffordable: cash is ${currency.format(economy.getCurrentCash() / 100)}.` : 'Invalid proposal.');
    onCommit?.(result.preview.evaluation.estimate);
    onOverlayChange?.(workflow.snapshot());
    onEconomyChange();
    setMessage(`Built station for ${currency.format(result.preview.evaluation.estimate.cost.total)}.`);
  };

  const previewSegment = (): void => {
    if (!workflow || !coordinate) return setMessage('Click a map location first.');
    if (!start) {
      setStart(coordinate);
      return setMessage('Tunnel start set. Click an end point, then build the alignment.');
    }
    const preview = workflow.preview({
      kind: 'alignment',
      id: `segment-${state.engineeringSegments.length + 1}`,
      mode,
      geometry: [start, coordinate],
      verticalProfile: mode === 'SUBWAY' ? { startElevationMeters: depth, endElevationMeters: depth } : undefined,
    });
    onOverlayChange?.(workflow.snapshot());
    if (!preview.evaluation.valid) {
      setStart(null);
      return setMessage(preview.evaluation.issues.map((issue) => issue.message).join(' '));
    }
    const result = workflow.confirm(timestampSeconds);
    setStart(null);
    if (!result.ok) return setMessage(result.reason === 'UNAFFORDABLE' ? 'Unaffordable.' : 'Invalid.');
    onCommit?.(result.preview.evaluation.estimate);
    onOverlayChange?.(workflow.snapshot());
    onEconomyChange();
    setMessage(`Built ${mode.toLowerCase()} alignment for ${currency.format(result.preview.evaluation.estimate.cost.total)}.`);
  };

  return (
    <section className="construction-builder">
      <h3>Developer construction tools</h3>
      <p className="builder-message">Raw engineering controls for debugging. Commits use the same ConstructionWorkflow as Subway/Tram tools.</p>
      {developerMode && (
        <label>Override mode
          <select aria-label="Construction mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="BUS">Bus</option>
            <option value="TRAM">Tram</option>
            <option value="SUBWAY">Subway</option>
          </select>
        </label>
      )}
      <label>Elevation (0 surface; negative underground)
        <span className="input-with-unit">
          <input aria-label="Subway depth" type="number" value={depth} max="0" onChange={(event) => setDepth(Number(event.target.value))} /> m
        </span>
      </label>
      <div className="construction-actions">
        <button type="button" onClick={previewStation} disabled={!workflow}>Build station here</button>
        <button type="button" onClick={previewSegment} disabled={!workflow}>{start ? 'Build tunnel to here' : 'Set tunnel start'}</button>
      </div>
      <p className="builder-message">{message}</p>
      <div className="project-counts">
        <span><strong>{state.stations.length}</strong> stations built</span>
        <span><strong>{state.engineeringSegments.length}</strong> alignments built</span>
      </div>
      {developerMode && (
        <section className="developer-construction-tools">
          <p className="eyebrow">DEVELOPER ENGINEERING</p>
          <dl>
            <dt>Demolished buildings</dt><dd>{state.demolishedBuildingIds.length}</dd>
            <dt>Depth convention</dt><dd>0m surface; negative underground</dd>
            <dt>Selected coordinate</dt><dd>{coordinate ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}` : 'None'}</dd>
          </dl>
        </section>
      )}
    </section>
  );
}
