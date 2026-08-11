import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Coordinate, World } from '../world';
import { TransitNetworkDebug } from '../transit/TransitNetworkDebug';
import { BusLinePanel, networkToOverlay } from '../transit/BusLinePanel';
import { lineDisplayColor } from '../transit/lineStyle';
import { ConstructionDebug } from '../construction/ConstructionDebug';
import { type ConstructionOverlayState } from '../construction/ConstructionPanel';
import { ConstructionCostChip } from '../construction/ConstructionProposalUI';
import { ConstructionWorkflow } from '../construction';
import { TransitNetwork } from '../transit';
import { FinancePanel } from '../economy';
import { DevelopmentTimeControls, SimulationControls } from '../time';
import { OperationsDebug } from '../operations';
import { modeRegistry } from '../modes';
import { aggregateRequestsByEndpoint } from '../population';
import { planJourney } from '../journey';
import { AutosaveController, calculateScore, GameSession, LocalStorageSaveRepository, type GameSave, type PlayerProfile } from '../game';
import { GameErrorBoundary } from '../app/GameErrorBoundary';
import { MapLibreController } from './MapLibreController';
import type { DemandOverlay, MapController, MapDiagnostic, MapLayerVisibility, MapLifecycleStatus, MapSelection, TransitOverlay } from './types';
import { BottomDrawer, GameplayShell, type GameplayTool } from './GameplayShell';
import { LocalMapFallback } from './LocalMapFallback';
import { DataPanel, DeveloperPanel, InspectorPanel, ModeSummary, SettingsPanel } from './ToolPanels';
import { ConstructionMapOverlay } from './ConstructionMapOverlay';
import { GuidewayWorkspace } from './GuidewayWorkspace';
import { distanceMeters } from './geometry';
import 'maplibre-gl/dist/maplibre-gl.css';

const initialVisibility: MapLayerVisibility = { population: 'points', workplaces: true, buildings: true, pois: true, water: true, tripDemand: false, unservedDemand: false, acquisitionCosts: false, roadIds: false, buildingIds: false, bounds: false };
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
type ContextPanel = 'inspector' | 'data' | 'transit' | 'construction' | 'finance' | 'settings' | 'menu' | 'score';

function MapControlIcon({ kind }: { readonly kind: 'layers' | 'compass' }) {
  const props = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  return kind === 'layers'
    ? <svg {...props}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></svg>
    : <svg {...props}><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>;
}

const toDemandOverlay = (session: GameSession): DemandOverlay => {
  const requests = session.getSimulation().getPopulation().getTravelRequests();
  const active = aggregateRequestsByEndpoint(requests, 'origin', ['unresolved', 'inTransit']);
  const unserved = aggregateRequestsByEndpoint(requests, 'origin', ['unserved']);
  const served = aggregateRequestsByEndpoint(requests, 'destination', ['completed', 'inTransit']);
  return {
    activeOrigins: active.map((bucket) => ({ id: `active-${bucket.key}`, coordinate: bucket.coordinate, weight: bucket.representedPeople })),
    unservedOrigins: unserved.map((bucket) => ({ id: `unserved-${bucket.key}`, coordinate: bucket.coordinate, weight: bucket.representedPeople })),
    servedDestinations: served.map((bucket) => ({ id: `served-${bucket.key}`, coordinate: bucket.coordinate, weight: bucket.representedPeople })),
  };
};

const createSession = (world: World, player: PlayerProfile | undefined, initialSave?: GameSave): { session: GameSession; error?: string } => {
  try {
    return {
      session: new GameSession(
        world,
        initialSave?.seed ?? 12345,
        player ?? { id: 'local-player', displayName: 'Planner', achievementIds: [], settings: { autosave: true } },
        initialSave,
      ),
    };
  } catch (reason) {
    return {
      session: new GameSession(world, 12345, player ?? { id: 'local-player', displayName: 'Planner', achievementIds: [], settings: { autosave: true } }),
      error: reason instanceof Error ? reason.message : 'Save could not be restored. Started a new session instead.',
    };
  }
};

