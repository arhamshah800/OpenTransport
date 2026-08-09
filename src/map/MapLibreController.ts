import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { World } from '../world';
import { createBaseSources, createDemandSource, createTransitSource, createTransitStopsSource, createTransitVehiclesSource } from './layers';
import type { DemandOverlay, MapController, MapDiagnostic, MapLayerVisibility, MapLifecycleStatus, MapSelection, PopulationDisplayMode, TransitOverlay } from './types';

const sourceId = (name: string): string => `open-transport-${name}`;
const layerId = (name: string): string => `open-transport-${name}`;
const baseVisibility: MapLayerVisibility = { population: 'points', workplaces: true, buildings: true, pois: true, water: true, tripDemand: false, unservedDemand: false, roadIds: false, buildingIds: false, bounds: false };

const requiredLayerNames = ['water', 'buildings', 'building-outline', 'highways', 'arterials', 'roads', 'population-points', 'workplaces', 'pois'] as const;
const requiredSourceNames = ['roads', 'buildings', 'water', 'population', 'workplaces', 'pois', 'bounds'] as const;
export interface MapLibreControllerOptions { readonly container: HTMLElement; readonly world: World; readonly onSelection: (selection: MapSelection) => boolean | void; readonly onCoordinate: (coordinate: { readonly latitude: number; readonly longitude: number }) => void; readonly onLifecycle: (status: MapLifecycleStatus, message?: string, diagnostic?: MapDiagnostic) => void; }

