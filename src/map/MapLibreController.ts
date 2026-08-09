import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { World } from '../world';
import { createBaseSources, createTransitSource, createTransitStopsSource } from './layers';
import type { MapController, MapLayerVisibility, MapSelection, PopulationDisplayMode, TransitOverlay } from './types';

const sourceId = (name: string): string => `open-transport-${name}`;
const layerId = (name: string): string => `open-transport-${name}`;
const baseVisibility: MapLayerVisibility = { population: 'points', workplaces: true, pois: true, water: true, roadIds: false, buildingIds: false, bounds: false };
export interface MapLibreControllerOptions { readonly container: HTMLElement; readonly world: World; readonly onSelection: (selection: MapSelection) => void; readonly onCoordinate: (coordinate: { readonly latitude: number; readonly longitude: number }) => void; }

/** The only MapLibre-specific adapter. Other modules interact through MapController. */
export class MapLibreController implements MapController {
  private readonly map: MapLibreMap;
  private readonly world: World;
  private visibility = baseVisibility;
  private highlightedBuilding: string | null = null;
  public constructor(private readonly options: MapLibreControllerOptions) {
    this.world = options.world;
    this.map = new maplibregl.Map({ container: options.container, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf1ec' } }] }, center: [0, 0], zoom: 10, attributionControl: false });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    this.map.on('load', () => this.initialize());
  }
  private initialize(): void {
    for (const [name, data] of Object.entries(createBaseSources(this.world))) this.map.addSource(sourceId(name), { type: 'geojson', data, promoteId: 'id' });
    this.map.addSource(sourceId('transit'), { type: 'geojson', data: createTransitSource({ lines: [], stops: [] }) });
    this.map.addSource(sourceId('transit-stops'), { type: 'geojson', data: createTransitStopsSource({ lines: [], stops: [] }) });
    this.map.addLayer({ id: layerId('water'), type: 'line', source: sourceId('water'), paint: { 'line-color': '#4d97bd', 'line-width': 11, 'line-opacity': 0.72 } });
    this.map.addLayer({ id: layerId('buildings'), type: 'fill', source: sourceId('buildings'), paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f2b663', '#d4d6cf'], 'fill-opacity': .84 } });
    this.map.addLayer({ id: layerId('building-outline'), type: 'line', source: sourceId('buildings'), paint: { 'line-color': '#aeb5ac', 'line-width': 1 } });
    this.map.addLayer({ id: layerId('highways'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'highway'], paint: { 'line-color': '#43536b', 'line-width': 5 } });
    this.map.addLayer({ id: layerId('arterials'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'arterial'], paint: { 'line-color': '#667a76', 'line-width': 3.4 } });
    this.map.addLayer({ id: layerId('roads'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'local'], paint: { 'line-color': '#9aa69d', 'line-width': 1.4 } });
    this.map.addLayer({ id: layerId('population-density'), type: 'circle', source: sourceId('population'), paint: { 'circle-color': '#d97046', 'circle-opacity': .18, 'circle-radius': ['interpolate', ['linear'], ['get', 'residents'], 0, 7, 800, 28] } });
    this.map.addLayer({ id: layerId('population-points'), type: 'circle', source: sourceId('population'), paint: { 'circle-color': '#d97046', 'circle-opacity': .9, 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
    this.map.addLayer({ id: layerId('workplaces'), type: 'circle', source: sourceId('workplaces'), paint: { 'circle-color': '#285b85', 'circle-radius': ['interpolate', ['linear'], ['get', 'jobs'], 0, 4, 800, 16], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('pois'), type: 'circle', source: sourceId('pois'), paint: { 'circle-color': '#6c4c8c', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('road-ids'), type: 'symbol', source: sourceId('roads'), layout: { 'text-field': ['get', 'id'], 'text-size': 10, 'symbol-placement': 'line', 'text-keep-upright': true }, paint: { 'text-color': '#384841', 'text-halo-color': '#edf1ec', 'text-halo-width': 1.5 } });
    this.map.addLayer({ id: layerId('building-ids'), type: 'symbol', source: sourceId('buildings'), layout: { 'text-field': ['get', 'id'], 'text-size': 9 }, paint: { 'text-color': '#4d564e', 'text-halo-color': '#fffefa', 'text-halo-width': 1 } });
    this.map.addLayer({ id: layerId('bounds'), type: 'line', source: sourceId('bounds'), paint: { 'line-color': '#e17055', 'line-dasharray': [2, 2], 'line-width': 2 } });
    this.map.addLayer({ id: layerId('transit'), type: 'line', source: sourceId('transit'), paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': .9 } });
    this.map.addLayer({ id: layerId('transit-stops'), type: 'circle', source: sourceId('transit-stops'), paint: { 'circle-color': '#fffefa', 'circle-radius': 6, 'circle-stroke-color': '#ef6c45', 'circle-stroke-width': 3 } });
    this.bindInteractions(); this.applyVisibility(); this.resetCamera();
  }
  private bindInteractions(): void {
    const clickable: ReadonlyArray<[string, Exclude<MapSelection, null>['kind']]> = [[layerId('roads'), 'road'], [layerId('arterials'), 'road'], [layerId('highways'), 'road'], [layerId('buildings'), 'building'], [layerId('workplaces'), 'workplace'], [layerId('pois'), 'poi']];
    for (const [layer, kind] of clickable) this.map.on('click', layer, (event) => { const id = event.features?.[0]?.properties?.id; if (typeof id === 'string') { if (kind === 'building') this.highlightBuilding(id); this.options.onSelection({ kind, id } as Exclude<MapSelection, null>); } });
    this.map.on('click', (event) => this.options.onCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    for (const [layer] of clickable) { this.map.on('mouseenter', layer, () => { this.map.getCanvas().style.cursor = 'pointer'; }); this.map.on('mouseleave', layer, () => { this.map.getCanvas().style.cursor = ''; }); }
  }
  public highlightBuilding(id: string | null): void { if (!this.map.isStyleLoaded()) return; if (this.highlightedBuilding) this.map.setFeatureState({ source: sourceId('buildings'), id: this.highlightedBuilding }, { selected: false }); this.highlightedBuilding = id; if (id) this.map.setFeatureState({ source: sourceId('buildings'), id }, { selected: true }); }
  public setPopulationMode(mode: PopulationDisplayMode): void { this.visibility = { ...this.visibility, population: mode }; this.applyVisibility(); }
  public setLayerVisibility(layer: keyof Omit<MapLayerVisibility, 'population'>, visible: boolean): void { this.visibility = { ...this.visibility, [layer]: visible }; this.applyVisibility(); }
  private applyVisibility(): void { if (!this.map.isStyleLoaded()) return; const visible = (id: string, value: boolean): void => { this.map.setLayoutProperty(layerId(id), 'visibility', value ? 'visible' : 'none'); }; visible('population-points', this.visibility.population === 'points'); visible('population-density', this.visibility.population === 'density'); visible('workplaces', this.visibility.workplaces); visible('pois', this.visibility.pois); visible('water', this.visibility.water); visible('road-ids', this.visibility.roadIds); visible('building-ids', this.visibility.buildingIds); visible('bounds', this.visibility.bounds); }
  public setTransitOverlay(overlay: TransitOverlay): void { const lines = this.map.getSource(sourceId('transit')); if (lines instanceof maplibregl.GeoJSONSource) lines.setData(createTransitSource(overlay)); const stops = this.map.getSource(sourceId('transit-stops')); if (stops instanceof maplibregl.GeoJSONSource) stops.setData(createTransitStopsSource(overlay)); }
  public resetCamera(): void { const { southWest, northEast } = this.world.definition.bounds; this.map.fitBounds([[southWest.longitude, southWest.latitude], [northEast.longitude, northEast.latitude]], { padding: 56, duration: 450 }); }
  public destroy(): void { this.map.remove(); }
}