export function MapView({ world, onBack, player, initialSave }: { readonly world: World; readonly onBack: () => void; readonly player?: PlayerProfile; readonly initialSave?: GameSave }) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<MapController | null>(null);
  const saveRepo = useMemo(() => new LocalStorageSaveRepository(), []);
  const boot = useMemo(() => createSession(world, player, initialSave), [world, player, initialSave]);
  const sessionRef = useRef(boot.session);
  const session = sessionRef.current;
  const economy = session.getEconomy();
  const engine = session.getSimulation();
  const autosave = useMemo(() => new AutosaveController(saveRepo, 300), [saveRepo]);
  const lastToastAt = useRef(0);

  const [selection, setSelection] = useState<MapSelection>(null);
  const [coordinate, setCoordinate] = useState<{ readonly latitude: number; readonly longitude: number } | null>(null);
  const [hoverCoordinate, setHoverCoordinate] = useState<{ readonly latitude: number; readonly longitude: number } | null>(null);
  const [pointer, setPointer] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [clickVersion, setClickVersion] = useState(0);
  const [visibility, setVisibility] = useState(initialVisibility);
  const visibilityRef = useRef(visibility);
  useEffect(() => { visibilityRef.current = visibility; }, [visibility]);
  const [transitOverlay, setTransitOverlay] = useState<TransitOverlay>({ lines: [], stops: [] });
  const [network, setNetwork] = useState(() => session.getNetwork());
  const constructionWorkflow = useMemo(() => new ConstructionWorkflow(world, economy, session.getConstruction()), [world, economy, session]);
  const [constructionOverlay, setConstructionOverlay] = useState<ConstructionOverlayState>(() => constructionWorkflow.snapshot());
  const [simulation, setSimulation] = useState(() => engine.snapshot());
  const [mapStatus, setMapStatus] = useState<MapLifecycleStatus>('LOADING');
  const [mapError, setMapError] = useState<string>();
  const [diagnostic, setDiagnostic] = useState<MapDiagnostic>();
  const mapStatusRef = useRef<MapLifecycleStatus>('LOADING');
  const [activeTool, setActiveTool] = useState<GameplayTool>('select');
  const activeToolRef = useRef<GameplayTool>('select');
  const [activePanel, setActivePanel] = useState<ContextPanel>('inspector');
  const [contextOpen, setContextOpen] = useState(true);
  const [developerMode, setDeveloperMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(true);
  const [guidewayPhase, setGuidewayPhase] = useState<'construct' | 'service'>('construct');
  const [saveMessage, setSaveMessage] = useState<string | null>(boot.error ?? null);
  const [dirty, setDirty] = useState(false);
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const [tutorialStep, setTutorialStep] = useState(() => world.definition.metadata.id === 'dallas' && localStorage.getItem('opentransport:tutorial:dallas') !== 'complete' ? 0 : -1);
  const [financeSection, setFinanceSection] = useState<'overview' | 'operations' | 'construction' | 'loans' | 'ledger' | undefined>();
  const seenAchievements = useRef(new Set(session.dashboard().achievements.map((item) => item.id)));
  const networkRef = useRef(network);
  useEffect(() => { networkRef.current = network; }, [network]);
  const mapReady = mapStatus === 'READY';
  useEffect(() => { mapStatusRef.current = mapStatus; }, [mapStatus]);

  const lastPlacementAt = useRef(0);
  const lastPlacementKey = useRef('');
  const placeCoordinate = useCallback((next: { readonly latitude: number; readonly longitude: number }, source: 'maplibre' | 'canvas' = 'canvas'): void => {
    if (source === 'canvas' && mapStatusRef.current === 'READY') return;
    const now = performance.now();
    const key = `${activeToolRef.current}:${next.latitude.toFixed(4)},${next.longitude.toFixed(4)}`;
    if (key === lastPlacementKey.current && now - lastPlacementAt.current < 700) return;
    lastPlacementKey.current = key;
    lastPlacementAt.current = now;
    setCoordinate(next);
    setClickVersion((value) => value + 1);
  }, []);

  const applyNetwork = useCallback((next: TransitNetwork): void => {
    setNetwork(next);
    setDirty(true);
    session.replaceNetwork(next);
    engine.replanPendingDemand();
    setSimulation(engine.snapshot());
  }, [engine, session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    engine.syncNetwork(network);
    setSimulation(engine.snapshot());
  }, [engine, network]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const selectFeature = useCallback((next: MapSelection): boolean => {
    if (activeToolRef.current !== 'select') return false;
    setSelection(next);
    if (next?.kind === 'line') {
      const current = networkRef.current;
      const line = current.definition.lines.find((item) => item.id === next.id || item.segments.some((segment) => segment.id === next.id));
      if (line) {
        setSelectedLineId(line.id);
        setActivePanel(line.mode === 'BUS' ? 'transit' : 'construction');
        setActiveTool(line.mode === 'BUS' ? 'bus' : line.mode === 'TRAM' ? 'tram' : 'subway');
        if (line.mode !== 'BUS') setGuidewayPhase('service');
        setContextOpen(true);
        return true;
      }
    }
    if (next?.kind === 'vehicle' || next?.kind === 'station') {
      setActivePanel('inspector');
      setContextOpen(true);
      return true;
    }
    setActivePanel('inspector');
    setContextOpen(true);
    return true;
  }, []);

  useEffect(() => {
    if (!container.current) return undefined;
    setMapStatus('LOADING');
    setMapError(undefined);
    setDiagnostic(undefined);
    let instance: MapLibreController | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (!container.current) return;
      try {
        instance = new MapLibreController({
          container: container.current,
          world,
          onSelection: selectFeature,
          onCoordinate: (coord) => placeCoordinate(coord, 'maplibre'),
          onLifecycle: (status, message, nextDiagnostic) => {
            setMapStatus(status);
            setMapError(message);
            if (nextDiagnostic) setDiagnostic(nextDiagnostic);
          },
        });
        controller.current = instance;
        instance.setConstructionOverlay(constructionWorkflow.snapshot());
      } catch (reason) {
        setMapStatus('ERROR');
        setMapError(reason instanceof Error ? reason.message : 'Unable to create the map renderer.');
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      instance?.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [constructionWorkflow, placeCoordinate, selectFeature, world]);

  useEffect(() => { controller.current?.setTransitOverlay(transitOverlay); }, [transitOverlay]);
  useEffect(() => {
    const overlay = networkToOverlay(network, selectedLineId ?? undefined);
    const stopsWithWaiting = overlay.stops.map((stop) => {
      const waiting = simulation.operations?.queues[stop.id]?.length ?? 0;
      return {
        ...stop,
        waiting,
      };
    });
    setTransitOverlay((current) => ({
      ...overlay,
      stops: stopsWithWaiting,
      vehicles: current.vehicles,
    }));
  }, [network, selectedLineId, simulation]);
  useEffect(() => {
    controller.current?.setConstructionOverlay?.(constructionOverlay);
  }, [constructionOverlay]);
  const setTransitOverlaySafe = useCallback((overlay: TransitOverlay) => {
    setTransitOverlay((current) => ({ ...overlay, vehicles: overlay.vehicles ?? current.vehicles }));
  }, []);

  const refreshDemand = useCallback(() => {
    const flags = visibilityRef.current;
    if (!flags.tripDemand && !flags.unservedDemand) return;
    controller.current?.setDemandOverlay(toDemandOverlay(session));
  }, [session]);

  const publishAchievements = useCallback((): void => {
    session.checkAchievementsFromSnapshot();
    const unlocked = session.dashboard().achievements.map((item) => item.id);
    for (const id of unlocked) {
      if (!seenAchievements.current.has(id)) {
        seenAchievements.current.add(id);
        const achievement = session.dashboard().achievements.find((item) => item.id === id);
        if (achievement) {
          setAchievementToast(achievement.name);
          window.setTimeout(() => setAchievementToast(null), 4000);
        }
      }
    }
  }, [session]);

  const updateSimulation = useCallback((snapshot: import('../time').SimulationSnapshot): void => {
    setSimulation(snapshot);
    refreshDemand();
    session.setConstruction(constructionWorkflow.snapshot().state);
    publishAchievements();
    if (snapshot.operations) {
      setTransitOverlay((current) => ({
        ...current,
        vehicles: snapshot.operations!.vehicles.map((vehicle) => {
          const line = networkRef.current.getLine(vehicle.lineId);
          return {
            id: vehicle.id,
            coordinate: vehicle.coordinate,
            color: line ? lineDisplayColor(line) : '#17211e',
            lineId: vehicle.lineId,
            modeId: line?.mode,
            vehicleTypeId: vehicle.vehicleTypeId,
            state: vehicle.state,
          };
        }),
      }));
    }
    void autosave.saveIfDue(session).then((saved) => {
      if (!saved) return;
      setDirty(false);
      const now = performance.now();
      if (now - lastToastAt.current < 10_000) return;
      lastToastAt.current = now;
      setSaveMessage('Saved just now');
      window.setTimeout(() => setSaveMessage(null), 2500);
    });
  }, [autosave, constructionWorkflow, publishAchievements, refreshDemand, session]);

  const handleTiltToggle = (): void => {
    if (!controller.current) return;
    const next3D = !is3D;
    setIs3D(next3D);
    if (next3D) {
      controller.current.setPitchAndBearing(45, -15);
    } else {
      controller.current.setPitchAndBearing(0, 0);
    }
  };
  const handleZoomIn = (): void => {
    controller.current?.zoomBy(1);
  };
  const handleZoomOut = (): void => {
    controller.current?.zoomBy(-1);
  };
  const refreshEconomy = useCallback(() => setSimulation(engine.snapshot()), [engine]);
  const setToggle = (key: keyof Omit<MapLayerVisibility, 'population'>, value: boolean): void => {
    controller.current?.setLayerVisibility(key, value);
    setVisibility((current) => {
      const next = { ...current, [key]: value };
      visibilityRef.current = next;
      if ((key === 'tripDemand' || key === 'unservedDemand') && value) {
        window.setTimeout(() => controller.current?.setDemandOverlay(toDemandOverlay(session)), 0);
      }
      return next;
    });
  };
  const setPopulation = (value: MapLayerVisibility['population']): void => {
    controller.current?.setPopulationMode(value);
    setVisibility((current) => ({ ...current, population: value }));
  };
  const captureMapCoordinate = (event: ReactMouseEvent<HTMLElement>): void => {
    if (mapReady) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const mapCoordinate = controller.current?.coordinateFromScreen(event.clientX - bounds.left, event.clientY - bounds.top);
    if (mapCoordinate) placeCoordinate(mapCoordinate, 'canvas');
  };
  const captureHoverCoordinate = (event: ReactMouseEvent<HTMLElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const local = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    setPointer(local);
    const mapCoordinate = controller.current?.coordinateFromScreen(local.x, local.y);
    if (mapCoordinate) setHoverCoordinate(mapCoordinate);
  };
  const chooseTool = useCallback((tool: GameplayTool): void => {
    setActiveTool(tool);
    setSelectedLineId(null);
    setGuidewayPhase('construct');
    setActivePanel(tool === 'select' ? 'inspector' : tool === 'data' ? 'data' : tool === 'bus' ? 'transit' : 'construction');
    if (tool === 'data') refreshDemand();
  }, [refreshDemand]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); controller.current?.panBy(110, 0); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); controller.current?.panBy(-110, 0); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); controller.current?.panBy(0, 110); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); controller.current?.panBy(0, -110); return; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); handleZoomIn(); return; }
      if (event.key === '-') { event.preventDefault(); handleZoomOut(); return; }
      if (event.key === '0') { event.preventDefault(); controller.current?.resetCamera(); return; }
      const key = event.key.toLowerCase();
      if (key === 'm') { event.preventDefault(); setActivePanel('menu'); setContextOpen(true); return; }
      if (key === 'f') { event.preventDefault(); setActivePanel('finance'); setContextOpen(true); return; }
      if (key === 'i') { event.preventDefault(); setActivePanel('inspector'); setContextOpen(true); return; }
      if (key === 'g') { event.preventDefault(); setActivePanel('settings'); setContextOpen(true); return; }
      if (key === 'l') { event.preventDefault(); setDrawerOpen((open) => !open); return; }
      if (event.key === ' ') { event.preventDefault(); engine.setSpeed(simulation.paused ? 1 : 0); setSimulation(engine.snapshot()); return; }
      const tool = event.key === 'Escape' || key === 's' ? 'select' : event.key === '1' || key === 'b' ? 'bus' : event.key === '2' || key === 't' ? 'tram' : event.key === '3' || key === 'u' ? 'subway' : event.key === '4' || key === 'd' ? 'data' : null;
      if (tool) { event.preventDefault(); chooseTool(tool); setContextOpen(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chooseTool, engine, simulation.paused]);

  const showSaveToast = (wrote: boolean): void => {
    if (!wrote) return;
    setDirty(false);
    const now = performance.now();
    if (now - lastToastAt.current < 10_000) return;
    lastToastAt.current = now;
    setSaveMessage('Saved just now');
    window.setTimeout(() => setSaveMessage(null), 2500);
  };

  const persist = async (exit = false): Promise<void> => {
    session.setConstruction(constructionWorkflow.snapshot().state);
    session.replaceNetwork(network);
    const wrote = await autosave.saveNow(session, { force: true });
    if (wrote) setDirty(false);
    showSaveToast(wrote);
    if (exit) onBack();
  };
  const exportSave = (): void => {
    const contents = JSON.stringify(session.save(), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${world.definition.metadata.id}-save.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0); setSaveMessage('Save exported');
  };
  const importSave = async (file: File): Promise<void> => {
    try {
      const candidate = JSON.parse(await file.text()) as GameSave;
      // Use the game constructor as the authoritative compatibility/malformed-save validator.
      new GameSession(world, candidate.seed, candidate.player, candidate);
      await saveRepo.save(candidate); setSaveMessage('Save imported. Reloading session…'); window.setTimeout(() => window.location.reload(), 450);
    } catch { setSaveMessage('Import failed: choose a compatible OpenTransport save.'); }
  };

  const onConstructionOverlayChange = useCallback((overlay: ConstructionOverlayState): void => {
    setConstructionOverlay(overlay);
    session.setConstruction(overlay.state);
    controller.current?.setConstructionOverlay?.(overlay);
    if (!overlay.pending) setDirty(true);
  }, [session]);

  const onConstructionEconomyChange = (): void => {
    refreshEconomy();
    publishAchievements();
  };

  const finances = economy.getFinancialSummary(simulation.timestampSeconds);
  const score = calculateScore(simulation, network);
  const activeProjects = (constructionOverlay.state.projects ?? []).filter((project) => project.completesAtSeconds > simulation.timestampSeconds).length;
  const activeVehicles = simulation.operations?.vehicles.length ?? 0;
  const selectedSummary = !selection ? '' : selection.kind === 'coordinate' ? ' Selected map coordinate.' : ` Selected ${selection.kind} ${selection.id}.`;
  const screenReaderMapSummary = `${world.definition.metadata.name} planning map is ${mapStatus === 'READY' ? 'ready' : mapStatus === 'ERROR' ? 'using the local geography fallback' : 'loading'}. ${network.definition.lines.length} transit lines, ${network.definition.stops.length} stations, and ${activeVehicles} vehicles in service. ${activeProjects} active construction project${activeProjects === 1 ? '' : 's'}. ${activeTool} tool selected.${selectedSummary} Use arrow keys to pan, plus and minus to zoom, or Command or Control K to search places.`;
  const stopStats = selection?.kind === 'station' ? engine.stopPassengerStats(selection.id) : undefined;
  const lineNameById = useMemo(() => Object.fromEntries(network.definition.lines.map((line) => [line.id, line.name])), [network]);

  const hud = (
    <header className="top-hud">
      <button className="hud-menu" type="button" onClick={() => { setActivePanel('menu'); setContextOpen(true); }}>Menu</button>
      <div className="hud-city"><span>TRANSPORT NETWORK</span><strong>{world.definition.metadata.name}</strong></div>
      <SimulationControls engine={engine} snapshot={simulation} onSnapshot={updateSimulation} compact clock={session} />
      <button className={`hud-cash ${activePanel === 'score' ? 'active' : ''}`} type="button" onClick={() => { setActivePanel('score'); setContextOpen(true); }}>
        <span>Score</span><strong>{Math.round(score.total)}</strong>
      </button>
      <button className={`hud-cash ${activePanel === 'finance' ? 'active' : ''}`} type="button" onClick={() => { setActivePanel('finance'); setFinanceSection(undefined); setContextOpen(true); }}>
        <span>Cash · Today · Debt</span>
        <strong>{compactMoney.format(finances.cashCents / 100)} · {compactMoney.format(finances.today.cashCents / 100)} · {compactMoney.format(finances.debtCents / 100)}</strong>
      </button>
      <span className={`autosave-indicator ${dirty ? 'pending' : ''}`} title={dirty ? 'Unsaved work will be saved automatically' : 'All changes are saved locally'}><i />{dirty ? 'Autosave pending' : 'Autosaved'}</span>
      <button className={`hud-settings ${activePanel === 'settings' ? 'active' : ''}`} type="button" title="Settings" aria-label="Open settings" onClick={() => { setActivePanel('settings'); setContextOpen(true); }}>⚙</button>
      <button className="hud-panel-button" type="button" onClick={() => setContextOpen((open) => !open)}>Panel</button>
    </header>
  );

  const map = (
    <GameErrorBoundary fallbackTitle="Map display error" onReset={onBack}>
      <section
        className={`map-canvas ${mapReady ? 'map-ready' : 'map-fallback-active'}`}
        onClick={captureMapCoordinate}
        onMouseMove={captureHoverCoordinate}
        onMouseLeave={() => { setHoverCoordinate(null); setPointer(null); }}
      >
        <LocalMapFallback
          world={world}
          visibility={visibility}
          transit={transitOverlay}
          onSelect={selectFeature}
          interactive={!mapReady}
          demand={(!mapReady && (visibility.tripDemand || visibility.unservedDemand)) ? toDemandOverlay(session) : undefined}
        />
        <div ref={container} className="maplibre-container" hidden={mapStatus === 'ERROR'} />
        {!mapReady && <ConstructionMapOverlay world={world} overlay={constructionOverlay} />}
        <ConstructionCostChip preview={activePanel === 'construction' ? constructionOverlay.pending : undefined} pointer={pointer} />
        {mapStatus === 'LOADING' && <div className="map-status loading" role="status">Loading {world.definition.metadata.name}…</div>}
        {mapStatus === 'ERROR' && (
          <div className="map-status error-panel" role="alert">
            <strong>Map renderer unavailable</strong>
            <span>Using the local geography underlay. Construction and planning still work.</span>
            {developerMode && <details><summary>Developer details</summary><pre>{mapError ?? 'No additional diagnostic was provided.'}</pre></details>}
          </div>
        )}
        {saveMessage && <div className="map-status save-toast" role="status">{saveMessage}</div>}
        {achievementToast && <div className="map-status achievement-toast" role="status">Achievement: {achievementToast}</div>}
        <CameraControls
          onReset={() => {
            controller.current?.resetCamera();
            setIs3D(true);
          }}
          onTiltToggle={handleTiltToggle}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
        />
        <MapNavigator world={world} network={network} onFocus={(target, zoom) => controller.current?.focusCamera(target, zoom)} />
        <MapLayersOverlay visibility={visibility} setToggle={setToggle} setPopulation={setPopulation} />
        <MapLegend />
        <p className="sr-only" aria-live="polite">{screenReaderMapSummary}</p>
        {tutorialStep >= 0 && <DallasTutorial step={tutorialStep} onNext={() => { if (tutorialStep >= 3) { localStorage.setItem('opentransport:tutorial:dallas', 'complete'); setTutorialStep(-1); } else setTutorialStep((step) => step + 1); }} onSkip={() => { localStorage.setItem('opentransport:tutorial:dallas', 'complete'); setTutorialStep(-1); }} />}
      </section>
    </GameErrorBoundary>
  );

  const page = (id: ContextPanel, content: ReactNode) => <div className="context-page" hidden={activePanel !== id}>{content}</div>;
  const guidewayMode = activeTool === 'tram' ? 'TRAM' as const : 'SUBWAY' as const;
  const context = (
    <>
      {page('inspector', <InspectorPanel world={world} selection={selection} coordinate={coordinate} network={network} transit={transitOverlay} simulation={simulation} stopStats={stopStats} developerMode={developerMode} onOpenLine={(lineId) => {
        const line = network.getLine(lineId);
        if (!line) return;
        setSelectedLineId(lineId);
        setActiveTool(line.mode === 'BUS' ? 'bus' : line.mode === 'TRAM' ? 'tram' : 'subway');
        setActivePanel(line.mode === 'BUS' ? 'transit' : 'construction');
        if (line.mode !== 'BUS') setGuidewayPhase('service');
        setContextOpen(true);
      }} />)}
      {page('data', <><DataPanel visibility={visibility} developerMode={developerMode} population={simulation.population} operations={simulation.operations} setPopulation={setPopulation} setToggle={setToggle} emptyDemandHint={visibility.tripDemand && simulation.population.activeRequests === 0} onReplan={developerMode ? () => { engine.replanPendingDemand(); setSimulation(engine.snapshot()); refreshDemand(); } : undefined} />{world.definition.metadata.id === 'dallas' && <DallasScenarioGoals network={network} onFocus={(coordinate, zoom) => controller.current?.focusCamera(coordinate, zoom)} />} {world.definition.metadata.id === 'dallas' && <NeighborhoodEquityDashboard requests={engine.getPopulation().getTravelRequests()} residentWeights={new Map(engine.getPopulation().getResidents().map((resident) => [resident.id, resident.simulationWeight]))} />}<JourneyComparison world={world} network={network} engine={engine} hour={simulation.calendar.hour} onPreview={setTransitOverlaySafe} /></>)}
      {page('finance', <FinancePanel economy={economy} timestampSeconds={simulation.timestampSeconds} developerMode={developerMode} lineNames={lineNameById} initialSection={financeSection} onChange={refreshEconomy} onTakeLoan={(productId) => { session.execute({ type: 'TAKE_LOAN', productId }); refreshEconomy(); publishAchievements(); }} />)}
      {page('score', <ScorePanel score={score} simulation={simulation} achievements={session.dashboard().achievements} />)}
      {page('menu', <GameMenuPanel onSave={() => void persist(false)} onSaveExit={() => void persist(true)} onExport={exportSave} onImport={(file) => void importSave(file)} onRestart={() => { localStorage.removeItem(`opentransport:save:${world.definition.metadata.id}`); window.location.reload(); }} onLevels={onBack} />)}
      {page('transit', <ModeSummary modeId="BUS"><BusLinePanel world={world} network={network} coordinate={coordinate} clickVersion={clickVersion} hoverCoordinate={hoverCoordinate} active={activePanel === 'transit'} onNetwork={applyNetwork} onOverlay={setTransitOverlaySafe} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId} engine={engine} snapshot={simulation} onSnapshot={updateSimulation} onPurchaseVehicle={(lineId, vehicleId) => { const vehicle = modeRegistry.getVehicleDefinition(vehicleId); const purchased = economy.purchaseVehicle(vehicle, simulation.timestampSeconds, lineId); if (purchased) { refreshEconomy(); setDirty(true); } return purchased; }} /></ModeSummary>)}
      {page('construction', <ModeSummary modeId={guidewayMode}><GuidewayWorkspace mode={guidewayMode} world={world} network={network} construction={constructionOverlay.state} workflow={constructionWorkflow} coordinate={coordinate} clickVersion={clickVersion} hoverCoordinate={hoverCoordinate} timestampSeconds={simulation.timestampSeconds} active={activePanel === 'construction'} phase={guidewayPhase} onPhaseChange={setGuidewayPhase} onOverlayChange={onConstructionOverlayChange} onEconomyChange={onConstructionEconomyChange} onCommitSuccess={(estimate) => { session.noteConstructionCommit(estimate); publishAchievements(); }} onViewLoans={() => { setActivePanel('finance'); setFinanceSection('loans'); setContextOpen(true); }} onNetwork={applyNetwork} onTransitOverlay={setTransitOverlaySafe} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId} engine={engine} snapshot={simulation} onSnapshot={updateSimulation} onPurchaseVehicle={(lineId, vehicleId) => { const vehicle = modeRegistry.getVehicleDefinition(vehicleId); const purchased = economy.purchaseVehicle(vehicle, simulation.timestampSeconds, lineId); if (purchased) { refreshEconomy(); setDirty(true); } return purchased; }} /></ModeSummary>)}
      {page('settings', <SettingsPanel developerMode={developerMode} onDeveloperModeChange={(enabled) => { setDeveloperMode(enabled); if (!enabled) setDrawerOpen(false); }} />)}
    </>
  );
  const drawer = developerMode ? (
    <BottomDrawer open={drawerOpen} title="Developer tools" onToggle={() => setDrawerOpen((open) => !open)}>
      <section className="developer-time"><p className="eyebrow">SIMULATION</p><h2>Manual time controls</h2><DevelopmentTimeControls engine={engine} onSnapshot={updateSimulation} clock={session} /></section>
      <OperationsDebug engine={engine} snapshot={simulation} />
      <DeveloperPanel diagnostic={diagnostic} />
      <ConstructionDebug world={world} coordinate={coordinate} economy={economy} timestampSeconds={simulation.timestampSeconds} onEconomyChange={refreshEconomy} developerMode workflow={constructionWorkflow} onOverlayChange={onConstructionOverlayChange} onCommit={(estimate) => { session.noteConstructionCommit(estimate); publishAchievements(); }} />
      <TransitNetworkDebug coordinate={coordinate} onOverlay={setTransitOverlaySafe} onNetwork={applyNetwork} active={drawerOpen} developerMode />
      <button className="secondary" type="button" onClick={() => { engine.replanPendingDemand(); setSimulation(engine.snapshot()); refreshDemand(); }}>Replan pending demand</button>
    </BottomDrawer>
  ) : null;

  return <GameplayShell hud={hud} activeTool={activeTool} onToolChange={chooseTool} map={map} context={context} contextOpen={contextOpen} onContextOpenChange={setContextOpen} drawer={drawer} />;
}

