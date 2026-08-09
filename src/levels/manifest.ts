import { createLevelRegistry } from '../world/registry';
import { bostonDowntown } from './boston-downtown';
import { miniCity } from './mini-city';
import { testCity } from './test-city';

const entry = (level: any) => ({
  summary: {
    id: level.metadata.id,
    name: level.metadata.name,
    description: level.metadata.description,
    approximatePopulation: level.metadata.approximatePopulation,
    bounds: level.bounds
  },
  load: async () => level
});

export const levelRegistry = createLevelRegistry([
  entry(bostonDowntown),
  entry(miniCity),
  entry(testCity)
]);
