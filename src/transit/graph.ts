import { distanceMeters } from '../map/geometry';
import { TransitNetwork } from './TransitNetwork';
import type { TransitEdge } from './types';

export class TransitGraph {
  private readonly edges: readonly TransitEdge[];
  public constructor(private readonly network: TransitNetwork, transferThresholdMeters = 150) { const service = network.definition.lines.flatMap((line) => line.segments.flatMap((segment) => { const a = network.getStop(segment.startStopId); const b = network.getStop(segment.endStopId); return a && b ? [{ fromStopId: a.id, toStopId: b.id, kind: 'service' as const, distanceMeters: distanceMeters(a.coordinate, b.coordinate), lineId: line.id }, ...(line.direction === 'bidirectional' ? [{ fromStopId: b.id, toStopId: a.id, kind: 'service' as const, distanceMeters: distanceMeters(a.coordinate, b.coordinate), lineId: line.id }] : [])] : []; })); const transfer = network.definition.stops.flatMap((a, index) => network.definition.stops.slice(index + 1).flatMap((b) => { const sharedComplex = Boolean(a.parentComplexId && a.parentComplexId === b.parentComplexId); const distance = distanceMeters(a.coordinate, b.coordinate); return sharedComplex || distance <= transferThresholdMeters ? [{ fromStopId: a.id, toStopId: b.id, kind: 'transfer' as const, distanceMeters: distance }, { fromStopId: b.id, toStopId: a.id, kind: 'transfer' as const, distanceMeters: distance }] : []; })); this.edges = [...service, ...transfer]; }
  public neighbors(stopId: string): readonly TransitEdge[] { return this.edges.filter((edge) => edge.fromStopId === stopId).sort((a, b) => a.toStopId.localeCompare(b.toStopId)); }
  public transfers(stopId: string): readonly TransitEdge[] { return this.neighbors(stopId).filter((edge) => edge.kind === 'transfer'); }
  public linesServingStop(stopId: string): readonly string[] { return this.network.definition.lines.filter((line) => line.stopIds.includes(stopId)).map((line) => line.id).sort(); }
  public directlyConnected(a: string, b: string): boolean { return this.neighbors(a).some((edge) => edge.toStopId === b && edge.kind === 'service'); }
  public componentFor(stopId: string): readonly string[] { const visited = new Set<string>(); const queue = [stopId]; while (queue.length) { const id = queue.shift()!; if (visited.has(id)) continue; visited.add(id); this.neighbors(id).forEach((edge) => { if (!visited.has(edge.toStopId)) queue.push(edge.toStopId); }); } return [...visited].sort(); }
}