function MapLegend() {
  return (
    <aside className="map-legend" aria-label="Map legend">
      <strong>Legend</strong>
      <span><i className="legend-line local" />Local roads</span>
      <span><i className="legend-line arterial" />Arterials</span>
      <span><i className="legend-line highway" />Highways</span>
      <span><i className="legend-dot residents" />Residents</span>
      <span><i className="legend-dot jobs" />Jobs</span>
      <span><i className="legend-dot poi" />Places</span>
      <span><i className="legend-line water" />Water</span>
    </aside>
  );
}

function JourneyComparison({ world, network, engine, hour, onPreview }: { readonly world: World; readonly network: TransitNetwork; readonly engine: import('../time').SimulationEngine; readonly hour: number; readonly onPreview: (overlay: TransitOverlay) => void }) {
  const places = useMemo(() => [...world.definition.pointsOfInterest.map((item) => ({ id: `poi:${item.id}`, label: item.displayName ?? item.category, coordinate: item.coordinate })), ...world.definition.workplaces.filter((item) => item.displayName).slice(0, 50).map((item) => ({ id: `job:${item.id}`, label: item.displayName!, coordinate: item.coordinate }))].slice(0, 80), [world]);
  const [originId, setOriginId] = useState(places[0]?.id ?? ''); const [destinationId, setDestinationId] = useState(places[1]?.id ?? '');
  const origin = places.find((item) => item.id === originId); const destination = places.find((item) => item.id === destinationId);
  const result = origin && destination ? planJourney(origin.coordinate, destination.coordinate, network, engine.listLineServices(), { hourOfDay: hour }) : undefined;
  useEffect(() => {
    const base = networkToOverlay(network);
    if (!origin || !destination || result?.status !== 'planned') { onPreview(base); return; }
    const routeLines = result.legs.flatMap((leg) => network.getLine(leg.lineId)?.segments.filter((segment) => {
      const line = network.getLine(leg.lineId)!; const start = line.stopIds.indexOf(leg.boardStopId); const end = line.stopIds.indexOf(leg.alightStopId); const index = line.segments.indexOf(segment); return index >= Math.min(start, end) && index < Math.max(start, end);
    }).map((segment) => ({ id: `journey-${segment.id}`, geometry: segment.geometry, color: '#ffcf57' })) ?? []);
    onPreview({ ...base, lines: [...base.lines, ...routeLines], stops: [...base.stops, { id: 'journey-origin', coordinate: origin.coordinate, name: 'Origin', draftRole: 'start' }, { id: 'journey-destination', coordinate: destination.coordinate, name: 'Destination', draftRole: 'end' }] });
  }, [destination, network, onPreview, origin, result]);
  const minutes = result?.status === 'planned' ? Math.ceil(result.generalizedCostSeconds / 60) : undefined;
  return <section className="journey-comparison"><p className="eyebrow">TRIP COMPARISON</p><h3>Plan a journey</h3><label>Origin<select value={originId} onChange={(event) => setOriginId(event.target.value)}>{places.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label><label>Destination<select value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>{places.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>{!result ? <p className="empty-state">Choose two mapped places.</p> : result.status === 'unserved' ? <p className="operations-warning">No transit itinerary: {result.reason}</p> : <><strong className="journey-time">{minutes} min by transit</strong><dl><dt>Walk access</dt><dd>{Math.round(result.accessWalkMeters)} m</dd><dt>Expected wait</dt><dd>{Math.round(result.expectedWaitSeconds / 60)} min</dd><dt>In vehicle</dt><dd>{Math.round(result.inVehicleSeconds / 60)} min</dd><dt>Transfers</dt><dd>{result.transferCount}</dd></dl><ol>{result.legs.map((leg) => <li key={`${leg.lineId}-${leg.boardStopId}-${leg.alightStopId}`}>{network.getLine(leg.lineId)?.name ?? leg.lineId}: {network.getStop(leg.boardStopId)?.name} → {network.getStop(leg.alightStopId)?.name}</li>)}</ol></>}</section>;
}

function DallasScenarioGoals({ network, onFocus }: { readonly network: TransitNetwork; readonly onFocus: (coordinate: Coordinate, zoom: number) => void }) {
  const core: Coordinate = { latitude: 32.777, longitude: -96.797 };
  const airport: Coordinate = { latitude: 32.899, longitude: -97.04 };
  const north: Coordinate = { latitude: 33.02, longitude: -96.698 };
  const stopsNear = (target: Coordinate, meters: number, line: import('../transit').TransitLine) => line.stopIds.some((id) => { const stop = network.getStop(id); return Boolean(stop && distanceMeters(stop.coordinate, target) <= meters); });
  const activeLines = network.definition.lines.filter((line) => line.active);
  const connectsAirport = activeLines.some((line) => stopsNear(airport, 6_000, line) && stopsNear(core, 3_500, line));
  const downtownStops = network.definition.stops.filter((stop) => distanceMeters(stop.coordinate, core) <= 3_000).length;
  const connectsNorth = activeLines.some((line) => stopsNear(core, 3_500, line) && stopsNear(north, 5_000, line));
  const expressBus = activeLines.some((line) => line.mode === 'BUS' && line.stopIds.length >= 4);
  const [selected, setSelected] = useState('airport');
  const goals = [
    { id: 'airport', title: 'Airport connector', detail: 'One active line serves both DFW and Downtown.', done: connectsAirport, coordinate: airport, zoom: 11.7, action: 'Inspect DFW Airport' },
    { id: 'downtown', title: 'Downtown commuter', detail: 'Build three core-area stops.', done: downtownStops >= 3, progress: `${downtownStops} / 3 stops`, coordinate: core, zoom: 14.2, action: 'Inspect Downtown' },
    { id: 'north', title: 'North-growth corridor', detail: 'Link the core with Plano.', done: connectsNorth, coordinate: north, zoom: 11.8, action: 'Inspect Plano corridor' },
    { id: 'express', title: 'Highway express bus', detail: 'Operate a four-stop bus line.', done: expressBus, coordinate: { latitude: 32.82, longitude: -96.84 }, zoom: 12.2, action: 'Inspect highway corridor' },
  ];
  const goal = goals.find((item) => item.id === selected) ?? goals[0];
  return <section className="dallas-scenarios" aria-label="Dallas challenges"><p className="eyebrow">DALLAS CHALLENGES</p><h3>Build a better DFW</h3><p>Dallas starts DART-free: demand, roads, and jobs exist, but the player network is empty. Select a challenge to inspect its corridor.</p><div className="scenario-picker" role="tablist" aria-label="Dallas challenges">{goals.map((item) => <button key={item.id} type="button" role="tab" aria-selected={goal.id === item.id} className={goal.id === item.id ? 'active' : ''} onClick={() => setSelected(item.id)}><span aria-hidden="true">{item.done ? '✓' : '○'}</span>{item.title}</button>)}</div><article className="scenario-detail"><strong>{goal.title}</strong><p>{goal.detail}</p><small>{goal.done ? 'Achieved on the live network.' : goal.progress ?? 'Not yet achieved.'}</small><button type="button" className="secondary" onClick={() => onFocus(goal.coordinate, goal.zoom)}>{goal.action}</button></article><ul>{goals.map((item) => <li key={item.id}><strong><span aria-hidden="true">{item.done ? '✓' : '○'}</span>{item.title}</strong><small>{item.done ? 'Achieved' : item.progress ?? 'In progress'}</small></li>)}</ul></section>;
}

function NeighborhoodEquityDashboard({ requests, residentWeights }: { readonly requests: readonly import('../population').TravelRequest[]; readonly residentWeights: ReadonlyMap<string, number> }) {
  const districts: readonly { readonly name: string; readonly coordinate: Coordinate }[] = [
    { name: 'Downtown', coordinate: { latitude: 32.777, longitude: -96.797 } }, { name: 'Oak Cliff', coordinate: { latitude: 32.735, longitude: -96.835 } }, { name: 'North Dallas', coordinate: { latitude: 32.95, longitude: -96.80 } }, { name: 'East Dallas', coordinate: { latitude: 32.842, longitude: -96.726 } },
  ];
  const totals = districts.map((district) => ({ ...district, requests: 0, unserved: 0 }));
  for (const request of requests) {
    const target = totals.reduce((nearest, candidate) => distanceMeters(candidate.coordinate, request.origin) < distanceMeters(nearest.coordinate, request.origin) ? candidate : nearest);
    const weight = residentWeights.get(request.residentId) ?? 1;
    target.requests += weight;
    if (request.status === 'unserved') target.unserved += weight;
  }
  const rows = totals.filter((district) => district.requests > 0).sort((a, b) => b.unserved - a.unserved);
  return <section className="equity-dashboard" aria-label="Neighborhood equity dashboard"><p className="eyebrow">NEIGHBORHOOD EQUITY</p><h3>Who is being left behind?</h3><p>Live origin demand is weighted by the represented residents in each simulation agent.</p>{rows.length === 0 ? <p className="empty-state">Advance the simulation to compare neighborhood outcomes.</p> : <ul>{rows.map((district) => { const rate = Math.round(district.unserved / district.requests * 100); return <li key={district.name}><strong>{district.name}</strong><span>{district.unserved.toLocaleString()} unserved · {rate}%</span><i aria-label={`${rate}% unserved`} style={{ '--equity-rate': `${rate}%` } as React.CSSProperties} /></li>; })}</ul>}</section>;
}

function DallasTutorial({ step, onNext, onSkip }: { readonly step: number; readonly onNext: () => void; readonly onSkip: () => void }) {
  const pages = [
    ['WELCOME TO DALLAS', 'Start DART-free: the map has demand, roads, and jobs, but no player transit network. Your first line establishes coverage.'],
    ['FIND A CORRIDOR', 'Use Search to inspect Downtown, DFW Airport, or the north corridor. Begin with a bus line, or construct dedicated guideway for tram and subway service.'],
    ['BUILD FOR PEOPLE', 'The Data tool reveals residents, workplaces, and unserved demand. Connect dense origins to job centers and watch service outcomes.'],
    ['DALLAS CHALLENGES', 'Airport connector: link DFW to the core. Downtown commuter: relieve peak demand. North growth: connect Plano and Frisco. Express bus: bridge highway corridors.'],
  ] as const;
  const [heading, copy] = pages[step];
  return <aside className="dallas-tutorial" role="dialog" aria-label="Dallas tutorial"><p className="eyebrow">{heading}</p><p>{copy}</p><div><button type="button" className="secondary" onClick={onSkip}>Skip</button><button type="button" onClick={onNext}>{step === pages.length - 1 ? 'Start planning' : 'Next'}</button></div></aside>;
}

const dallasPresets: readonly { readonly label: string; readonly coordinate: Coordinate; readonly zoom: number }[] = [
  { label: 'Regional', coordinate: { latitude: 32.93, longitude: -96.80 }, zoom: 9.4 },
  { label: 'Downtown', coordinate: { latitude: 32.7787, longitude: -96.797 }, zoom: 14.3 },
  { label: 'DFW Airport', coordinate: { latitude: 32.8998, longitude: -97.0403 }, zoom: 13 },
  { label: 'North corridor', coordinate: { latitude: 33.035, longitude: -96.80 }, zoom: 11.5 },
];

function MapNavigator({ world, network, onFocus }: { readonly world: World; readonly network: TransitNetwork; readonly onFocus: (target: Coordinate, zoom?: number) => void }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(''); const normalized = query.trim().toLocaleLowerCase();
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent): void => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => searchInput.current?.focus()); } }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, []);
  const results = useMemo(() => {
    if (!normalized) return [];
    const places = [...world.definition.pointsOfInterest.map((item) => ({ label: item.displayName ?? item.category, coordinate: item.coordinate, type: 'Place' })), ...world.definition.workplaces.map((item) => ({ label: item.displayName ?? 'Workplace', coordinate: item.coordinate, type: 'Workplace' })), ...network.definition.stops.map((item) => ({ label: item.name, coordinate: item.coordinate, type: 'Station' })), ...world.definition.roads.filter((item) => item.name).map((item) => ({ label: item.name!, coordinate: item.geometry[Math.floor(item.geometry.length / 2)], type: 'Road' }))];
    const unique = new Map<string, typeof places[number]>(); places.forEach((item) => { if (item.label.toLocaleLowerCase().includes(normalized) && !unique.has(item.label)) unique.set(item.label, item); }); return [...unique.values()].slice(0, 7);
  }, [network.definition.stops, normalized, world]);
  const move = (target: Coordinate, zoom?: number): void => { onFocus(target, zoom); setOpen(false); setQuery(''); };
  return <section className="map-navigator" aria-label="Map search and camera presets"><button className="navigator-toggle" type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>⌕ Search</button>{open && <div className="navigator-card"><label><span>Search map</span><input ref={searchInput} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Place, station, road…" /></label>{normalized ? <ul className="search-results">{results.length ? results.map((item) => <li key={`${item.type}-${item.label}`}><button type="button" onClick={() => move(item.coordinate, item.type === 'Road' ? 14 : 15)}><strong>{item.label}</strong><small>{item.type}</small></button></li>) : <li className="no-results">No places in this map.</li>}</ul> : <div className="camera-presets"><span>Camera presets</span>{(world.definition.metadata.id === 'dallas' ? dallasPresets : []).map((preset) => <button type="button" key={preset.label} onClick={() => move(preset.coordinate, preset.zoom)}>{preset.label}</button>)}</div>}</div>}</section>;
}

