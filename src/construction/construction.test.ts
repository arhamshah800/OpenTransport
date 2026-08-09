import { describe, expect, it } from 'vitest';
import { testCity } from '../levels/test-city';
import { World } from '../world';
import { ConstructionEngine } from './ConstructionEngine';
import { ConstructionWorkflow } from './ConstructionWorkflow';
import { playerIssueMessage, proposalGrade } from './ConstructionProposalUI';
import { Economy } from '../economy';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });
const world = new World(testCity); const engine = new ConstructionEngine(world);
describe('Construction & Engineering System', () => {
  it('identifies building demolition but does not mutate source data before commit', () => { const proposal = { kind: 'station' as const, id: 'central', mode: 'SUBWAY' as const, elevationMeters: -20, footprint: { center: point(41.8698, -87.6404), widthMeters: 150, lengthMeters: 150 } }; const evaluation = engine.evaluate(proposal); expect(evaluation.valid).toBe(true); expect(evaluation.estimate.demolitionImpacts.length).toBeGreaterThan(0); expect(world.definition.buildings).toHaveLength(48); const state = engine.commit(evaluation.plan!); expect(state.demolishedBuildingIds).toEqual(evaluation.plan!.demolishedBuildingIds); expect(world.definition.buildings).toHaveLength(48); });
  it('makes deeper subway infrastructure cost more', () => { const shallow = engine.evaluate({ kind: 'station', id: 'shallow', mode: 'SUBWAY', elevationMeters: -10, footprint: { center: point(41.88, -87.62), widthMeters: 28, lengthMeters: 140 } }); const deep = engine.evaluate({ kind: 'station', id: 'deep', mode: 'SUBWAY', elevationMeters: -30, footprint: { center: point(41.88, -87.62), widthMeters: 28, lengthMeters: 140 } }); expect(deep.estimate.cost.total).toBeGreaterThan(shallow.estimate.cost.total); });
  it('rejects excessive grades and validates clear tunnel crossings', () => { const steep = engine.evaluate({ kind: 'alignment', id: 'steep', mode: 'SUBWAY', geometry: [point(41.87, -87.64), point(41.8701, -87.64)], verticalProfile: { startElevationMeters: -10, endElevationMeters: -30 } }); expect(steep.valid).toBe(false); expect(steep.issues[0].code).toBe('EXCESSIVE_GRADE'); const first = engine.evaluate({ kind: 'alignment', id: 'a', mode: 'SUBWAY', geometry: [point(41.871, -87.627), point(41.875, -87.623)], verticalProfile: { startElevationMeters: -14, endElevationMeters: -14 } }); const state = engine.commit(first.plan!); const collision = engine.evaluate({ kind: 'alignment', id: 'b', mode: 'SUBWAY', geometry: [point(41.873, -87.627), point(41.873, -87.621)], verticalProfile: { startElevationMeters: -17, endElevationMeters: -17 } }, state); expect(collision.issues.some((issue) => issue.code === 'INSUFFICIENT_TUNNEL_CLEARANCE')).toBe(true); const clear = engine.evaluate({ kind: 'alignment', id: 'c', mode: 'SUBWAY', geometry: [point(41.873, -87.627), point(41.873, -87.621)], verticalProfile: { startElevationMeters: -24, endElevationMeters: -24 } }, state); expect(clear.valid).toBe(true); });
  it('detects river crossings, requires depth, and costs tram versus bus correctly', () => { const crossing = { kind: 'alignment' as const, id: 'river', mode: 'SUBWAY' as const, geometry: [point(41.872, -87.633), point(41.872, -87.625)], verticalProfile: { startElevationMeters: -20, endElevationMeters: -20 } }; const invalid = engine.evaluate(crossing); expect(invalid.issues.some((issue) => issue.code === 'INSUFFICIENT_RIVER_DEPTH')).toBe(true); const valid = engine.evaluate({ ...crossing, verticalProfile: { startElevationMeters: -24, endElevationMeters: -24 } }); expect(valid.estimate.riverCrossingIds).toContain('junction-river'); expect(valid.estimate.cost.riverEngineering).toBeGreaterThan(0); const tram = engine.evaluate({ kind: 'alignment', id: 'tram', mode: 'TRAM', geometry: [point(41.87, -87.64), point(41.871, -87.64)] }); const bus = engine.evaluate({ kind: 'alignment', id: 'bus', mode: 'BUS', geometry: testCity.roads[0].geometry }); expect(tram.estimate.cost.total).toBeGreaterThan(0); expect(bus.valid).toBe(true); expect(bus.estimate.cost.total).toBe(0); });
});

