import { useEffect, useState } from 'react';
import type { Coordinate, World } from '../world';
import { ConstructionPanel, type ConstructionOverlayState } from '../construction/ConstructionPanel';
import type { ConstructionWorkflow } from '../construction';
import type { ConstructionState } from '../construction';
import { TransitNetwork } from '../transit';
import { GuidewayLinePanel } from '../transit/GuidewayLinePanel';
import type { TransitOverlay } from './types';
import type { SimulationEngine, SimulationSnapshot } from '../time';

export function GuidewayWorkspace({
  mode, world, network, construction, workflow, coordinate, clickVersion, hoverCoordinate, timestampSeconds, active,
  onOverlayChange, onEconomyChange, onNetwork, onTransitOverlay, selectedLineId, onSelectLine, engine, snapshot, onSnapshot,
  phase: controlledPhase, onPhaseChange, onCommitSuccess, onViewLoans,
  onPurchaseVehicle,
}: {
  readonly mode: 'TRAM' | 'SUBWAY';
  readonly world: World;
  readonly network: TransitNetwork;
  readonly construction: ConstructionState;
  readonly workflow: ConstructionWorkflow;
  readonly coordinate: Coordinate | null;
  readonly clickVersion: number;
  readonly hoverCoordinate: Coordinate | null;
  readonly timestampSeconds: number;
  readonly active: boolean;
  readonly onOverlayChange: (overlay: ConstructionOverlayState) => void;
  readonly onEconomyChange: () => void;
  readonly onNetwork: (network: TransitNetwork) => void;
  readonly onTransitOverlay: (overlay: TransitOverlay) => void;
  readonly selectedLineId: string | null;
  readonly onSelectLine: (lineId: string | null) => void;
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly phase?: 'construct' | 'service';
  readonly onPhaseChange?: (phase: 'construct' | 'service') => void;
  readonly onCommitSuccess?: (estimate: { readonly riverCrossingIds: readonly string[] }) => void;
  readonly onViewLoans?: () => void;
  readonly onPurchaseVehicle?: (lineId: string, vehicleId: string, purchaseCost: number) => boolean;
}) {
  const [internalPhase, setInternalPhase] = useState<'construct' | 'service'>(selectedLineId ? 'service' : 'construct');
  const phase = controlledPhase ?? internalPhase;
  const setPhase = (next: 'construct' | 'service'): void => {
    onPhaseChange?.(next);
    if (controlledPhase === undefined) setInternalPhase(next);
  };

  useEffect(() => {
    if (selectedLineId) {
      setPhase('service');
      return;
    }
    // Mode change without a selection returns to infrastructure building.
    setPhase('construct');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to mode / selection identity
  }, [mode, selectedLineId]);

  return (
    <section className="guideway-workspace">
      <div className="construction-action-tabs" role="group" aria-label={`${mode} workflow phase`}>
        <button
          type="button"
          className={phase === 'construct' ? 'active' : ''}
          aria-pressed={phase === 'construct'}
          onClick={() => { setPhase('construct'); onSelectLine(null); }}
        >
          Build infrastructure
        </button>
        <button
          type="button"
          className={phase === 'service' ? 'active' : ''}
          aria-pressed={phase === 'service'}
          onClick={() => setPhase('service')}
        >
          Create {mode === 'TRAM' ? 'tram' : 'subway'} line
        </button>
      </div>
      {phase === 'construct'
        ? (
          <ConstructionPanel
            mode={mode}
            workflow={workflow}
            coordinate={coordinate}
            clickVersion={clickVersion}
            hoverCoordinate={hoverCoordinate}
            timestampSeconds={timestampSeconds}
            active={active && phase === 'construct'}
            onOverlayChange={onOverlayChange}
            onEconomyChange={onEconomyChange}
            onCommitSuccess={onCommitSuccess}
            onViewLoans={onViewLoans}
          />
        )
        : (
          <GuidewayLinePanel
            mode={mode}
            world={world}
            network={network}
            construction={construction}
            coordinate={coordinate}
            clickVersion={clickVersion}
            hoverCoordinate={hoverCoordinate}
            active={active && phase === 'service'}
            onNetwork={onNetwork}
            onOverlay={onTransitOverlay}
            selectedLineId={selectedLineId}
            onSelectLine={onSelectLine}
            engine={engine}
            snapshot={snapshot}
            onSnapshot={onSnapshot}
            onPurchaseVehicle={onPurchaseVehicle}
          />
        )}
    </section>
  );
}