/** The only MapLibre-specific adapter. Other modules interact through MapController. */
export class MapLibreController implements MapController {
  private readonly map: MapLibreMap;
  private readonly world: World;
  private visibility = baseVisibility;
  private highlightedBuilding: string | null = null;
  private transitOverlay: TransitOverlay = { lines: [], stops: [] };
  private initialized = false;
  private destroyed = false;
  private readyTimer: number | undefined;
  private readonly resizeObserver: ResizeObserver;
  private readonly handleContainerClick = (event: MouseEvent): void => {
    // Fallback when the map style has not finished loading; ignore once MapLibre owns clicks.
    if (this.initialized) return;
    const bounds = this.options.container.getBoundingClientRect();
    this.options.onCoordinate(this.coordinateFromScreen(event.clientX - bounds.left, event.clientY - bounds.top));
  };
  public constructor(private readonly options: MapLibreControllerOptions) {
    this.world = options.world;
    this.map = new maplibregl.Map({ container: options.container, style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': 'rgba(0, 0, 0, 0)' } }] }, center: [0, 0], zoom: 10, attributionControl: false });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    options.container.addEventListener('click', this.handleContainerClick);
    this.resizeObserver = new ResizeObserver(() => { if (!this.destroyed) this.map.resize(); });
    this.resizeObserver.observe(options.container);
    this.map.on('load', () => this.initialize());
    this.map.on('idle', () => this.confirmReady());
    this.map.on('moveend', () => this.publishDiagnostic());
    this.map.on('error', (event) => this.fail(event.error?.message ?? 'MapLibre reported a rendering error.'));
    this.readyTimer = window.setTimeout(() => this.fail('Timed out waiting for the city geometry layers to become ready.'), 8_000);
    options.onLifecycle('LOADING');
  }
  private initialize(): void {
    try {
    for (const [name, data] of Object.entries(createBaseSources(this.world))) this.map.addSource(sourceId(name), { type: 'geojson', data, promoteId: 'id' });
    this.map.addSource(sourceId('transit'), { type: 'geojson', data: createTransitSource(this.transitOverlay) });
    this.map.addSource(sourceId('transit-stops'), { type: 'geojson', data: createTransitStopsSource(this.transitOverlay) });
    this.map.addSource(sourceId('transit-vehicles'), { type: 'geojson', data: createTransitVehiclesSource(this.transitOverlay) });
    this.map.addSource(sourceId('demand-active'), { type: 'geojson', data: createDemandSource([]) });
    this.map.addSource(sourceId('demand-unserved'), { type: 'geojson', data: createDemandSource([]) });
    this.map.addSource(sourceId('demand-served'), { type: 'geojson', data: createDemandSource([]) });
    this.map.addLayer({ id: layerId('water'), type: 'line', source: sourceId('water'), paint: { 'line-color': '#4d97bd', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 15], 'line-opacity': 0.82 } });
    this.map.addLayer({ id: layerId('buildings'), type: 'fill', source: sourceId('buildings'), paint: { 'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f2b663', '#d9ddd5'], 'fill-opacity': .92 } });
    this.map.addLayer({ id: layerId('building-outline'), type: 'line', source: sourceId('buildings'), paint: { 'line-color': '#aeb5ac', 'line-width': 1 } });
    this.map.addLayer({ id: layerId('highways'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'highway'], paint: { 'line-color': '#43536b', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8] } });
    this.map.addLayer({ id: layerId('arterials'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'arterial'], paint: { 'line-color': '#667a76', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5] } });
    this.map.addLayer({ id: layerId('roads'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'local'], paint: { 'line-color': '#8e9b92', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.25, 15, 2.5] } });
    this.map.addLayer({ id: layerId('population-density'), type: 'circle', source: sourceId('population'), paint: { 'circle-color': '#d97046', 'circle-opacity': .18, 'circle-radius': ['interpolate', ['linear'], ['get', 'residents'], 0, 7, 800, 28] } });
    this.map.addLayer({ id: layerId('population-points'), type: 'circle', source: sourceId('population'), paint: { 'circle-color': '#d97046', 'circle-opacity': .9, 'circle-radius': 4, 'circle-stroke-width': 1, 'circle-stroke-color': '#fff' } });
    this.map.addLayer({ id: layerId('workplaces'), type: 'circle', source: sourceId('workplaces'), paint: { 'circle-color': '#285b85', 'circle-radius': ['interpolate', ['linear'], ['get', 'jobs'], 0, 4, 800, 16], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('pois'), type: 'circle', source: sourceId('pois'), paint: { 'circle-color': '#6c4c8c', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('road-ids'), type: 'symbol', source: sourceId('roads'), layout: { 'text-field': ['get', 'id'], 'text-size': 10, 'symbol-placement': 'line', 'text-keep-upright': true }, paint: { 'text-color': '#384841', 'text-halo-color': '#edf1ec', 'text-halo-width': 1.5 } });
    this.map.addLayer({ id: layerId('building-ids'), type: 'symbol', source: sourceId('buildings'), layout: { 'text-field': ['get', 'id'], 'text-size': 9 }, paint: { 'text-color': '#4d564e', 'text-halo-color': '#fffefa', 'text-halo-width': 1 } });
    this.map.addLayer({ id: layerId('bounds'), type: 'line', source: sourceId('bounds'), paint: { 'line-color': '#e17055', 'line-dasharray': [2, 2], 'line-width': 2 } });
    this.map.addLayer({ id: layerId('transit'), type: 'line', source: sourceId('transit'), paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': .9 } });
    this.map.addLayer({ id: layerId('transit-stops'), type: 'circle', source: sourceId('transit-stops'), paint: { 'circle-color': '#fffefa', 'circle-radius': 6, 'circle-stroke-color': '#ef6c45', 'circle-stroke-width': 3 } });
    this.map.addLayer({ id: layerId('transit-vehicles'), type: 'circle', source: sourceId('transit-vehicles'), paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['match', ['get', 'modeId'], 'SUBWAY', 9, 'TRAM', 8, 7], 'circle-stroke-color': '#fffefa', 'circle-stroke-width': 2 } });
    this.map.addLayer({ id: layerId('demand-served'), type: 'circle', source: sourceId('demand-served'), paint: { 'circle-color': '#2d936c', 'circle-opacity': 0.35, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 8, 40, 22] } });
    this.map.addLayer({ id: layerId('demand-active'), type: 'circle', source: sourceId('demand-active'), paint: { 'circle-color': '#3d78ad', 'circle-opacity': 0.45, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 7, 40, 20] } });
    this.map.addLayer({ id: layerId('demand-unserved'), type: 'circle', source: sourceId('demand-unserved'), paint: { 'circle-color': '#b33b3b', 'circle-opacity': 0.5, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 7, 40, 20] } });
    this.bindInteractions(); this.applyVisibility(); this.initialized = true;
    requestAnimationFrame(() => { if (!this.destroyed) { this.map.resize(); this.resetCamera(); this.confirmReady(); } });
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Unable to create the city map layers.'); }
  }
  private diagnostic(): MapDiagnostic { const center = this.map.getCenter(); return { initialized: this.initialized, sourceCount: Object.keys(this.map.getStyle().sources).length, expectedLayersLoaded: requiredLayerNames.every((name) => Boolean(this.map.getLayer(layerId(name)))) && requiredSourceNames.every((name) => Boolean(this.map.getSource(sourceId(name)))), zoom: this.map.getZoom(), center: { latitude: center.lat, longitude: center.lng }, levelBounds: this.world.definition.bounds }; }
  private publishDiagnostic(): void { if (this.initialized && !this.destroyed) this.options.onLifecycle('READY', undefined, this.diagnostic()); }
  private confirmReady(): void { if (this.destroyed || !this.initialized) return; const diagnostic = this.diagnostic(); if (diagnostic.expectedLayersLoaded) { if (this.readyTimer) window.clearTimeout(this.readyTimer); this.readyTimer = undefined; this.options.onLifecycle('READY', undefined, diagnostic); } }
  private fail(message: string): void { if (this.destroyed || (!this.readyTimer && this.initialized && this.diagnostic().expectedLayersLoaded)) return; if (this.readyTimer) window.clearTimeout(this.readyTimer); this.readyTimer = undefined; this.options.onLifecycle('ERROR', message, this.initialized ? this.diagnostic() : undefined); }
  private bindInteractions(): void {
    const clickable: ReadonlyArray<[string, Exclude<MapSelection, null>['kind']]> = [[layerId('roads'), 'road'], [layerId('arterials'), 'road'], [layerId('highways'), 'road'], [layerId('buildings'), 'building'], [layerId('workplaces'), 'workplace'], [layerId('pois'), 'poi'], [layerId('transit'), 'line'], [layerId('transit-stops'), 'station'], [layerId('transit-vehicles'), 'vehicle']];
    for (const [layer, kind] of clickable) this.map.on('click', layer, (event) => { const id = event.features?.[0]?.properties?.id; if (typeof id === 'string') { const accepted = this.options.onSelection({ kind, id } as Exclude<MapSelection, null>); if (accepted !== false && kind === 'building') this.highlightBuilding(id); } });
    this.map.on('click', (event) => this.options.onCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    for (const [layer] of clickable) { this.map.on('mouseenter', layer, () => { this.map.getCanvas().style.cursor = 'pointer'; }); this.map.on('mouseleave', layer, () => { this.map.getCanvas().style.cursor = ''; }); }
  }
  public highlightBuilding(id: string | null): void { if (!this.map.isStyleLoaded()) return; if (this.highlightedBuilding) this.map.setFeatureState({ source: sourceId('buildings'), id: this.highlightedBuilding }, { selected: false }); this.highlightedBuilding = id; if (id) this.map.setFeatureState({ source: sourceId('buildings'), id }, { selected: true }); }
  public setPopulationMode(mode: PopulationDisplayMode): void { this.visibility = { ...this.visibility, population: mode }; this.applyVisibility(); }
  public setLayerVisibility(layer: keyof Omit<MapLayerVisibility, 'population'>, visible: boolean): void { this.visibility = { ...this.visibility, [layer]: visible }; this.applyVisibility(); }
  private applyVisibility(): void { if (!this.map.isStyleLoaded()) return; const visible = (id: string, value: boolean): void => { this.map.setLayoutProperty(layerId(id), 'visibility', value ? 'visible' : 'none'); }; visible('population-points', this.visibility.population === 'points'); visible('population-density', this.visibility.population === 'density'); visible('workplaces', this.visibility.workplaces); visible('buildings', this.visibility.buildings); visible('building-outline', this.visibility.buildings); visible('pois', this.visibility.pois); visible('water', this.visibility.water); visible('demand-active', this.visibility.tripDemand); visible('demand-served', this.visibility.tripDemand); visible('demand-unserved', this.visibility.unservedDemand); visible('road-ids', this.visibility.roadIds); visible('building-ids', this.visibility.buildingIds); visible('bounds', this.visibility.bounds); }
  public setTransitOverlay(overlay: TransitOverlay): void { this.transitOverlay = overlay; const lines = this.map.getSource(sourceId('transit')); if (lines instanceof maplibregl.GeoJSONSource) lines.setData(createTransitSource(overlay)); const stops = this.map.getSource(sourceId('transit-stops')); if (stops instanceof maplibregl.GeoJSONSource) stops.setData(createTransitStopsSource(overlay)); const vehicles = this.map.getSource(sourceId('transit-vehicles')); if (vehicles instanceof maplibregl.GeoJSONSource) vehicles.setData(createTransitVehiclesSource(overlay)); }
  public setDemandOverlay(overlay: DemandOverlay): void {
    const active = this.map.getSource(sourceId('demand-active'));
    const unserved = this.map.getSource(sourceId('demand-unserved'));
    const served = this.map.getSource(sourceId('demand-served'));
    if (active instanceof maplibregl.GeoJSONSource) active.setData(createDemandSource(overlay.activeOrigins));
    if (unserved instanceof maplibregl.GeoJSONSource) unserved.setData(createDemandSource(overlay.unservedOrigins));
    if (served instanceof maplibregl.GeoJSONSource) served.setData(createDemandSource(overlay.servedDestinations));
  }
  public coordinateFromScreen(x: number, y: number): { readonly latitude: number; readonly longitude: number } { const coordinate = this.map.unproject([x, y]); return { latitude: coordinate.lat, longitude: coordinate.lng }; }
  public resetCamera(): void { const { southWest, northEast } = this.world.definition.bounds; this.map.resize(); this.map.fitBounds([[southWest.longitude, southWest.latitude], [northEast.longitude, northEast.latitude]], { padding: 56, duration: 0 }); this.publishDiagnostic(); }
  public destroy(): void { this.destroyed = true; if (this.readyTimer) window.clearTimeout(this.readyTimer); this.resizeObserver.disconnect(); this.options.container.removeEventListener('click', this.handleContainerClick); this.map.remove(); }
}
