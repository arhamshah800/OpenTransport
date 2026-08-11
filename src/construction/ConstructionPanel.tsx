import { useCallback, useEffect, useState } from 'react';
import { defaultEngineeringConfiguration } from './config';
import { stationEntranceCoordinate } from './ConstructionEngine';
import type { ConstructionProposal, ConstructionState } from './types';
import type { ConstructionPreview, ConstructionWorkflow } from './ConstructionWorkflow';
import { DepthControl, ProposalCard, proposalGrade } from './ConstructionProposalUI';
import { activeConstructionStage } from './schedule';
import type { Coordinate } from '../world';

type PlayerConstructionMode = 'SUBWAY' | 'TRAM';
type ConstructionAction = 'station' | 'tunnel' | 'elevated' | 'tram-alignment';

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
  const [stationName, setStationName] = useState('New Station');
  const [entranceSide, setEntranceSide] = useState<'north' | 'east' | 'south' | 'west'>('south');
  const [startDepth, setStartDepth] = useState(24);
  const [endDepth, setEndDepth] = useState(24);
  const [elevatedHeight, setElevatedHeight] = useState(12);
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
      const footprint = {
        center: target,
        name: stationName.trim() || `Station ${state.stations.length + 1}`,
        widthMeters: defaultEngineeringConfiguration.stationWidthMeters,
        lengthMeters: defaultEngineeringConfiguration.stationLengthMeters,
      };
      return {
        kind: 'station',
        id: `subway-station-${state.stations.length + 1}`,
        mode: 'SUBWAY',
        elevationMeters: -stationDepth,
        footprint: { ...footprint, entrances: [stationEntranceCoordinate(footprint, entranceSide)] },
      };
    }
    if (!start) return undefined;
    return {
      kind: 'alignment',
      id: `${action === 'tunnel' ? 'subway-tunnel' : action === 'elevated' ? 'subway-elevated' : 'tram-guideway'}-${state.engineeringSegments.length + 1}`,
      mode: action === 'tunnel' || action === 'elevated' ? 'SUBWAY' : 'TRAM',
      geometry: [start, target],
      verticalProfile: action === 'tunnel' ? { startElevationMeters: -startDepth, endElevationMeters: -endDepth } : action === 'elevated' ? { startElevationMeters: elevatedHeight, endElevationMeters: elevatedHeight } : undefined,
    };
  }, [action, elevatedHeight, endDepth, entranceSide, start, startDepth, stationDepth, stationName, workflow]);

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
      setMessage(`Start set. Move across the map to preview the ${action === 'tunnel' ? 'tunnel' : action === 'elevated' ? 'elevated guideway' : 'tram alignment'}, then click its end.`);
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
    setMessage(`${action === 'station' ? 'Station' : action === 'tunnel' ? 'Tunnel' : action === 'elevated' ? 'Elevated guideway' : 'Tram alignment'} built for ${money.format(result.preview.evaluation.estimate.cost.total)}.`);
  };

  const undo = (): void => {
    const result = workflow.undo(timestampSeconds);
    if (!result.ok) { setMessage('There is no confirmed construction to undo in this session.'); return; }
    onEconomyChange();
    onOverlayChange(workflow.snapshot());
    setPreview(undefined);
    setStart(null);
    setEnd(null);
    setLocked(false);
    setMessage(`${result.description} ${money.format(result.refundedCents / 100)} returned to cash.`);
  };

  const grade = preview ? proposalGrade(preview) : undefined;
  const activeProjects = (workflow.snapshot().state.projects ?? []).filter((project) => project.completesAtSeconds > timestampSeconds);

  return <section className="construction-workflow" aria-label={`${mode.toLowerCase()} construction`}>
    <div className="construction-action-tabs" role="group" aria-label="Infrastructure action">
      {mode === 'SUBWAY'
        ? <>
          <button type="button" className={action === 'station' ? 'active' : ''} aria-pressed={action === 'station'} onClick={() => chooseAction('station')}>Station</button>
          <button type="button" className={action === 'tunnel' ? 'active' : ''} aria-pressed={action === 'tunnel'} onClick={() => chooseAction('tunnel')}>Tunnel</button>
          <button type="button" className={action === 'elevated' ? 'active' : ''} aria-pressed={action === 'elevated'} onClick={() => chooseAction('elevated')}>Elevated</button>
        </>
        : <button type="button" className="active" aria-pressed="true">Alignment</button>}
    </div>
    {action === 'station'
      ? <><label>Station name <input aria-label="Station name" value={stationName} onChange={(event) => setStationName(event.target.value)} /></label><label>Street entrance <select aria-label="Station entrance side" value={entranceSide} onChange={(event) => setEntranceSide(event.target.value as typeof entranceSide)}><option value="north">North side</option><option value="east">East side</option><option value="south">South side</option><option value="west">West side</option></select></label><DepthControl label="Station depth" value={stationDepth} onChange={setStationDepth} /><p className="builder-message">The circle on the map shows an approximate 800 m walk catchment. The gold square marks the street entrance.</p></>
      : action === 'tunnel'
        ? <div className="depth-pair"><DepthControl label="Start depth" value={startDepth} onChange={setStartDepth} /><DepthControl label="End depth" value={endDepth} onChange={setEndDepth} /></div>
        : action === 'elevated'
          ? <label className="depth-control"><span>Deck height: <strong>{elevatedHeight} m above street</strong></span><div><input aria-label="Elevated deck height slider" type="range" min="6" max="30" step="1" value={elevatedHeight} onChange={(event) => setElevatedHeight(Number(event.target.value))} /><input aria-label="Elevated deck height" type="number" min="6" max="30" step="1" value={elevatedHeight} onChange={(event) => setElevatedHeight(Number(event.target.value))} /></div></label>
        : <p className="builder-message">Tram guideway uses dedicated surface right-of-way. Click start and end points on the map.</p>}
    <p className="builder-message">{message}</p>
    {preview && <ProposalCard preview={preview} grade={grade} />}
    <div className="proposal-actions">
      <button type="button" className="secondary" onClick={() => resetProposal(action === 'station' ? 'Station proposal cancelled. Move over the map to preview another site.' : 'Alignment cancelled. Click the map to set a new start.')}>Cancel</button>
      <button type="button" disabled={!locked || !preview?.evaluation.valid || !preview.affordable} onClick={confirm}>Build</button>
      {preview && !preview.affordable && onViewLoans && <button type="button" className="secondary" onClick={onViewLoans}>View loans</button>}
    </div>
    <button type="button" className="secondary construction-undo" disabled={!workflow.snapshot().undoCount} onClick={undo}>Undo last build{workflow.snapshot().undoCount ? ` (${workflow.snapshot().undoCount})` : ''}</button>
    <div className="project-counts">
      <span><strong>{workflow.snapshot().state.stations.length}</strong> stations built</span>
      <span><strong>{workflow.snapshot().state.engineeringSegments.length}</strong> alignments built</span>
    </div>
    {activeProjects.length > 0 && <section className="active-construction-projects" aria-live="polite">
      <strong>Active construction</strong>
      <ul>{activeProjects.map((project) => {
        const stage = activeConstructionStage(project, timestampSeconds);
        const weeksLeft = Math.max(0, Math.ceil((project.completesAtSeconds - timestampSeconds) / (7 * 86_400)));
        return <li key={project.id}><span aria-hidden="true">●</span><div><strong>{project.kind === 'station' ? 'Station project' : 'Alignment project'} · {stage?.name ?? 'Commissioning'}</strong><small>{weeksLeft} week{weeksLeft === 1 ? '' : 's'} remaining. {project.disruption}</small></div></li>;
      })}</ul>
    </section>}
  </section>;
}
