import { describe, expect, it } from 'vitest';
import { levelRegistry } from '../levels/manifest';
import { testCity } from '../levels/test-city';
import { LevelValidationError, validateLevel } from './index';
describe('World level system', () => {
  it('lists and successfully loads the test city into indexed runtime data', async () => { expect(levelRegistry.listLevels().map(({ id }) => id)).toEqual(['test-city']); const world = await levelRegistry.loadLevel('test-city'); expect(world.definition.roads).toHaveLength(28); expect(world.buildingsById.size).toBe(48); });
  it('rejects malformed road geometry', () => { const level = { ...testCity, roads: testCity.roads.map((road, index) => index === 0 ? { ...road, geometry: [road.geometry[0]] } : road) }; expect(() => validateLevel(level)).toThrow(/at least two points/); });
  it('rejects duplicate IDs', () => { const level = { ...testCity, roads: testCity.roads.map((road, index) => index === 1 ? { ...road, id: testCity.roads[0].id } : road) }; expect(() => validateLevel(level)).toThrow(/duplicate road ID/); });
  it('rejects invalid references', () => { const level = { ...testCity, workplaces: testCity.workplaces.map((workplace, index) => index === 0 ? { ...workplace, buildingId: 'missing-building' } : workplace) }; expect(() => validateLevel(level)).toThrow(/references missing building/); });
  it('rejects invalid monetary values', () => { const level = { ...testCity, economy: { ...testCity.economy, startingBudget: -1 } }; expect(() => validateLevel(level)).toThrow(/nonnegative monetary value/); });
  it('rejects invalid metadata', () => { const level = { ...testCity, metadata: { ...testCity.metadata, version: 0 } }; expect(() => validateLevel(level)).toThrow(LevelValidationError); expect(() => validateLevel(level)).toThrow(/metadata is invalid/); });
});
