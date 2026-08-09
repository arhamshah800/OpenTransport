import type { Coordinate } from '../world';

export enum ResidentState { AtHome = 'AT_HOME', RequestingRoute = 'REQUESTING_ROUTE', Traveling = 'TRAVELING', AtDestination = 'AT_DESTINATION', ReturnPending = 'RETURN_PENDING' }
export type TripPurpose = 'work' | 'activity' | 'return';
export type TravelRequestStatus = 'unresolved' | 'assumedAlternativeMode';
export interface Resident { readonly id: string; readonly simulationWeight: number; readonly home: Coordinate; readonly homePopulationRecordId: string; readonly workplaceId?: string; readonly workplaceCoordinate?: Coordinate; readonly activityPoiId?: string; readonly activityCoordinate?: Coordinate; readonly outboundDepartureMinute: number; readonly returnDepartureMinute: number; readonly dailyPurpose: Exclude<TripPurpose, 'return'>; readonly state: ResidentState; readonly currentDestination?: Coordinate; }
export interface TravelRequest { readonly id: string; readonly residentId: string; readonly origin: Coordinate; readonly destination: Coordinate; readonly desiredDepartureMinute: number; readonly purpose: TripPurpose; readonly status: TravelRequestStatus; }
export interface PopulationGenerationOptions { readonly seed: number; readonly targetAgentCount?: number; readonly employmentRate?: number; readonly activityRate?: number; }
export interface SimulationContext { readonly absoluteMinutes: number; }
export interface PopulationSummary { readonly absoluteMinutes: number; readonly atHome: number; readonly requestingRoute: number; readonly atDestination: number; readonly activeRequests: number; readonly returnTripsPending: number; }
export interface DemandBucket { readonly key: string; readonly coordinate: Coordinate; readonly representedPeople: number; }
