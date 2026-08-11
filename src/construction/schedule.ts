import type { ConstructionEstimate, ConstructionProposal, ConstructionProjectStage } from './types';

export interface ConstructionSchedule {
  readonly weeks: number;
  readonly stages: readonly ConstructionProjectStage[];
  readonly disruption: string;
}

/** One shared, inspectable schedule used by both the proposal and the persisted project. */
export function scheduleConstruction(proposal: ConstructionProposal, estimate: ConstructionEstimate): ConstructionSchedule {
  const stationWeeks = proposal.kind === 'station' ? 20 : 0;
  const alignmentWeeks = proposal.kind === 'alignment'
    ? (proposal.mode === 'SUBWAY' ? Math.ceil(estimate.horizontalLengthMeters / 35) : Math.ceil(estimate.horizontalLengthMeters / 75))
    : 0;
  const weeks = Math.max(4, stationWeeks + alignmentWeeks + estimate.riverCrossingIds.length * 10 + estimate.demolitionImpacts.length * 2 + 4);
  const names = proposal.kind === 'station'
    ? ['Survey & acquire', 'Excavate platform', 'Fit out & test']
    : ['Survey & acquire', proposal.mode === 'SUBWAY' ? 'Bore / support tunnel' : 'Build guideway', 'Systems & commissioning'];
  const stageWeeks = Math.max(1, Math.ceil(weeks / names.length));
  const stages = names.map((name, index) => ({ name, startWeek: index * stageWeeks + 1, endWeek: index === names.length - 1 ? weeks : Math.min(weeks, (index + 1) * stageWeeks) }));
  const disruption = estimate.demolitionImpacts.length > 0
    ? `${estimate.demolitionImpacts.length} parcel acquisition${estimate.demolitionImpacts.length === 1 ? '' : 's'}; adjacent access is disrupted until commissioning.`
    : estimate.riverCrossingIds.length > 0
      ? 'Water-crossing protection and staged access restrict the crossing until commissioning.'
      : 'Construction is contained within the planned right-of-way.';
  return { weeks, stages, disruption };
}

export function activeConstructionStage(project: { readonly startsAtSeconds: number; readonly completesAtSeconds: number; readonly stages: readonly ConstructionProjectStage[] }, timestampSeconds: number): ConstructionProjectStage | undefined {
  if (timestampSeconds >= project.completesAtSeconds) return undefined;
  const elapsedWeek = Math.max(1, Math.floor((timestampSeconds - project.startsAtSeconds) / (7 * 86_400)) + 1);
  return project.stages.find((stage) => elapsedWeek >= stage.startWeek && elapsedWeek <= stage.endWeek) ?? project.stages.at(-1);
}
