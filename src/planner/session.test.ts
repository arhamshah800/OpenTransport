import { describe, expect, it } from 'vitest';
import { dispatch, newRoute, newStation, seedSession } from './session';

describe('planner command dispatcher', () => {
  it('creates and updates routes through validated commands', () => {
    const session = seedSession('demo', 'Demo');
    const created = dispatch(session, { type: 'route.create', route: newRoute('bus') });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = dispatch(created.session, { type: 'route.update', id: created.session.selectedId!, changes: { vehicles: 8 } });
    expect(updated.ok && updated.session.routes.at(-1)?.vehicles).toBe(8);
  });
  it('rejects unaffordable construction without changing the snapshot', () => {
    const session = seedSession('demo', 'Demo');
    const result = dispatch(session, { type: 'project.create', project: { id: 'x', label: 'Too much', cost: 9000000, status: 'draft' } });
    expect(result).toMatchObject({ ok: false, code: 'funds' });
  });
  it('keeps station coordinates in the immutable renderable session', () => {
    const session = seedSession('demo', 'Demo');
    const result = dispatch(session, { type: 'station.create', station: newStation(24, 68) });
    expect(result.ok && result.session.stations.at(-1)).toMatchObject({ x: 24, y: 68 });
  });
  it('changes only the requested overlay flag', () => {
    const session = seedSession('demo', 'Demo');
    const result = dispatch(session, { type: 'overlay.toggle', overlay: 'demand' });
    expect(result.ok && result.session.overlays).toEqual({ demand: true, ridership: false, coverage: false, congestion: false, unserved: false });
  });
});
