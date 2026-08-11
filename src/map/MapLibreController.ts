import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { World } from '../world';
import { createBaseSources, createConstructionSources, createDemandSource, createTransitSource, createTransitStopsSource, createTransitVehiclesSource } from './layers';
import type { DemandOverlay, MapController, MapDiagnostic, MapLayerVisibility, MapLifecycleStatus, MapSelection, PopulationDisplayMode, TransitOverlay } from './types';
import type { ConstructionWorkflowSnapshot } from '../construction';

const sourceId = (name: string): string => `open-transport-${name}`;
const layerId = (name: string): string => `open-transport-${name}`;
const baseVisibility: MapLayerVisibility = { population: 'points', workplaces: true, buildings: true, pois: true, water: true, tripDemand: false, unservedDemand: false, acquisitionCosts: false, roadIds: false, buildingIds: false, bounds: false };

const requiredLayerNames = ['water-fill', 'water', 'buildings', 'building-outline', 'highways', 'arterials', 'roads', 'population-points', 'workplaces', 'pois'] as const;
const requiredSourceNames = ['roads', 'buildings', 'acquisition-costs', 'water', 'population', 'workplaces', 'pois', 'bounds', 'context'] as const;
export interface MapLibreControllerOptions { readonly container: HTMLElement; readonly world: World; readonly onSelection: (selection: MapSelection) => boolean | void; readonly onCoordinate: (coordinate: { readonly latitude: number; readonly longitude: number }) => void; readonly onLifecycle: (status: MapLifecycleStatus, message?: string, diagnostic?: MapDiagnostic) => void; }

