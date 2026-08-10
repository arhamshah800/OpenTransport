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
  {
    summary: {
      id: 'dallas',
      name: 'Dallas',
      description: 'Build a new transit network across the Dallas side of the Metroplex, from DFW Airport and Love Field through Downtown, Plano, Frisco, Garland, Mesquite, DeSoto, and the Trinity River corridor.',
      approximatePopulation: 4_762_858,
      bounds: { southWest: { latitude: 32.58, longitude: -97.12 }, northEast: { latitude: 33.24, longitude: -96.42 } },
    },
    // Generated city packages are intentionally lazy: selecting Dallas, rather than
    // visiting the city picker, pays the cost of parsing its static GIS-derived data.
    load: async () => (await import('./generated/dallas')).dallas,
  },
  entry(miniCity),
  entry(testCity)
]);
