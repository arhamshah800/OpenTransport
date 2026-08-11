import { defaultEngineeringConfiguration } from './config';
import { scheduleConstruction } from './schedule';
import type { ConstructionPreview } from './ConstructionWorkflow';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const meters = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatMoney(value: number): string { return money.format(value); }

export function DepthControl({ label, value, onChange }: { readonly label: string; readonly value: number; readonly onChange: (value: number) => void }) {
  const set = (next: number): void => onChange(Math.max(4, Math.min(60, Number.isFinite(next) ? next : value)));
  return <label className="depth-control"><span>{label}: <strong>{value} m underground</strong></span><div><input aria-label={`${label} slider`} type="range" min="4" max="60" step="1" value={value} onChange={(event) => set(Number(event.target.value))} /><input aria-label={`${label} in metres`} type="number" min="4" max="60" step="1" value={value} onChange={(event) => set(Number(event.target.value))} /></div></label>;
}

export function proposalGrade(preview: ConstructionPreview): number | undefined {
  if (preview.proposal.kind !== 'alignment' || !preview.proposal.verticalProfile || preview.evaluation.estimate.horizontalLengthMeters <= 0) return undefined;
  return Math.abs(preview.proposal.verticalProfile.endElevationMeters - preview.proposal.verticalProfile.startElevationMeters) / preview.evaluation.estimate.horizontalLengthMeters;
}

/** Transparent, deliberately coarse planning schedule—not a hidden simulation timer. */
export function constructionSchedule(preview: ConstructionPreview) { return scheduleConstruction(preview.proposal, preview.evaluation.estimate); }

export function playerIssueMessage(code: string, grade?: number): string {
  if (code === 'EXCESSIVE_GRADE') return `Grade ${((grade ?? 0) * 100).toFixed(1)}% exceeds maximum ${(defaultEngineeringConfiguration.maxSubwayGrade * 100).toFixed(1)}%.`;
  if (code === 'INSUFFICIENT_TUNNEL_CLEARANCE') return 'Tunnel conflicts with existing tunnel. Increase or decrease depth.';
  if (code === 'INSUFFICIENT_RIVER_DEPTH') return `River crossing requires at least ${Math.abs(defaultEngineeringConfiguration.riverMinimumElevationMeters)} m underground.`;
  if (code === 'INVALID_GEOMETRY') return 'Choose a different end point to create a usable alignment.';
  if (code === 'BUS_OFF_ROAD') return 'Bus routes must follow existing roads.';
  return 'This proposal does not meet the current engineering rules.';
}

export function ProposalCard({ preview, grade }: { readonly preview: ConstructionPreview; readonly grade?: number }) {
  const { evaluation } = preview; const cost = evaluation.estimate.cost;
  const ready = evaluation.valid && preview.affordable;
  const schedule = constructionSchedule(preview);
  return <section className={`proposal-card ${ready ? 'valid' : 'invalid'}`} aria-live="polite">
    <header><strong>{ready ? 'Ready to build' : 'Action required'}</strong><span>{money.format(cost.total)}</span></header>
    <dl>
      {preview.proposal.kind === 'alignment' && <>
        <dt>Distance</dt><dd>{meters.format(evaluation.estimate.horizontalLengthMeters)} m</dd>
        {preview.proposal.verticalProfile && <>
          <dt>Start depth</dt><dd>{Math.abs(preview.proposal.verticalProfile.startElevationMeters)} m underground</dd>
          <dt>End depth</dt><dd>{Math.abs(preview.proposal.verticalProfile.endElevationMeters)} m underground</dd>
          <dt>Grade</dt><dd>{((grade ?? 0) * 100).toFixed(1)}%</dd>
          <dt>Maximum grade</dt><dd>{(defaultEngineeringConfiguration.maxSubwayGrade * 100).toFixed(1)}%</dd>
        </>}
      </>}
      <dt>Base construction</dt><dd>{money.format(cost.baseInfrastructure)}</dd>
      {cost.demolition > 0 && <><dt>Acquisition / demolition</dt><dd>{money.format(cost.demolition)}</dd></>}
      {cost.depthSurcharge > 0 && <><dt>Depth engineering</dt><dd>{money.format(cost.depthSurcharge)}</dd></>}
      {evaluation.estimate.riverCrossingIds.length > 0 && <><dt>Water crossing</dt><dd>{evaluation.estimate.riverCrossingIds.length} · {money.format(cost.riverEngineering)}</dd></>}
      <dt>Affected buildings</dt><dd>{evaluation.estimate.demolitionImpacts.length}</dd>
      <dt>Current cash</dt><dd>{money.format(preview.cashCents / 100)}</dd>
      <dt>Cash after build</dt><dd className={preview.affordable ? '' : 'expense'}>{money.format(preview.cashAfterCents / 100)}</dd>
      <dt>Estimated delivery</dt><dd>{schedule.weeks} weeks</dd>
    </dl>
    <div className="construction-stages"><strong>Construction stages</strong><ol>{schedule.stages.map((stage, index) => <li key={stage.name}><span>{index + 1}</span>{stage.name} · weeks {stage.startWeek}–{stage.endWeek}</li>)}</ol><p>{schedule.disruption}</p></div>
    {evaluation.estimate.riverCrossingIds.length > 0 && <p className={`proposal-note ${cost.riverEngineering > 0 ? 'river' : ''}`}>River engineering adds {money.format(cost.riverEngineering)}. Keep both ends at least {Math.abs(defaultEngineeringConfiguration.riverMinimumElevationMeters)} m underground.</p>}
    {evaluation.estimate.demolitionImpacts.length > 0 && <details className="affected-buildings"><summary>Affected parcels ({evaluation.estimate.demolitionImpacts.length})</summary><ul>{evaluation.estimate.demolitionImpacts.map((impact) => <li key={impact.buildingId}><span>{impact.buildingId}</span><strong>{money.format(impact.cost)}</strong></li>)}</ul></details>}
    {!preview.affordable && <p className="proposal-issue">This project is unaffordable with current cash.</p>}
    {evaluation.issues.map((issue) => <p className="proposal-issue" key={issue.code}>{playerIssueMessage(issue.code, grade)}</p>)}
  </section>;
}

export function ConstructionCostChip({ preview, pointer }: { readonly preview?: ConstructionPreview; readonly pointer: { readonly x: number; readonly y: number } | null }) {
  if (!preview || !pointer) return null;
  const ready = preview.evaluation.valid && preview.affordable;
  const river = preview.evaluation.estimate.riverCrossingIds.length > 0;
  const demolitions = preview.evaluation.estimate.demolitionImpacts.length;
  return <aside className={`construction-cost-chip ${ready ? 'valid' : 'invalid'}`} style={{ left: pointer.x + 16, top: pointer.y + 16 }} aria-hidden="true">
    <strong>{formatMoney(preview.evaluation.estimate.cost.total)}</strong>
    <span>{ready ? 'Affordable' : preview.affordable ? 'Needs revision' : 'Unaffordable'}</span>
    {demolitions > 0 && <small>{demolitions} building{demolitions === 1 ? '' : 's'} affected</small>}
    {river && <small>River +{formatMoney(preview.evaluation.estimate.cost.riverEngineering)}</small>}
  </aside>;
}
