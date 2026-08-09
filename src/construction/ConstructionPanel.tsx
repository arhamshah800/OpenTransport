import { useCallback, useEffect, useState } from 'react';
import { defaultEngineeringConfiguration } from './config';
import type { ConstructionProposal, ConstructionState } from './types';
import type { ConstructionPreview, ConstructionWorkflow } from './ConstructionWorkflow';
import { DepthControl, ProposalCard, proposalGrade } from './ConstructionProposalUI';
import type { Coordinate } from '../world';

type PlayerConstructionMode = 'SUBWAY' | 'TRAM';
type ConstructionAction = 'station' | 'tunnel' | 'tram-alignment';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export interface ConstructionOverlayState {
  readonly state: ConstructionState;
  readonly pending?: ConstructionPreview;
}

export function ConstructionPanel({ mode, workflow, coordinate, clickVersion, hoverCoordinate, timestampSeconds, active, onOverlayChange, onEconomyChange, onCommitSuccess, onViewLoans }: {
  readonly mode: PlayerConstructionMode;
  readonly workflow: ConstructionWorkflow;
  readonly coordinate: Coordinate | null;
  readonly clickVersion: number;
  readonly hoverCoordinate: Coordinate | null;
  readonly timestampSeconds: number;
  readonly active: boolean;
  readonly onOverlayChange: (overlay: ConstructionOverlayState) => void;
  readonly onEconomyChange: () => void;
  readonly onCommitSuccess?: (estimate: ConstructionPreview['evaluation']['estimate']) => void;
  readonly onViewLoans?: () => void;
}) {
  const [action, setAction] = useState<ConstructionAction>(mode === 'SUBWAY' ? 'station' : 'tram-alignment');
  const [start, setStart] = useState<Coordinate | null>(null);
  const [end, setEnd] = useState<Coordinate | null>(null);
  const [locked, setLocked] = useState(false);
  const [stationDepth, setStationDepth] = useState(24);
  const [startDepth, setStartDepth] = useState(24);
  const [endDepth, setEndDepth] = useState(24);
  const [preview, setPreview] = useState<ConstructionPreview>();
  const [message, setMessage] = useState('Choose an action, then place it on the map.');

  const resetProposal = useCallback((nextMessage = 'Choose an action, then place it on the map.'): void => {
    workflow.cancel();
    setStart(null);
    setEnd(null);
    setLocked(false);
    setPreview(undefined);
    setMessage(nextMessage);
    onOverlayChange(workflow.snapshot());
  }, [onOverlayChange, workflow]);

  useEffect(() => {
    setAction(mode === 'SUBWAY' ? 'station' : 'tram-alignment');
    if (!active) {
      resetProposal('Proposal cancelled. Nothing was changed.');
      return;
    }
    resetProposal(mode === 'SUBWAY' ? 'Choose Station or Tunnel, then click the map.' : 'Click the map to begin a tram alignment.');
  }, [active, mode, resetProposal]);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (!preview && !start && !locked) return;
      event.preventDefault();
      event.stopPropagation();
      resetProposal(action === 'station' ? 'Station proposal cancelled. Move over the map to preview another site.' : 'Alignment cancelled. Click the map to set a new start.');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [action, active, locked, preview, resetProposal, start]);

  const proposalFor = useCallback((target: Coordinate): ConstructionProposal | undefined => {
    const state = workflow.snapshot().state;
    if (action === 'station') {
      return {
        kind: 'station',
        id: `subway-station-${state.stations.length + 1}`,
        mode: 'SUBWAY',
        elevationMeters: -stationDepth,
        footprint: {
          center: target,
          widthMeters: defaultEngineeringConfiguration.stationWidthMeters,
          lengthMeters: defaultEngineeringConfiguration.stationLengthMeters,
        },
      };
    }
    if (!start) return undefined;
    return {
      kind: 'alignment',
      id: `${action === 'tunnel' ? 'subway-tunnel' : 'tram-guideway'}-${state.engineeringSegments.length + 1}`,
      mode: action === 'tunnel' ? 'SUBWAY' : 'TRAM',
      geometry: [start, target],
      verticalProfile: action === 'tunnel' ? { startElevationMeters: -startDepth, endElevationMeters: -endDepth } : undefined,
    };
  }, [action, endDepth, start, startDepth, stationDepth, workflow]);

  const updatePreview = useCallback((target: Coordinate): void => {
    const proposal = proposalFor(target);
    if (!proposal) return;
    const next = workflow.preview(proposal);
    setPreview(next);
    onOverlayChange(workflow.snapshot());
  }, [onOverlayChange, proposalFor, workflow]);

  useEffect(() => {
    if (!active || locked || !hoverCoordinate) return;
    if (action === 'station' || start) updatePreview(hoverCoordinate);
  }, [active, action, hoverCoordinate, locked, start, updatePreview]);

  useEffect(() => {
    if (!active || clickVersion === 0 || !coordinate) return;
    if (action === 'station') {
      setEnd(coordinate);
      setLocked(true);
      updatePreview(coordinate);
      setMessage('Station location locked. Review the proposal before building.');
      return;
    }
    if (!start) {
      workflow.cancel();
      setPreview(undefined);
      setStart(coordinate);
      setEnd(null);
      setLocked(false);
      setMessage(`Start set. Move across the map to preview the ${action === 'tunnel' ? 'tunnel' : 'tram alignment'}, then click its end.`);
      onOverlayChange(workflow.snapshot());
      return;
    }
    setEnd(coordinate);
    setLocked(true);
    updatePreview(coordinate);
    setMessage('Alignment locked. Review engineering and cost before building.');
  // clickVersion is the intentional event trigger; other values are read from the latest render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clickVersion]);

  useEffect(() => {
    if (end) updatePreview(end);
  }, [stationDepth, startDepth, endDepth, end, updatePreview]);

  const chooseAction = (next: ConstructionAction): void => {
    setAction(next);
    resetProposal(next === 'station' ? 'Move over the map to preview a station, then click to place it.' : 'Click the map to set the alignment start.');
  };

  const confirm = (): void => {
    const result = workflow.confirm(timestampSeconds);
    if (!result.ok) {
      const failure = result.reason === 'UNAFFORDABLE'
        ? 'There is not enough cash for this project.'
        : result.reason === 'INVALID'
          ? 'Resolve the engineering issues before building.'
          : 'Place a proposal on the map first.';
      setMessage(failure);
      if (result.preview) setPreview(result.preview);
      onOverlayChange(workflow.snapshot());
      return;
    }
    onCommitSuccess?.(result.preview.evaluation.estimate);
    onEconomyChange();
    onOverlayChange(workflow.snapshot());
    setPreview(undefined);
    setStart(null);
    setEnd(null);
    setLocked(false);
    setMessage(`${action === 'station' ? 'Station' : action === 'tunnel' ? 'Tunnel' : 'Tram alignment'} built for ${money.format(result.preview.evaluation.estimate.cost.total)}.`);
  };

  const grade = preview ? proposalGrade(preview) : undefined;

  return <section className="construction-workflow" aria-label={`${mode.toLowerCase()} construction`}>
    <div className="construction-action-tabs" role="group" aria-label="Infrastructure action">
      {mode === 'SUBWAY'
        ? <>
          <button type="button" className={action === 'station' ? 'active' : ''} aria-pressed={action === 'station'} onClick={() => chooseAction('station')}>Station</button>
          <button type="button" className={action === 'tunnel' ? 'active' : ''} aria-pressed={action === 'tunnel'} onClick={() => chooseAction('tunnel')}>Tunnel</button>
        </>
        : <button type="button" className="active" aria-pressed="true">Alignment</button>}
    </div>
    {action === 'station'
      ? <DepthControl label="Station depth" value={stationDepth} onChange={setStationDepth} />
      : action === 'tunnel'
        ? <div className="depth-pair"><DepthControl label="Start depth" value={startDepth} onChange={setStartDepth} /><DepthControl label="End depth" value={endDepth} onChange={setEndDepth} /></div>
        : <p className="builder-message">Tram guideway uses dedicated surface right-of-way. Click start and end points on the map.</p>}
    <p className="builder-message">{message}</p>
    {preview && <ProposalCard preview={preview} grade={grade} />}
    <div className="proposal-actions">
      <button type="button" className="secondary" onClick={() => resetProposal(action === 'station' ? 'Station proposal cancelled. Move over the map to preview another site.' : 'Alignment cancelled. Click the map to set a new start.')}>Cancel</button>
      <button type="button" disabled={!locked || !preview?.evaluation.valid || !preview.affordable} onClick={confirm}>Build</button>
      {preview && !preview.affordable && onViewLoans && <button type="button" className="secondary" onClick={onViewLoans}>View loans</button>}
    </div>
    <div className="project-counts">
      <span><strong>{workflow.snapshot().state.stations.length}</strong> stations built</span>
      <span><strong>{workflow.snapshot().state.engineeringSegments.length}</strong> alignments built</span>
    </div>
  </section>;
}