function ScorePanel({ score, simulation, achievements }: { readonly score: ReturnType<typeof calculateScore>; readonly simulation: import('../time').SimulationSnapshot; readonly achievements: readonly { readonly id: string; readonly name: string; readonly description: string }[] }) {
  return (
    <section className="score-panel">
      <p className="eyebrow">NETWORK SCORE</p>
      <h2>{Math.round(score.total)}</h2>
      <p className="context-intro">Comparison score from ridership, coverage, reliability, financial health, and connectivity. Playtime alone does not inflate the total forever.</p>
      <dl>
        <dt>Ridership</dt><dd>{Math.round(score.components.ridership)}</dd>
        <dt>Coverage</dt><dd>{Math.round(score.components.coverage)}</dd>
        <dt>Reliability</dt><dd>{Math.round(score.components.reliability)}</dd>
        <dt>Financial health</dt><dd>{Math.round(score.components.financialHealth)}</dd>
        <dt>Connectivity</dt><dd>{Math.round(score.components.connectivity)}</dd>
        <dt>Boardings</dt><dd>{simulation.operations?.statistics.boardings ?? 0}</dd>
        <dt>Unserved trips</dt><dd>{simulation.population.unservedTrips}</dd>
      </dl>
      <h3>Achievements</h3>
      {achievements.length === 0 ? <p className="empty-state">No achievements unlocked yet.</p> : <ul>{achievements.map((item) => <li key={item.id}><strong>{item.name}</strong> — {item.description}</li>)}</ul>}
    </section>
  );
}

