import type { DemandBucket, PopulationSummary, TravelRequest, TravelRequestStatus } from './types';
import type { PopulationSimulation } from './PopulationSimulation';

const bucketKey = (coordinate: { readonly latitude: number; readonly longitude: number }): string =>
  `${coordinate.latitude.toFixed(4)},${coordinate.longitude.toFixed(4)}`;

export function aggregateRequestsByEndpoint(
  requests: readonly TravelRequest[],
  endpoint: 'origin' | 'destination',
  statuses: readonly TravelRequestStatus[] = ['unresolved', 'inTransit'],
): readonly DemandBucket[] {
  const allowed = new Set(statuses);
  const buckets = new Map<string, DemandBucket>();
  for (const request of requests.filter((item) => allowed.has(item.status))) {
    const coordinate = request[endpoint];
    const key = bucketKey(coordinate);
    const prior = buckets.get(key);
    buckets.set(key, { key, coordinate, representedPeople: (prior?.representedPeople ?? 0) + 1 });
  }
  return [...buckets.values()];
}

export function summarizeDemand(simulation: PopulationSimulation): PopulationSummary {
  return simulation.summary();
}
