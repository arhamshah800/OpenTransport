import type { CommandResult, PlannerCommand, PlannerSession, Route, Station, TransportMode } from './types';

const palette: Record<TransportMode, string> = { bus: '#f4a340', tram: '#b98aff', subway: '#41c6b2' };
export const makeId = (kind: string): string => `${kind}-${crypto.randomUUID().slice(0, 8)}`;
export const seedSession = (cityId: string, cityName: string): PlannerSession => ({
  version: 1, cityId, cityName, cash: 1280000, clock: 8 * 60 + 15, speed: 1, score: 582,
  routes: [{ id: 'route-harbor', name: 'Harbor Loop', mode: 'tram', color: '#b98aff', stops: ['station-civic', 'station-market'], visible: true, vehicles: 4, headway: 9, capacity: 220, status: 'healthy' }],
  stations: [{ id: 'station-civic', name: 'Civic Center', x: 47, y: 43, accessibility: true }, { id: 'station-market', name: 'Market Street', x: 65, y: 56, accessibility: true }],
  projects: [], alerts: [{ id: 'alert-welcome', message: 'Demand is growing around Civic Center.', severity: 'info' }],
  camera: { zoom: 1, tilt: 0, x: 0, y: 0 }, overlays: { demand: false, ridership: false, coverage: false, congestion: false, unserved: false },
  tutorial: { dismissed: false, current: 0, completed: [] }, updatedAt: Date.now()
});
export const newRoute = (mode: TransportMode): Route => ({ id: makeId('route'), name: `New ${mode[0].toUpperCase()}${mode.slice(1)} Line`, mode, color: palette[mode], stops: [], visible: true, vehicles: 2, headway: 12, capacity: mode === 'bus' ? 70 : mode === 'tram' ? 180 : 600, status: 'healthy' });
export const newStation = (x: number, y: number): Station => ({ id: makeId('station'), name: 'New station', x, y, accessibility: true });
const stamp = (session: PlannerSession, changes: Partial<PlannerSession>): PlannerSession => ({ ...session, ...changes, updatedAt: Date.now() });
export function dispatch(session: PlannerSession, command: PlannerCommand): CommandResult {
  if (command.type === 'route.create') { if (!command.route.name.trim()) return { ok: false, code: 'validation', message: 'A route needs a name.' }; return { ok: true, session: stamp(session, { routes: [...session.routes, command.route], selectedId: command.route.id }) }; }
  if (command.type === 'station.create') { if (!Number.isFinite(command.station.x) || !Number.isFinite(command.station.y)) return { ok: false, code: 'validation', message: 'Station location is invalid.' }; return { ok: true, session: stamp(session, { stations: [...session.stations, command.station], selectedId: command.station.id }) }; }
  if (command.type === 'route.delete') return { ok: true, session: stamp(session, { routes: session.routes.filter((r) => r.id !== command.id), selectedId: session.selectedId === command.id ? undefined : session.selectedId }) };
  if (command.type === 'station.delete') return { ok: true, session: stamp(session, { stations: session.stations.filter((s) => s.id !== command.id), routes: session.routes.map((r) => ({ ...r, stops: r.stops.filter((id) => id !== command.id) })) }) };
  if (command.type === 'route.update') { const found = session.routes.some((r) => r.id === command.id); if (!found) return { ok: false, code: 'not-found', message: 'That route no longer exists.' }; return { ok: true, session: stamp(session, { routes: session.routes.map((r) => r.id === command.id ? { ...r, ...command.changes } : r) }) }; }
  if (command.type === 'project.create') { if (command.project.cost > session.cash) return { ok: false, code: 'funds', message: 'There is not enough cash for this project.' }; return { ok: true, session: stamp(session, { projects: [...session.projects, command.project], selectedId: command.project.id }) }; }
  if (command.type === 'project.confirm') return { ok: true, session: stamp(session, { projects: session.projects.map((p) => p.id === command.id ? { ...p, status: 'building' } : p), cash: session.cash - (session.projects.find((p) => p.id === command.id)?.cost ?? 0) }) };
  if (command.type === 'select') return { ok: true, session: stamp(session, { selectedId: command.id }) };
  if (command.type === 'camera.set') return { ok: true, session: stamp(session, { camera: command.camera }) };
  if (command.type === 'overlay.toggle') return { ok: true, session: stamp(session, { overlays: { ...session.overlays, [command.overlay]: !session.overlays[command.overlay] } }) };
  if (command.type === 'clock.set') return { ok: true, session: stamp(session, { speed: command.speed }) };
  return { ok: true, session: stamp(session, { tutorial: command.tutorial }) };
}
export const scoreParts = (session: PlannerSession): { label: string; value: number }[] => [{ label: 'Coverage', value: session.stations.length * 46 }, { label: 'Service', value: session.routes.reduce((n, r) => n + r.vehicles * 18, 0) }, { label: 'Budget', value: Math.round(session.cash / 10000) }];