function GameMenuPanel({ onSave, onSaveExit, onExport, onImport, onRestart, onLevels }: { readonly onSave: () => void; readonly onSaveExit: () => void; readonly onExport: () => void; readonly onImport: (file: File) => void; readonly onRestart: () => void; readonly onLevels: () => void }) {
  const [confirmRestart, setConfirmRestart] = useState(false); const input = useRef<HTMLInputElement>(null);
  return (
    <section className="game-menu-panel">
      <p className="eyebrow">GAME MENU</p>
      <h2>Session</h2>
      <p className="context-intro">Saves stay on this device only. Display names are local profile labels, not secure authentication.</p>
      <div className="context-actions">
        <button type="button" onClick={onSave}>Save</button>
        <button type="button" onClick={onSaveExit}>Save & Exit</button>
        <button className="secondary" type="button" onClick={onExport}>Save As file</button>
        <button className="secondary" type="button" onClick={() => input.current?.click()}>Import save</button><input ref={input} className="sr-only" type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) onImport(file); event.currentTarget.value = ''; }} />
        {!confirmRestart ? <button className="secondary" type="button" onClick={() => setConfirmRestart(true)}>New Session</button> : <div className="restart-confirm" role="alert"><span>Discard this city’s saved session?</span><button className="secondary" type="button" onClick={() => setConfirmRestart(false)}>Keep</button><button className="danger" type="button" onClick={onRestart}>Discard & restart</button></div>}
        <button className="secondary" type="button" onClick={onLevels}>Return to Levels</button>
      </div>
    </section>
  );
}

