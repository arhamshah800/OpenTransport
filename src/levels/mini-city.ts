import type { LevelDefinition } from '../world';
import { testCity } from './test-city';

/** Small static fixture proving new cities require data plus a manifest entry, never engine conditionals. */
export const miniCity: LevelDefinition = { ...testCity, metadata: { id: 'mini-city', name: 'Mini Junction', description: 'A minimal fixture city used to verify level isolation.', version: 1, approximatePopulation: 540 }, roads: testCity.roads.slice(0, 3), buildings: testCity.buildings.slice(0, 4), population: testCity.population.slice(0, 2), workplaces: testCity.workplaces.slice(0, 2).map(({ buildingId: _buildingId, ...workplace }) => workplace), pointsOfInterest: testCity.pointsOfInterest.slice(0, 1).map(({ buildingId: _buildingId, ...poi }) => poi), waterways: [], landmarks: [], economy: { startingBudget: 2_000_000, currency: 'USD' } };