/** The only MapLibre-specific adapter. Other modules interact through MapController. */
export class MapLibreController implements MapController {
  private readonly map: MapLibreMap;
  private readonly world: World;
  private visibility = baseVisibility;
  private highlightedBuilding: string | null = null;
  private transitOverlay: TransitOverlay = { lines: [], stops: [] };
  private constructionOverlay: ConstructionWorkflowSnapshot = { state: { demolishedBuildingIds: [], engineeringSegments: [], stations: [] } };
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
    this.map = new maplibregl.Map({
      container: options.container,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce7ef' } }] },
      center: [0, 0],
      zoom: 10,
      pitch: 45,
      bearing: -15,
      attributionControl: {}
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    options.container.addEventListener('click', this.handleContainerClick);
    this.resizeObserver = new ResizeObserver(() => { if (!this.destroyed) this.map.resize(); });
    this.resizeObserver.observe(options.container);
    this.map.on('load', () => this.initialize());
    this.map.on('idle', () => this.confirmReady());
    this.map.on('moveend', () => this.publishDiagnostic());
    this.map.on('error', (event) => this.fail(event.error?.message ?? 'MapLibre reported a rendering error.'));
    this.readyTimer = window.setTimeout(() => this.fail('Timed out waiting for the city geometry layers to become ready.'), 12_000);
    options.onLifecycle('LOADING');
  }
  private initialize(): void {
    if (this.destroyed || this.initialized) return;
    try {
    this.map.resize();
    // A real, lightweight basemap gives regional orientation; gameplay geometry remains local and deterministic.
    this.map.addSource('open-transport-basemap', { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' });
    this.map.addLayer({ id: 'open-transport-basemap', type: 'raster', source: 'open-transport-basemap', paint: { 'raster-opacity': 0.56, 'raster-saturation': -0.45, 'raster-brightness-max': 0.82 } });
    const baseSources = createBaseSources(this.world);
    for (const [name, data] of Object.entries(baseSources)) {
      if (name === 'population' || name === 'workplaces') continue;
      this.map.addSource(sourceId(name), { type: 'geojson', data, promoteId: 'id' });
    }
    this.map.addSource(sourceId('population'), { type: 'geojson', data: baseSources.population, promoteId: 'id', cluster: true, clusterRadius: 52, clusterMaxZoom: 10, clusterProperties: { represented: ['+', ['get', 'residents']] } });
    this.map.addSource(sourceId('workplaces'), { type: 'geojson', data: baseSources.workplaces, promoteId: 'id', cluster: true, clusterRadius: 52, clusterMaxZoom: 10, clusterProperties: { represented: ['+', ['get', 'jobs']] } });
    this.map.addSource(sourceId('transit'), { type: 'geojson', data: createTransitSource(this.transitOverlay) });
    this.map.addSource(sourceId('transit-stops'), { type: 'geojson', data: createTransitStopsSource(this.transitOverlay) });
    this.map.addSource(sourceId('transit-vehicles'), { type: 'geojson', data: createTransitVehiclesSource(this.transitOverlay) });
    this.map.addSource(sourceId('demand-active'), { type: 'geojson', data: createDemandSource([]) });
    this.map.addSource(sourceId('demand-unserved'), { type: 'geojson', data: createDemandSource([]) });
    this.map.addSource(sourceId('demand-served'), { type: 'geojson', data: createDemandSource([]) });
    const construction = createConstructionSources(this.world, this.constructionOverlay);
    this.map.addSource(sourceId('construction-demolitions'), { type: 'geojson', data: construction['construction-demolitions'] });
    this.map.addSource(sourceId('construction-alignments'), { type: 'geojson', data: construction['construction-alignments'] });
    this.map.addSource(sourceId('construction-stations'), { type: 'geojson', data: construction['construction-stations'] });
    this.map.addSource(sourceId('construction-catchments'), { type: 'geojson', data: construction['construction-catchments'] });
    this.map.addSource(sourceId('construction-entrances'), { type: 'geojson', data: construction['construction-entrances'] });
    this.map.addLayer({ id: layerId('water-fill'), type: 'fill', source: sourceId('water'), filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#79bce6', 'fill-opacity': 0.7 } });
    this.map.addLayer({ id: layerId('context-parks'), type: 'fill', source: sourceId('context'), filter: ['==', ['get', 'kind'], 'park'], paint: { 'fill-color': '#5c9f70', 'fill-opacity': 0.56 } });
    this.map.addLayer({ id: layerId('context-airports'), type: 'fill', source: sourceId('context'), filter: ['==', ['get', 'kind'], 'airport'], paint: { 'fill-color': '#a8aebb', 'fill-opacity': 0.35, 'fill-outline-color': '#667085' } });
    this.map.addLayer({ id: layerId('water'), type: 'line', source: sourceId('water'), paint: { 'line-color': '#247fae', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 12, 5, 15, 11], 'line-opacity': 0.94 } });
    this.map.addLayer({
      id: layerId('buildings'),
      type: 'fill-extrusion',
      source: sourceId('buildings'),
      paint: {
        'fill-extrusion-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#f0a23e', ['match', ['get', 'category'], 'residential', '#b8c6bc', 'commercial', '#c6b98f', 'industrial', '#b5a6a1', 'civic', '#9eb5c8', '#bec6ca']],
        'fill-extrusion-height': ['interpolate', ['linear'], ['coalesce', ['get', 'acquisitionValue'], 150000], 100000, 7, 500000, 16, 2000000, 42, 10000000, 155],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.7
      }
    });
    this.map.addLayer({ id: layerId('building-outline'), type: 'line', source: sourceId('buildings'), paint: { 'line-color': '#8798a7', 'line-opacity': 0.45 } });
    this.map.addLayer({ id: layerId('acquisition-costs'), type: 'heatmap', source: sourceId('acquisition-costs'), maxzoom: 15, paint: { 'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'acquisitionValue'], 0], 0, 0, 250000, 0.15, 1500000, 0.58, 10000000, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 13, 1.25], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 15, 13, 32], 'heatmap-opacity': 0.82, 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.18, '#f2dc89', 0.45, '#ef9c45', 0.72, '#d65038', 1, '#6e2033'] } });
    this.map.addLayer({ id: layerId('highways'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'highway'], paint: { 'line-color': '#315f91', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8] } });
    this.map.addLayer({ id: layerId('arterials'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'arterial'], paint: { 'line-color': '#d18a32', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 5] } });
    this.map.addLayer({ id: layerId('roads'), type: 'line', source: sourceId('roads'), filter: ['==', ['get', 'classification'], 'local'], paint: { 'line-color': '#f8fbfd', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 15, 2.4] } });
    this.map.addLayer({ id: layerId('highway-names'), type: 'symbol', source: sourceId('roads'), filter: ['all', ['==', ['get', 'classification'], 'highway'], ['!=', ['get', 'name'], '']], minzoom: 9, layout: { 'text-field': ['concat', 'Hwy ', ['get', 'name']], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 14, 12], 'symbol-placement': 'line', 'text-padding': 80 }, paint: { 'text-color': '#153f69', 'text-halo-color': '#e8f2fa', 'text-halo-width': 2.6 } });
    this.map.addLayer({ id: layerId('road-names'), type: 'symbol', source: sourceId('roads'), filter: ['all', ['!=', ['get', 'classification'], 'highway'], ['!=', ['get', 'name'], '']], minzoom: 13, layout: { 'text-field': ['get', 'name'], 'text-size': 10, 'symbol-placement': 'line', 'text-padding': 60 }, paint: { 'text-color': '#56636e', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    this.map.addLayer({ id: layerId('population-density'), type: 'circle', source: sourceId('population'), paint: { 'circle-color': '#ef6c45', 'circle-opacity': .14, 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'residents'], 0], 0, 7, 800, 28] } });
    this.map.addLayer({ id: layerId('population-clusters'), type: 'circle', source: sourceId('population'), filter: ['has', 'point_count'], maxzoom: 11, paint: { 'circle-color': '#df6947', 'circle-opacity': .88, 'circle-radius': ['interpolate', ['linear'], ['get', 'represented'], 0, 12, 1000, 21, 10000, 32], 'circle-stroke-color': '#fff7f2', 'circle-stroke-width': 2 } });
    this.map.addLayer({ id: layerId('population-cluster-labels'), type: 'symbol', source: sourceId('population'), filter: ['has', 'point_count'], maxzoom: 11, layout: { 'text-field': ['number-format', ['get', 'represented'], { 'max-fraction-digits': 0 }], 'text-size': 10 }, paint: { 'text-color': '#fff' } });
    this.map.addLayer({ id: layerId('population-points'), type: 'circle', source: sourceId('population'), minzoom: 11, paint: { 'circle-color': '#ef6c45', 'circle-opacity': .9, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 5], 'circle-stroke-width': 1, 'circle-stroke-color': '#0d111a' } });
    this.map.addLayer({ id: layerId('workplace-clusters'), type: 'circle', source: sourceId('workplaces'), filter: ['has', 'point_count'], maxzoom: 11, paint: { 'circle-color': '#3978c3', 'circle-opacity': .9, 'circle-radius': ['interpolate', ['linear'], ['get', 'represented'], 0, 12, 1000, 21, 10000, 32], 'circle-stroke-color': '#f4f9ff', 'circle-stroke-width': 2 } });
    this.map.addLayer({ id: layerId('workplace-cluster-labels'), type: 'symbol', source: sourceId('workplaces'), filter: ['has', 'point_count'], maxzoom: 11, layout: { 'text-field': ['number-format', ['get', 'represented'], { 'max-fraction-digits': 0 }], 'text-size': 10 }, paint: { 'text-color': '#fff' } });
    this.map.addLayer({ id: layerId('workplaces'), type: 'circle', source: sourceId('workplaces'), minzoom: 10, paint: { 'circle-color': '#3b82f6', 'circle-radius': ['interpolate', ['linear'], ['get', 'jobs'], 0, 4, 800, 16], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('pois'), type: 'circle', source: sourceId('pois'), minzoom: 12, paint: { 'circle-color': '#8b5cf6', 'circle-radius': 6, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } });
    this.map.addLayer({ id: layerId('poi-labels'), type: 'symbol', source: sourceId('pois'), minzoom: 14, layout: { 'text-field': ['get', 'displayName'], 'text-size': 10, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 12 }, paint: { 'text-color': '#4e3272', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } });
    this.map.addLayer({ id: layerId('context-labels'), type: 'symbol', source: sourceId('context'), filter: ['!=', ['get', 'kind'], 'park'], minzoom: 8, layout: { 'text-field': ['get', 'name'], 'text-size': ['match', ['get', 'kind'], 'district', 11, 'water-label', 12, 10], 'text-letter-spacing': 0.08, 'text-max-width': 20 }, paint: { 'text-color': ['match', ['get', 'kind'], 'water-label', '#17658f', '#455764'], 'text-halo-color': '#f4f8f6', 'text-halo-width': 2 } });
    this.map.addLayer({ id: layerId('road-ids'), type: 'symbol', source: sourceId('roads'), layout: { 'text-field': ['get', 'id'], 'text-size': 10, 'symbol-placement': 'line', 'text-keep-upright': true }, paint: { 'text-color': '#718096', 'text-halo-color': '#0d111a', 'text-halo-width': 1.5 } });
    this.map.addLayer({ id: layerId('building-ids'), type: 'symbol', source: sourceId('buildings'), layout: { 'text-field': ['get', 'id'], 'text-size': 9 }, paint: { 'text-color': '#4a5568', 'text-halo-color': '#0d111a', 'text-halo-width': 1 } });
    this.map.addLayer({ id: layerId('bounds'), type: 'line', source: sourceId('bounds'), paint: { 'line-color': '#e17055', 'line-dasharray': [2, 2], 'line-width': 2 } });
    this.map.addLayer({ id: layerId('transit'), type: 'line', source: sourceId('transit'), paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': .9 } });
    this.map.addLayer({
      id: layerId('transit-stops'),
      type: 'circle',
      source: sourceId('transit-stops'),
      paint: {
        'circle-color': ['match', ['get', 'draftRole'], 'start', '#1e9e73', 'end', '#ea8f32', 'waypoint', '#3d78ad', 'hover', '#ffffff', '#ef6c45'],
        'circle-radius': ['case', ['!=', ['get', 'draftRole'], ''], ['match', ['get', 'draftRole'], 'start', 9, 'end', 9, 'hover', 8, 6], ['interpolate', ['linear'], ['coalesce', ['get', 'waiting'], 0], 0, 6, 50, 14, 500, 26]],
        'circle-stroke-color': ['case', ['!=', ['get', 'draftRole'], ''], '#102126', '#ffffff'],
        'circle-stroke-width': ['case', ['!=', ['get', 'draftRole'], ''], 2.5, 1.5]
      }
    });
    this.map.addLayer({
      id: layerId('transit-stop-labels'),
      type: 'symbol',
      source: sourceId('transit-stops'),
      layout: {
        'text-field': [
          'case',
          ['>', ['coalesce', ['get', 'waiting'], 0], 0],
          ['concat', ['get', 'name'], ' (', ['get', 'waiting'], ')'],
          ['get', 'name']
        ],
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#0d111a',
        'text-halo-width': 2
      }
    });
    this.map.addLayer({ id: layerId('transit-vehicles'), type: 'circle', source: sourceId('transit-vehicles'), paint: { 'circle-color': ['case', ['==', ['get', 'state'], 'DELAYED'], '#e55245', ['get', 'color']], 'circle-radius': ['match', ['get', 'modeId'], 'SUBWAY', 9, 'TRAM', 8, 7], 'circle-stroke-color': ['case', ['==', ['get', 'state'], 'DELAYED'], '#601f26', '#fffefa'], 'circle-stroke-width': ['case', ['==', ['get', 'state'], 'DELAYED'], 3, 2] } });
    this.map.addLayer({ id: layerId('demand-served'), type: 'circle', source: sourceId('demand-served'), paint: { 'circle-color': '#2d936c', 'circle-opacity': 0.35, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 8, 40, 22] } });
    this.map.addLayer({ id: layerId('demand-active'), type: 'circle', source: sourceId('demand-active'), paint: { 'circle-color': '#3d78ad', 'circle-opacity': 0.45, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 7, 40, 20] } });
    this.map.addLayer({ id: layerId('demand-unserved'), type: 'circle', source: sourceId('demand-unserved'), paint: { 'circle-color': '#b33b3b', 'circle-opacity': 0.5, 'circle-radius': ['interpolate', ['linear'], ['get', 'weight'], 1, 7, 40, 20] } });
    this.map.addLayer({ id: layerId('construction-demolitions'), type: 'fill', source: sourceId('construction-demolitions'), paint: { 'fill-color': ['match', ['get', 'kind'], 'pending', '#d24b37', '#68504b'], 'fill-opacity': 0.5 } });
    this.map.addLayer({ id: layerId('construction-alignments'), type: 'line', source: sourceId('construction-alignments'), paint: { 'line-color': ['case', ['boolean', ['get', 'elevated'], false], '#d79633', ['match', ['get', 'kind'], 'pending-invalid', '#a6363b', 'river', '#2f7ea8', '#145a42']], 'line-width': ['match', ['get', 'kind'], 'river', 14, 8], 'line-dasharray': [2, 1] } });
    this.map.addLayer({ id: layerId('construction-stations'), type: 'fill', source: sourceId('construction-stations'), paint: { 'fill-color': ['match', ['get', 'kind'], 'pending-invalid', '#a6363b', 'pending-valid', '#145a42', '#145a42'], 'fill-opacity': 0.35 } });
    this.map.addLayer({ id: layerId('construction-platforms'), type: 'line', source: sourceId('construction-stations'), paint: { 'line-color': ['match', ['get', 'kind'], 'pending-invalid', '#f1a09a', 'pending-valid', '#dff8f0', '#b7e7d8'], 'line-width': 3, 'line-dasharray': [1.6, 0.7] } });
    this.map.addLayer({ id: layerId('construction-catchments'), type: 'circle', source: sourceId('construction-catchments'), paint: { 'circle-color': '#5ee0b3', 'circle-opacity': 0.13, 'circle-stroke-color': '#2d936c', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.85, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 36, 14, 135, 17, 430] } });
    this.map.addLayer({ id: layerId('construction-entrances'), type: 'circle', source: sourceId('construction-entrances'), paint: { 'circle-color': ['match', ['get', 'kind'], 'pending-invalid', '#b73b38', 'pending-valid', '#f4c84b', '#d59a22'], 'circle-radius': 7, 'circle-stroke-color': '#29343b', 'circle-stroke-width': 2 } });
    this.bindInteractions(); this.applyVisibility(); this.initialized = true;
    requestAnimationFrame(() => { if (!this.destroyed) { this.map.resize(); this.resetCamera(); this.confirmReady(); } });
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Unable to create the city map layers.'); }
  }
  private diagnostic(): MapDiagnostic {
    try {
      const center = this.map.getCenter();
      const style = this.map.getStyle();
      const sources = style?.sources ? Object.keys(style.sources).length : 0;
      return {
        initialized: this.initialized,
        sourceCount: sources,
        expectedLayersLoaded: requiredLayerNames.every((name) => Boolean(this.map.getLayer(layerId(name)))) && requiredSourceNames.every((name) => Boolean(this.map.getSource(sourceId(name)))),
        zoom: this.map.getZoom(),
        center: { latitude: center.lat, longitude: center.lng },
        levelBounds: this.world.definition.bounds,
      };
    } catch {
      return {
        initialized: this.initialized,
        sourceCount: 0,
        expectedLayersLoaded: false,
        zoom: 0,
        center: { latitude: 0, longitude: 0 },
        levelBounds: this.world.definition.bounds,
      };
    }
  }
  private publishDiagnostic(): void { if (this.initialized && !this.destroyed) this.options.onLifecycle('READY', undefined, this.diagnostic()); }
  private confirmReady(): void { if (this.destroyed || !this.initialized) return; const diagnostic = this.diagnostic(); if (diagnostic.expectedLayersLoaded) { if (this.readyTimer) window.clearTimeout(this.readyTimer); this.readyTimer = undefined; this.options.onLifecycle('READY', undefined, diagnostic); } }
  private fail(message: string): void {
    if (this.destroyed) return;
    let ready = false;
    try { ready = !this.readyTimer && this.initialized && this.diagnostic().expectedLayersLoaded; } catch { ready = false; }
    if (ready) return;
    if (this.readyTimer) window.clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    let diagnostic: MapDiagnostic | undefined;
    try { diagnostic = this.initialized ? this.diagnostic() : undefined; } catch { diagnostic = undefined; }
    this.options.onLifecycle('ERROR', message, diagnostic);
  }
  private bindInteractions(): void {
    const clickable: ReadonlyArray<[string, Exclude<MapSelection, null>['kind']]> = [[layerId('roads'), 'road'], [layerId('arterials'), 'road'], [layerId('highways'), 'road'], [layerId('buildings'), 'building'], [layerId('workplaces'), 'workplace'], [layerId('pois'), 'poi'], [layerId('transit'), 'line'], [layerId('transit-stops'), 'station'], [layerId('transit-vehicles'), 'vehicle']];
    for (const [layer, kind] of clickable) this.map.on('click', layer, (event) => { const id = event.features?.[0]?.properties?.id; if (typeof id === 'string') { const accepted = this.options.onSelection({ kind, id } as Exclude<MapSelection, null>); if (accepted !== false && kind === 'building') this.highlightBuilding(id); } });
    this.map.on('click', (event) => this.options.onCoordinate({ latitude: event.lngLat.lat, longitude: event.lngLat.lng }));
    for (const [layer] of clickable) { this.map.on('mouseenter', layer, () => { this.map.getCanvas().style.cursor = 'pointer'; }); this.map.on('mouseleave', layer, () => { this.map.getCanvas().style.cursor = ''; }); }
  }
  public highlightBuilding(id: string | null): void { if (!this.map.isStyleLoaded()) return; if (this.highlightedBuilding) this.map.setFeatureState({ source: sourceId('buildings'), id: this.highlightedBuilding }, { selected: false }); this.highlightedBuilding = id; if (id) this.map.setFeatureState({ source: sourceId('buildings'), id }, { selected: true }); }
  public setPopulationMode(mode: PopulationDisplayMode): void { this.visibility = { ...this.visibility, population: mode }; this.applyVisibility(); }
  public setLayerVisibility(layer: keyof Omit<MapLayerVisibility, 'population'>, visible: boolean): void { this.visibility = { ...this.visibility, [layer]: visible }; this.applyVisibility(); }
  private applyVisibility(): void { if (!this.map.isStyleLoaded()) return; const visible = (id: string, value: boolean): void => { this.map.setLayoutProperty(layerId(id), 'visibility', value ? 'visible' : 'none'); }; visible('population-points', this.visibility.population === 'points'); visible('population-clusters', this.visibility.population === 'points'); visible('population-cluster-labels', this.visibility.population === 'points'); visible('population-density', this.visibility.population === 'density'); visible('workplaces', this.visibility.workplaces); visible('workplace-clusters', this.visibility.workplaces); visible('workplace-cluster-labels', this.visibility.workplaces); visible('buildings', this.visibility.buildings); visible('building-outline', this.visibility.buildings); visible('acquisition-costs', this.visibility.acquisitionCosts); visible('pois', this.visibility.pois); visible('poi-labels', this.visibility.pois); visible('water', this.visibility.water); visible('demand-active', this.visibility.tripDemand); visible('demand-served', this.visibility.tripDemand); visible('demand-unserved', this.visibility.unservedDemand); visible('road-ids', this.visibility.roadIds); visible('building-ids', this.visibility.buildingIds); visible('bounds', this.visibility.bounds); }
  public setTransitOverlay(overlay: TransitOverlay): void { this.transitOverlay = overlay; const lines = this.map.getSource(sourceId('transit')); if (lines instanceof maplibregl.GeoJSONSource) lines.setData(createTransitSource(overlay)); const stops = this.map.getSource(sourceId('transit-stops')); if (stops instanceof maplibregl.GeoJSONSource) stops.setData(createTransitStopsSource(overlay)); const vehicles = this.map.getSource(sourceId('transit-vehicles')); if (vehicles instanceof maplibregl.GeoJSONSource) vehicles.setData(createTransitVehiclesSource(overlay)); }
  public setDemandOverlay(overlay: DemandOverlay): void {
    const active = this.map.getSource(sourceId('demand-active'));
    const unserved = this.map.getSource(sourceId('demand-unserved'));
    const served = this.map.getSource(sourceId('demand-served'));
    if (active instanceof maplibregl.GeoJSONSource) active.setData(createDemandSource(overlay.activeOrigins));
    if (unserved instanceof maplibregl.GeoJSONSource) unserved.setData(createDemandSource(overlay.unservedOrigins));
    if (served instanceof maplibregl.GeoJSONSource) served.setData(createDemandSource(overlay.servedDestinations));
  }
  public setConstructionOverlay(overlay: ConstructionWorkflowSnapshot): void {
    this.constructionOverlay = overlay;
    if (!this.map.isStyleLoaded()) return;
    const sources = createConstructionSources(this.world, overlay);
    for (const [name, data] of Object.entries(sources)) {
      const source = this.map.getSource(sourceId(name));
      if (source instanceof maplibregl.GeoJSONSource) source.setData(data);
    }
  }
  public coordinateFromScreen(x: number, y: number): { readonly latitude: number; readonly longitude: number } { const coordinate = this.map.unproject([x, y]); return { latitude: coordinate.lat, longitude: coordinate.lng }; }
  public resetCamera(): void {
    const { southWest, northEast } = this.world.definition.bounds;
    this.map.resize();
    this.map.fitBounds([[southWest.longitude, southWest.latitude], [northEast.longitude, northEast.latitude]], { padding: 56, duration: 0 });
    this.map.setPitch(45);
    this.map.setBearing(-15);
    this.publishDiagnostic();
  }
  public focusCamera(target: { readonly latitude: number; readonly longitude: number }, zoom = 13, pitch = 45, bearing = -15): void {
    this.map.easeTo({ center: [target.longitude, target.latitude], zoom, pitch, bearing, duration: 700, essential: true });
  }
  public panBy(x: number, y: number): void { this.map.panBy([x, y], { duration: 180, essential: true }); }
  public setPitchAndBearing(pitch: number, bearing: number): void {
    this.map.easeTo({ pitch, bearing, duration: 300 });
  }
  public zoomBy(amount: number): void {
    this.map.easeTo({ zoom: this.map.getZoom() + amount, duration: 250 });
  }
  public destroy(): void { this.destroyed = true; if (this.readyTimer) window.clearTimeout(this.readyTimer); this.resizeObserver.disconnect(); this.options.container.removeEventListener('click', this.handleContainerClick); this.map.remove(); }
}
