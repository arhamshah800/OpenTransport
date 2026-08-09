import type { Coordinate } from '../world';

export type PopulationDisplayMode = 'hidden' | 'points' | 'density';
export type MapSelection =
  | { readonly kind: 'road'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'workplace'; readonly id: string }
  | { readonly kind: 'poi'; readonly id: string }
  | { readonly kind: 'station'; readonly id: string }
  | { readonly kind: 'line'; readonly id: string }
  | { readonly kind: 'vehicle'; readonly id: string }
  | { readonly kind: 'coordinate'; readonly coordinate: Coordinate }
  | null;
export interface TransitOverlay {
  readonly lines: readonly { readonly id: string; readonly geometry: readonly Coordinate[]; readonly color?: string }[];
  readonly stops: readonly { readonly id: string; readonly coordinate: Coordinate; readonly name?: string }[];
  readonly vehicles?: readonly {
    readonly id: string;
    readonly coordinate: Coordinate;
    readonly color?: string;
    readonly lineId?: string;
    readonly modeId?: string;
    readonly vehicleTypeId?: string;
  }[];
}
export interface MapLayerVisibility {
  readonly population: PopulationDisplayMode;
  readonly workplaces: boolean;
  readonly buildings: boolean;
  readonly pois: boolean;
  readonly water: boolean;
  readonly tripDemand: boolean;
  readonly unservedDemand: boolean;
  readonly roadIds: boolean;
  readonly buildingIds: boolean;
  readonly bounds: boolean;
}
export interface DemandOverlay {
  readonly activeOrigins: readonly { readonly id: string; readonly coordinate: Coordinate; readonly weight: number }[];
  readonly unservedOrigins: readonly { readonly id: string; readonly coordinate: Coordinate; readonly weight: number }[];
  readonly servedDestinations: readonly { readonly id: string; readonly coordinate: Coordinate; readonly weight: number }[];
}
export type MapLifecycleStatus = 'LOADING' | 'READY' | 'ERROR';
export interface MapDiagnostic { readonly initialized: boolean; readonly sourceCount: number; readonly expectedLayersLoaded: boolean; readonly zoom: number; readonly center: Coordinate; readonly levelBounds: import('../world').Bounds; }
export interface MapController {
  highlightBuilding(id: string | null): void;
  setPopulationMode(mode: PopulationDisplayMode): void;
  setLayerVisibility(layer: keyof Omit<MapLayerVisibility, 'population'>, visible: boolean): void;
  setTransitOverlay(overlay: TransitOverlay): void;
  setDemandOverlay(overlay: DemandOverlay): void;
  setConstructionOverlay?(overlay: import('../construction').ConstructionWorkflowSnapshot): void;
  coordinateFromScreen(x: number, y: number): Coordinate;
  resetCamera(): void;
  setPitchAndBearing(pitch: number, bearing: number): void;
  zoomBy(amount: number): void;
  destroy(): void;
}
