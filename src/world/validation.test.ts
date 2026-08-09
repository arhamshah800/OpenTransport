import { describe, expect, it } from 'vitest';
import { levelRegistry } from '../levels/manifest';
import { testCity } from '../levels/test-city';
import { LevelValidationError, validateLevel } from './index';
describe('World level system', () => {
  it('lists and successfully loads static cities into indexed runtime data', async () => {
    const ids = levelRegistry.listLevels().map(({ id }) => id);
    expect(ids).toContain('test-city');
    expect(ids).toContain('mini-city');
    expect(ids).toContain('boston-downtown');
    const world = await levelRegistry.loadLevel('test-city');
    const mini = await levelRegistry.loadLevel('mini-city');
    const boston = await levelRegistry.loadLevel('boston-downtown');
    expect(world.definition.roads).toHaveLength(28);
    expect(world.buildingsById.size).toBe(48);
    expect(mini.definition.metadata.name).toBe('Mini Junction');
    expect(boston.definition.metadata.name).toBe('Boston Downtown');
  });
  it('rejects malformed road geometry', () => { const level = { ...testCity, roads: testCity.roads.map((road, index) => index === 0 ? { ...road, geometry: [road.geometry[0]] } : road) }; expect(() => validateLevel(level)).toThrow(/at least two points/); });
  it('rejects duplicate IDs', () => { const level = { ...testCity, roads: testCity.roads.map((road, index) => index === 1 ? { ...road, id: testCity.roads[0].id } : road) }; expect(() => validateLevel(level)).toThrow(/duplicate road ID/); });
  it('rejects invalid references', () => { const level = { ...testCity, workplaces: testCity.workplaces.map((workplace, index) => index === 0 ? { ...workplace, buildingId: 'missing-building' } : workplace) }; expect(() => validateLevel(level)).toThrow(/references missing building/); });
  it('rejects invalid monetary values', () => { const level = { ...testCity, economy: { ...testCity.economy, startingBudget: -1 } }; expect(() => validateLevel(level)).toThrow(/nonnegative monetary value/); });
  it('rejects invalid metadata', () => { const level = { ...testCity, metadata: { ...testCity.metadata, version: 0 } }; expect(() => validateLevel(level)).toThrow(LevelValidationError); expect(() => validateLevel(level)).toThrow(/metadata is invalid/); });
});
