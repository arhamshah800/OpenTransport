import { createLevelRegistry } from '../world/registry';
import { testCity } from './test-city';

export const levelRegistry = createLevelRegistry([{ summary: { id: testCity.metadata.id, name: testCity.metadata.name, description: testCity.metadata.description, approximatePopulation: testCity.metadata.approximatePopulation, bounds: testCity.bounds }, load: async () => testCity }]);