describe('player construction workflow', () => {
  const station = { kind: 'station' as const, id: 'workflow-station', mode: 'SUBWAY' as const, elevationMeters: -24, footprint: { center: point(41.8699, -87.6404), widthMeters: 28, lengthMeters: 140 } };

  it('cancels a preview without changing money, demolition, or infrastructure', () => {
    const economy = new Economy(25_000_000); const workflow = new ConstructionWorkflow(world, economy); const ledgerBefore = economy.getLedger();
    const preview = workflow.preview(station); expect(preview.evaluation.estimate.demolitionImpacts.length).toBeGreaterThan(0);
    workflow.cancel();
    expect(workflow.snapshot()).toEqual({ state: { demolishedBuildingIds: [], engineeringSegments: [], stations: [] }, pending: undefined });
    expect(economy.getLedger()).toEqual(ledgerBefore);
  });

  it('rejects an unaffordable station and leaves all state unchanged', () => {
    const economy = new Economy(1); const workflow = new ConstructionWorkflow(world, economy); workflow.preview(station);
    const result = workflow.confirm(100);
    expect(result).toMatchObject({ ok: false, reason: 'UNAFFORDABLE' });
    expect(workflow.snapshot().state.stations).toHaveLength(0); expect(workflow.snapshot().state.demolishedBuildingIds).toHaveLength(0);
    expect(economy.getCurrentCash()).toBe(100); expect(economy.getLedger()).toHaveLength(1);
  });

  it('commits demolition, infrastructure, and the economy transaction together', () => {
    const economy = new Economy(25_000_000); const workflow = new ConstructionWorkflow(world, economy); const preview = workflow.preview(station); const cashBefore = economy.getCurrentCash();
    const result = workflow.confirm(100);
    expect(result.ok).toBe(true); expect(workflow.snapshot().state.stations).toHaveLength(1);
    expect(workflow.snapshot().state.demolishedBuildingIds).toEqual(preview.evaluation.estimate.demolitionImpacts.map((impact) => impact.buildingId));
    expect(economy.getCurrentCash()).toBe(cashBefore - Math.round(preview.evaluation.estimate.cost.total * 100));
  });

  it('surfaces slope and river rules in live tunnel previews', () => {
    const workflow = new ConstructionWorkflow(world, new Economy(100_000_000));
    const slope = workflow.preview({ kind: 'alignment', id: 'slope', mode: 'SUBWAY', geometry: [point(41.87, -87.64), point(41.8701, -87.64)], verticalProfile: { startElevationMeters: -10, endElevationMeters: -30 } });
    expect(slope.evaluation.issues.some((issue) => issue.code === 'EXCESSIVE_GRADE')).toBe(true);
    const river = workflow.preview({ kind: 'alignment', id: 'river-preview', mode: 'SUBWAY', geometry: [point(41.872, -87.633), point(41.872, -87.625)], verticalProfile: { startElevationMeters: -24, endElevationMeters: -24 } });
    expect(river.evaluation.valid).toBe(true); expect(river.evaluation.estimate.riverCrossingIds).toContain('junction-river'); expect(river.evaluation.estimate.cost.riverEngineering).toBeGreaterThan(0);
  });

  it('leaves a failed invalid commit unchanged', () => {
    const economy = new Economy(100_000_000); const workflow = new ConstructionWorkflow(world, economy); const cashBefore = economy.getCurrentCash();
    workflow.preview({ kind: 'alignment', id: 'invalid', mode: 'SUBWAY', geometry: [point(41.87, -87.64), point(41.8701, -87.64)], verticalProfile: { startElevationMeters: -10, endElevationMeters: -30 } });
    expect(workflow.confirm(100)).toMatchObject({ ok: false, reason: 'INVALID' });
    expect(workflow.snapshot().state.engineeringSegments).toHaveLength(0); expect(economy.getCurrentCash()).toBe(cashBefore); expect(economy.getLedger()).toHaveLength(1);
  });

  it('exposes demolition, slope, and river costs for the player proposal UI', () => {
    const workflow = new ConstructionWorkflow(world, new Economy(100_000_000));
    const stationPreview = workflow.preview(station);
    expect(stationPreview.evaluation.estimate.demolitionImpacts.length).toBeGreaterThan(0);
    expect(stationPreview.evaluation.estimate.cost.demolition).toBeGreaterThan(0);
    expect(stationPreview.evaluation.estimate.cost.depthSurcharge).toBeGreaterThan(0);
    expect(stationPreview.cashAfterCents).toBe(stationPreview.cashCents - Math.round(stationPreview.evaluation.estimate.cost.total * 100));

    const slope = workflow.preview({ kind: 'alignment', id: 'ui-slope', mode: 'SUBWAY', geometry: [point(41.87, -87.64), point(41.8701, -87.64)], verticalProfile: { startElevationMeters: -10, endElevationMeters: -30 } });
    const grade = proposalGrade(slope)!;
    expect(playerIssueMessage('EXCESSIVE_GRADE', grade)).toMatch(/^Grade \d+\.\d% exceeds maximum 4\.0%\.$/);
    expect(playerIssueMessage('INSUFFICIENT_TUNNEL_CLEARANCE')).toBe('Tunnel conflicts with existing tunnel. Increase or decrease depth.');

    const river = workflow.preview({ kind: 'alignment', id: 'ui-river', mode: 'SUBWAY', geometry: [point(41.872, -87.633), point(41.872, -87.625)], verticalProfile: { startElevationMeters: -20, endElevationMeters: -20 } });
    expect(playerIssueMessage('INSUFFICIENT_RIVER_DEPTH')).toContain('24 m underground');
    expect(river.evaluation.estimate.cost.riverEngineering).toBeGreaterThan(0);
  });
});
