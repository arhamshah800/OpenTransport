import type { Coordinate } from '../world';

export type PopulationDisplayMode = 'hidden' | 'points' | 'density';
export type MapSelection =
  | { readonly kind: 'road'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'workplace'; readonly id: string }
  | { readonly kind: 'poi'; readonly id: string }
  | { readonly kind: 'coordinate'; readonly coordinate: Coordinate }
  | null;
export interface TransitOverlay { readonly lines: readonly { readonly id: string; readonly geometry: readonly Coordinate[]; readonly color?: string }[]; readonly stops: readonly { readonly id: string; readonly coordinate: Coordinate; readonly name?: string }[]; readonly vehicles?: readonly { readonly id: string; readonly coordinate: Coordinate; readonly color?: string }[]; }
export interface MapLayerVisibility { readonly population: PopulationDisplayMode; readonly workplaces: boolean; readonly pois: boolean; readonly water: boolean; readonly roadIds: boolean; readonly buildingIds: boolean; readonly bounds: boolean; }
export interface MapController { highlightBuilding(id: string | null): void; setPopulationMode(mode: PopulationDisplayMode): void; setLayerVisibility(layer: keyof Omit<MapLayerVisibility, 'population'>, visible: boolean): void; setTransitOverlay(overlay: TransitOverlay): void; coordinateFromScreen(x: number, y: number): Coordinate; resetCamera(): void; destroy(): void; }
