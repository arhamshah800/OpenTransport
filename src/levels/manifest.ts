import { createLevelRegistry } from '../world/registry';
import { testCity } from './test-city';
import { miniCity } from './mini-city';

const entry = (level: typeof testCity) => ({ summary: { id: level.metadata.id, name: level.metadata.name, description: level.metadata.description, approximatePopulation: level.metadata.approximatePopulation, bounds: level.bounds }, load: async () => level });
export const levelRegistry = createLevelRegistry([entry(testCity), entry(miniCity)]);
