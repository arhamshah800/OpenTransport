import type { Economy } from '../economy';
import type { World } from '../world';
import { ConstructionEngine } from './ConstructionEngine';
import type { ConstructionEvaluation, ConstructionProposal, ConstructionState } from './types';

const emptyConstructionState = (): ConstructionState => ({ demolishedBuildingIds: [], engineeringSegments: [], stations: [] });

export interface ConstructionPreview {
  readonly proposal: ConstructionProposal;
  readonly evaluation: ConstructionEvaluation;
  readonly cashCents: number;
  readonly cashAfterCents: number;
  readonly affordable: boolean;
}

export interface ConstructionWorkflowSnapshot {
  readonly state: ConstructionState;
  readonly pending?: ConstructionPreview;
}

export type ConstructionCommitResult =
  | { readonly ok: true; readonly state: ConstructionState; readonly preview: ConstructionPreview }
  | { readonly ok: false; readonly reason: 'NO_PROPOSAL' | 'INVALID' | 'UNAFFORDABLE'; readonly state: ConstructionState; readonly preview?: ConstructionPreview };

/** Application boundary for non-mutating previews and all-or-nothing construction confirmation. */
export class ConstructionWorkflow {
  private readonly engine: ConstructionEngine;
  private state: ConstructionState;
  private pending?: ConstructionPreview;

  public constructor(world: World, private readonly economy: Economy, initialState: ConstructionState = emptyConstructionState()) {
    this.engine = new ConstructionEngine(world);
    this.state = initialState;
  }

  public preview(proposal: ConstructionProposal): ConstructionPreview {
    const evaluation = this.engine.evaluate(proposal, this.state);
    const cashCents = this.economy.getCurrentCash();
    const totalCents = Math.round(evaluation.estimate.cost.total * 100);
    this.pending = { proposal, evaluation, cashCents, cashAfterCents: cashCents - totalCents, affordable: this.economy.canAfford(totalCents) };
    return this.pending;
  }

  public cancel(): ConstructionWorkflowSnapshot {
    this.pending = undefined;
    return this.snapshot();
  }

  public confirm(timestampSeconds: number): ConstructionCommitResult {
    if (!this.pending) return { ok: false, reason: 'NO_PROPOSAL', state: this.state };

    // Revalidate against the current infrastructure state immediately before spending.
    const preview = this.preview(this.pending.proposal);
    if (!preview.evaluation.valid || !preview.evaluation.plan) return { ok: false, reason: 'INVALID', state: this.state, preview };
    if (!preview.affordable) return { ok: false, reason: 'UNAFFORDABLE', state: this.state, preview };

    // Compute the next immutable infrastructure state first. Only publish it after the
    // economy accepts the complete estimate, so a failed transaction cannot half-build.
    const nextState = this.engine.commit(preview.evaluation.plan, this.state);
    if (!this.economy.recordConstruction(preview.evaluation.estimate, timestampSeconds, preview.proposal.id)) {
      return { ok: false, reason: 'UNAFFORDABLE', state: this.state, preview: this.preview(preview.proposal) };
    }
    this.state = nextState;
    this.pending = undefined;
    return { ok: true, state: this.state, preview };
  }

  public snapshot(): ConstructionWorkflowSnapshot { return { state: this.state, pending: this.pending }; }
}