function MapLayersOverlay({
  visibility,
  setToggle,
  setPopulation,
}: {
  readonly visibility: MapLayerVisibility;
  readonly setToggle: (key: keyof Omit<MapLayerVisibility, 'population'>, value: boolean) => void;
  readonly setPopulation: (value: MapLayerVisibility['population']) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`map-layers-overlay ${open ? 'open' : ''}`}>
      <button className="layers-toggle-btn" type="button" onClick={() => setOpen(!open)}>
        <MapControlIcon kind="layers" /> Layers
      </button>
      {open && (
        <div className="layers-card">
          <h4>Map Layers</h4>
          <label>
            <input
              type="checkbox"
              checked={visibility.buildings}
              onChange={(e) => setToggle('buildings', e.target.checked)}
            />
            Buildings
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.water}
              onChange={(e) => setToggle('water', e.target.checked)}
            />
            Waterways
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.workplaces}
              onChange={(e) => setToggle('workplaces', e.target.checked)}
            />
            Workplaces
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.pois}
              onChange={(e) => setToggle('pois', e.target.checked)}
            />
            Places (POIs)
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.tripDemand}
              onChange={(e) => setToggle('tripDemand', e.target.checked)}
            />
            Active Demand
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.unservedDemand}
              onChange={(e) => setToggle('unservedDemand', e.target.checked)}
            />
            Unserved Demand
          </label>
          <label>
            <input
              type="checkbox"
              checked={visibility.acquisitionCosts}
              onChange={(e) => setToggle('acquisitionCosts', e.target.checked)}
            />
            Acquisition costs
          </label>
          <div className="population-mode-selector">
            <span>Population</span>
            <select
              value={visibility.population}
              onChange={(e) => setPopulation(e.target.value as MapLayerVisibility['population'])}
            >
              <option value="none">Hidden</option>
              <option value="points">Points</option>
              <option value="density">Density Heatmap</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function CameraControls({
  onReset,
  onTiltToggle,
  onZoomIn,
  onZoomOut,
}: {
  readonly onReset: () => void;
  readonly onTiltToggle: () => void;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
}) {
  return (
    <div className="camera-controls-widget">
      <button type="button" aria-label="Reset Viewport Orientation" title="Reset Viewport Orientation" onClick={onReset}><MapControlIcon kind="compass" /></button>
      <button type="button" title="Toggle 2D / 3D tilt" onClick={onTiltToggle}>3D</button>
      <button type="button" title="Zoom In" onClick={onZoomIn}>＋</button>
      <button type="button" title="Zoom Out" onClick={onZoomOut}>－</button>
    </div>
  );
}
