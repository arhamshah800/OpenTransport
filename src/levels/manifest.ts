import { createLevelRegistry } from '../world/registry';

export const levelRegistry = createLevelRegistry([
  {
    summary: { id: 'boston-downtown', name: 'Boston Downtown', description: 'A dense historic core with narrow streets and concentrated demand.', approximatePopulation: 684_000, bounds: { southWest: { latitude: 42.34, longitude: -71.12 }, northEast: { latitude: 42.39, longitude: -71.03 } } },
    load: async () => (await import('./boston-downtown')).bostonDowntown,
  },
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
  {
    summary: { id: 'mini-city', name: 'Havenport', description: 'A compact waterfront city that rewards clear connections.', approximatePopulation: 92_000, bounds: { southWest: { latitude: 37.75, longitude: -122.48 }, northEast: { latitude: 37.81, longitude: -122.40 } } },
    load: async () => (await import('./mini-city')).miniCity,
  },
  {
    summary: { id: 'test-city', name: 'Northgate', description: 'A dense fixture city for testing future network ideas.', approximatePopulation: 218_000, bounds: { southWest: { latitude: 41.84, longitude: -87.67 }, northEast: { latitude: 41.90, longitude: -87.60 } } },
    load: async () => (await import('./test-city')).testCity,
  },
]);
