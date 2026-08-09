import { distanceMeters } from '../map/geometry';
import { TransitGraph } from './graph';
import { TransitNetwork } from './TransitNetwork';
import type { Coordinate } from '../world';
import type { TransitEdge, TransitStop } from './types';

export function getStopsNearCoordinate(network: TransitNetwork, coordinate: Coordinate, radiusMeters: number): readonly TransitStop[] { return network.definition.stops.filter((stop) => distanceMeters(stop.coordinate, coordinate) <= radiusMeters).sort((a, b) => a.id.localeCompare(b.id)); }
export function getLinesServingStop(network: TransitNetwork, stopId: string): readonly string[] { return new TransitGraph(network).linesServingStop(stopId); }
export function getConnectedTransitEdges(network: TransitNetwork, stopId: string): readonly TransitEdge[] { return new TransitGraph(network).neighbors(stopId); }
