import type { DemandBucket, PopulationSummary, TravelRequest } from './types';
import type { PopulationSimulation } from './PopulationSimulation';

export function aggregateRequestsByEndpoint(requests: readonly TravelRequest[], endpoint: 'origin' | 'destination'): readonly DemandBucket[] { const buckets = new Map<string, DemandBucket>(); for (const request of requests.filter((item) => item.status === 'unresolved')) { const coordinate = request[endpoint]; const key = `${coordinate.latitude.toFixed(4)},${coordinate.longitude.toFixed(4)}`; const prior = buckets.get(key); buckets.set(key, { key, coordinate, representedPeople: (prior?.representedPeople ?? 0) + 1 }); } return [...buckets.values()]; }
export function summarizeDemand(simulation: PopulationSimulation): PopulationSummary { return simulation.summary(); }
