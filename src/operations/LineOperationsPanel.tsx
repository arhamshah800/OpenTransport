import { useState } from 'react';
import { modeRegistry } from '../modes';
import { setLineActive, type TransitNetwork } from '../transit';
import { lineDisplayColor } from '../transit/lineStyle';
import type { SimulationEngine } from '../time';
import type { SimulationSnapshot } from '../time';
import { estimateRequiredVehicles, estimateSupportedHeadwayMinutes, formatHeadwayLabel } from './fleetPlanning';
import type { LineServiceConfiguration } from './types';

const HEADWAY_PRESETS = [5, 6, 8, 10, 12, 15, 20, 25, 30, 45, 60] as const;
const MAX_HEADWAY_MINUTES = 120;
const MAX_VEHICLES = 40;

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function clampHeadway(value: number, minimum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(MAX_HEADWAY_MINUTES, Math.max(minimum, Math.round(value)));
}

/** Player-facing controls for an existing OperationsSimulation configuration. */
export function LineOperationsPanel({
  network,
  lineId,
  engine,
  snapshot,
  onSnapshot,
  onNetwork,
  onPurchaseVehicle,
}: {
  readonly network: TransitNetwork;
  readonly lineId: string;
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly onNetwork?: (network: TransitNetwork) => void;
  readonly onPurchaseVehicle?: (vehicleId: string, purchaseCost: number) => boolean;
}) {
  const [fleetMessage, setFleetMessage] = useState<string>();
  const line = network.getLine(lineId);
  if (!line) return null;

  const mode = modeRegistry.getModeDefinition(line.mode);
  const minimum = mode.operations.minimumHeadwayMinutes;
  const vehicles = modeRegistry.getVehicleDefinitionsForMode(line.mode);
  const existing = engine.getLineService(lineId);
  const configuration: LineServiceConfiguration = existing ?? {
    lineId: line.id,
    active: true,
    vehicleTypeId: mode.vehicleIds[0],
    assignedVehicleCount: 2,
    frequency: {
      ...mode.operations.defaultFrequency,
      daytimeHeadwayMinutes: line.serviceSettings?.plannedHeadwayMinutes ?? mode.operations.defaultFrequency.daytimeHeadwayMinutes,
    },
  };

  const apply = (next: LineServiceConfiguration): void => {
    try {
      if (next.active && !line.active && onNetwork) onNetwork(setLineActive(network, line.id, true));
      engine.configureLineService(next);
      onSnapshot(engine.snapshot());
    } catch {
      onSnapshot(engine.snapshot());
    }
  };

  const update = (partial: Partial<LineServiceConfiguration> | { frequency: Partial<LineServiceConfiguration['frequency']> }): void => {
    const frequency = 'frequency' in partial && partial.frequency
      ? { ...configuration.frequency, ...partial.frequency }
      : configuration.frequency;
    const next: LineServiceConfiguration = {
      ...configuration,
      ...partial,
      frequency: {
        ...frequency,
        daytimeHeadwayMinutes: clampHeadway(frequency.daytimeHeadwayMinutes, minimum),
        nighttimeHeadwayMinutes: clampHeadway(frequency.nighttimeHeadwayMinutes, minimum),
      },
    };
    apply(next);
  };

  const vehicle = modeRegistry.getVehicleDefinition(configuration.vehicleTypeId);
  const ops = snapshot.operations;
  const lineVehicles = ops?.vehicles.filter((item) => item.lineId === line.id) ?? [];
  const ridership = lineVehicles.reduce((sum, item) => sum + item.passengers.length, 0);
  const capacity = lineVehicles.reduce((sum, item) => sum + modeRegistry.getVehicleDefinition(item.vehicleTypeId).capacity, 0);
  const lineStats = ops?.statistics.byLine[line.id];
  const boardings = lineStats?.boardings ?? 0;
  const averageWait = boardings > 0 ? Math.round((lineStats?.totalWaitSeconds ?? 0) / boardings) : null;
  const hour = snapshot.calendar.hour;
  const currentHeadway = hour >= configuration.frequency.daytimeStartHour && hour < configuration.frequency.nighttimeStartHour
    ? configuration.frequency.daytimeHeadwayMinutes
    : configuration.frequency.nighttimeHeadwayMinutes;
  const supported = estimateSupportedHeadwayMinutes(network, line.id, configuration.vehicleTypeId, configuration.assignedVehicleCount);
  const requiredVehicles = estimateRequiredVehicles(network, line.id, configuration.vehicleTypeId, currentHeadway);
  const fleetShortfall = configuration.active && configuration.assignedVehicleCount > 0 && supported > currentHeadway;
  const operatingCostCents = lineVehicles.reduce((sum, item) => sum + Math.round(modeRegistry.getVehicleDefinition(item.vehicleTypeId).operatingCostPerHour * 100), 0);
  const fareRevenue = snapshot.finances.lines.find((item) => item.lineId === line.id)?.fareRevenueCents ?? 0;
  const lineOperatingCost = snapshot.finances.lines.find((item) => item.lineId === line.id)?.operatingCostCents ?? 0;
  const lineWarnings = (ops?.warnings ?? []).filter((warning) => warning.includes(line.id) || warning.startsWith('Requested:'));
  const serviceRunning = configuration.active && line.active;
  const disruption = configuration.disruption && configuration.disruption.untilSeconds > snapshot.timestampSeconds ? configuration.disruption : undefined;
  const depotBays = Math.max(1, Math.ceil(configuration.assignedVehicleCount / 10));
  const dailyMaintenance = configuration.assignedVehicleCount * Math.round(modeRegistry.getVehicleDefinition(configuration.vehicleTypeId).operatingCostPerHour * 2.5);

  const headwayOptions = (selected: number) => {
    const values = [...new Set([...HEADWAY_PRESETS.filter((value) => value >= minimum), selected, minimum])].sort((a, b) => a - b);
    return values.map((value) => <option key={value} value={value}>{formatHeadwayLabel(value)}</option>);
  };

  return (
    <section className="line-operations" aria-label="Line operations">
      <p className="eyebrow">OPERATIONS</p>
      <h3>{line.name}</h3>
      <dl className="operations-summary">
        <dt>Mode</dt><dd>{mode.name}</dd>
        <dt>Service status</dt><dd>{disruption ? `Paused: ${disruption.kind} recovery` : serviceRunning ? 'Running' : !line.active ? 'Stopped: topology inactive' : 'Stopped'}</dd>
        <dt>Current period</dt><dd>{snapshot.servicePeriod === 'daytime' ? 'Day service' : 'Night service'} · {formatHeadwayLabel(currentHeadway)}</dd>
        <dt>Assigned vehicle type</dt><dd>{vehicle.name}</dd>
        <dt>Vehicles assigned</dt><dd>{configuration.assignedVehicleCount}</dd>
        <dt>Vehicles required (est.)</dt><dd>{Number.isFinite(requiredVehicles) ? requiredVehicles : '—'}</dd>
        <dt>In service now</dt><dd>{lineVehicles.length}</dd>
        <dt>Current ridership</dt><dd>{ridership}{capacity ? ` / ${capacity}` : ''}</dd>
        <dt>Average wait</dt><dd>{averageWait === null ? '—' : `${averageWait}s`}</dd>
        <dt>Boardings (line)</dt><dd>{boardings}</dd>
        <dt>Operating cost</dt><dd>{money.format(operatingCostCents / 100)}/hr active · {money.format(lineOperatingCost / 100)} recorded</dd>
        <dt>Depot capacity required</dt><dd>{depotBays} bay{depotBays === 1 ? '' : 's'} for assigned fleet</dd>
        <dt>Est. fleet maintenance</dt><dd>{money.format(dailyMaintenance)}/day</dd>
        <dt>Fare revenue</dt><dd>{money.format(fareRevenue / 100)} recorded</dd>
      </dl>

      <div className="proposal-actions">
        <button type="button" onClick={() => update({ active: !configuration.active })}>
          {configuration.active ? 'Stop Service' : 'Start Service'}
        </button>
        {!line.active && onNetwork && (
          <button type="button" className="secondary" onClick={() => onNetwork(setLineActive(network, line.id, true))}>Activate topology</button>
        )}
      </div>
      <p className="debug-note">Start Service enables dispatch and keeps topology active. Stop Service ends new dispatching; moving vehicles finish their current direction.</p>
      <div className="proposal-actions" aria-label="Disruption and recovery controls">
        {disruption ? <button type="button" className="secondary" onClick={() => update({ disruption: undefined })}>Restore service now</button> : <>
          <button type="button" className="secondary" onClick={() => update({ disruption: { kind: 'signal', untilSeconds: snapshot.timestampSeconds + 30 * 60 } })}>Signal issue · 30 min</button>
          <button type="button" className="secondary" onClick={() => update({ disruption: { kind: 'construction', untilSeconds: snapshot.timestampSeconds + 2 * 3600 } })}>Construction closure · 2 hr</button>
        </>}
      </div>
      {disruption && <p className="operations-warning" role="status">No new vehicles dispatch until Day {Math.floor(disruption.untilSeconds / 86_400) + 1}, {String(Math.floor((disruption.untilSeconds / 3600) % 24)).padStart(2, '0')}:{String(Math.floor((disruption.untilSeconds / 60) % 60)).padStart(2, '0')}. Vehicles on the affected line are held and appear red on the map until recovery.</p>}

      <label>Ticket fare (USD)
        <div className="input-with-unit">
          <input
            aria-label="Ticket fare"
            type="number"
            step="0.05"
            min="0.00"
            max="20.00"
            value={((configuration.customFareCents ?? mode.operations.defaultFare.fareCents) / 100).toFixed(2)}
            onChange={(event) => {
              const val = Number(event.target.value);
              const cents = Math.round(val * 100);
              update({ customFareCents: Number.isFinite(cents) && cents >= 0 ? cents : undefined });
            }}
          />
        </div>
      </label>

      <label>Daytime headway
        <select aria-label="Daytime headway" value={configuration.frequency.daytimeHeadwayMinutes} onChange={(event) => update({ frequency: { daytimeHeadwayMinutes: Number(event.target.value) } })}>
          {headwayOptions(configuration.frequency.daytimeHeadwayMinutes)}
        </select>
      </label>
      <label>Or enter daytime minutes
        <input aria-label="Daytime headway minutes" type="number" min={minimum} max={MAX_HEADWAY_MINUTES} value={configuration.frequency.daytimeHeadwayMinutes} onChange={(event) => update({ frequency: { daytimeHeadwayMinutes: Number(event.target.value) } })} />
      </label>

      <label>Nighttime headway
        <select aria-label="Nighttime headway" value={configuration.frequency.nighttimeHeadwayMinutes} onChange={(event) => update({ frequency: { nighttimeHeadwayMinutes: Number(event.target.value) } })}>
          {headwayOptions(configuration.frequency.nighttimeHeadwayMinutes)}
        </select>
      </label>
      <label>Or enter nighttime minutes
        <input aria-label="Nighttime headway minutes" type="number" min={minimum} max={MAX_HEADWAY_MINUTES} value={configuration.frequency.nighttimeHeadwayMinutes} onChange={(event) => update({ frequency: { nighttimeHeadwayMinutes: Number(event.target.value) } })} />
      </label>

      <label>Vehicle type
        <select aria-label="Vehicle type" value={configuration.vehicleTypeId} onChange={(event) => update({ vehicleTypeId: event.target.value })}>
          {vehicles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.capacity} seats</option>)}
        </select>
      </label>

      <label>Vehicles assigned
        <input aria-label="Vehicles assigned" type="number" min={0} max={MAX_VEHICLES} value={configuration.assignedVehicleCount} onChange={(event) => update({ assignedVehicleCount: Math.min(MAX_VEHICLES, Math.max(0, Math.round(Number(event.target.value) || 0))) })} />
      </label>
      {onPurchaseVehicle && <button type="button" className="secondary" disabled={configuration.assignedVehicleCount >= MAX_VEHICLES} onClick={() => { if (onPurchaseVehicle(vehicle.id, vehicle.purchaseCost)) { update({ assignedVehicleCount: configuration.assignedVehicleCount + 1 }); setFleetMessage(`${vehicle.name} purchased and assigned.`); } else setFleetMessage(`Insufficient cash to purchase ${vehicle.name} for ${money.format(vehicle.purchaseCost)}.`); }}>Buy & assign {vehicle.name} · {money.format(vehicle.purchaseCost)}</button>}
      {fleetMessage && <p className="debug-note" role="status">{fleetMessage}</p>}

      {fleetShortfall && (
        <p className="operations-warning" role="status">
          Requested: {formatHeadwayLabel(currentHeadway)}. Available fleet supports: {formatHeadwayLabel(supported)}.
        </p>
      )}
      {lineWarnings.map((warning) => <p className="operations-warning" key={warning}>{warning}</p>)}
      <p className="debug-note" style={{ borderLeftColor: lineDisplayColor(line) }}>Minimum headway for {mode.name}: {formatHeadwayLabel(minimum)}. Vehicles shuttle both directions; fleet support is a planning estimate.</p>
    </section>
  );
}
