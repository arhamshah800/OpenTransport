/** Immutable, serialized geographic source data for one playable city. */
export interface Coordinate { readonly latitude: number; readonly longitude: number; }
export interface Bounds { readonly southWest: Coordinate; readonly northEast: Coordinate; }
export interface LevelMetadata { readonly id: string; readonly name: string; readonly description: string; readonly version: number; readonly approximatePopulation?: number; }
export type RoadClass = 'local' | 'arterial' | 'highway';
/** Data-driven distinction between freeway mainlines and surface/frontage roads. */
export interface Road { readonly id: string; readonly name?: string; readonly geometry: readonly Coordinate[]; readonly classification: RoadClass; readonly speedKph?: number; readonly busStopEligible?: boolean; }
export interface Building { readonly id: string; readonly footprint: readonly Coordinate[]; readonly acquisitionValue: number; readonly category?: string; readonly displayName?: string; }
export interface PopulationRecord { readonly id: string; readonly coordinate: Coordinate; readonly residents: number; readonly buildingId?: string; }
export interface Workplace { readonly id: string; readonly coordinate: Coordinate; readonly jobs: number; readonly buildingId?: string; readonly displayName?: string; }
export interface PointOfInterest { readonly id: string; readonly category: string; readonly coordinate: Coordinate; readonly attractionWeight?: number; readonly buildingId?: string; readonly displayName?: string; }
export interface Waterway { readonly id: string; readonly geometry: readonly Coordinate[]; readonly kind: 'river' | 'lake' | 'canal'; readonly stationProhibited?: boolean; }
export interface Landmark { readonly id: string; readonly name: string; readonly coordinate: Coordinate; readonly buildingId?: string; }
export interface StartingEconomy { readonly startingBudget: number; readonly currency: string; }
export interface ConstructionParameters { readonly roadRightOfWayCostPerMeter?: number; readonly undergroundCostMultiplier?: number; }
export interface LevelDefinition {
  readonly metadata: LevelMetadata; readonly bounds: Bounds; readonly roads: readonly Road[]; readonly buildings: readonly Building[];
  readonly population: readonly PopulationRecord[]; readonly workplaces: readonly Workplace[]; readonly pointsOfInterest: readonly PointOfInterest[];
  readonly waterways: readonly Waterway[]; readonly landmarks: readonly Landmark[]; readonly economy: StartingEconomy; readonly construction?: ConstructionParameters;
}
export interface LevelSummary { readonly id: string; readonly name: string; readonly description: string; readonly approximatePopulation?: number; readonly bounds: Bounds; }
