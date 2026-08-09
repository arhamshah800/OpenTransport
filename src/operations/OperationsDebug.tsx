import type { SimulationEngine } from '../time';
import type { SimulationSnapshot } from '../time';
import { modeRegistry } from '../modes';
import { formatHeadwayLabel } from './fleetPlanning';

/** Developer inspection of the shared OperationsSimulation — never a second clock. */
export function OperationsDebug({ engine, snapshot }: { readonly engine: SimulationEngine; readonly snapshot: SimulationSnapshot }) {
  const ops = snapshot.operations;
  const services = engine.listLineServices();
  if (!ops || services.length === 0) {
    return <section className="operations-debug"><p className="eyebrow">OPERATIONS</p><h2>Dispatch inspector</h2><p className="debug-note">Create a transit line, then use the shared simulation clock.</p></section>;
  }
  return (
    <section className="operations-debug">
      <p className="eyebrow">OPERATIONS</p>
      <h2>Dispatch inspector</h2>
      <p className="debug-note">Period: {snapshot.servicePeriod === 'daytime' ? 'Day' : 'Night'} · Vehicles: {ops.vehicles.length} · Queued passengers: {Object.values(ops.queues).reduce((sum, queue) => sum + queue.length, 0)}</p>
      <ul className="network-list">
        {services.map((service) => {
          const vehicle = modeRegistry.getVehicleDefinition(service.vehicleTypeId);
          const running = ops.vehicles.filter((item) => item.lineId === service.lineId).length;
          return (
            <li key={service.lineId}>
              <strong>{service.lineId}</strong>
              <small>{service.active ? 'Active' : 'Stopped'} · {vehicle.name} · fleet {service.assignedVehicleCount} · in service {running} · day {formatHeadwayLabel(service.frequency.daytimeHeadwayMinutes)} / night {formatHeadwayLabel(service.frequency.nighttimeHeadwayMinutes)}</small>
            </li>
          );
        })}
      </ul>
      <dl>
        <dt>Boardings</dt><dd>{ops.statistics.boardings}</dd>
        <dt>Denied boardings</dt><dd>{ops.statistics.deniedBoardings}</dd>
        <dt>Unserved demand</dt><dd>{ops.statistics.unservedDemand}</dd>
        <dt>Average wait</dt><dd>{ops.statistics.boardings ? `${Math.round(ops.statistics.totalWaitSeconds / ops.statistics.boardings)}s` : '—'}</dd>
      </dl>
      {ops.warnings.map((warning) => <p className="debug-note" key={warning}>{warning}</p>)}
    </section>
  );
}
