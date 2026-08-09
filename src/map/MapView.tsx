import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { World } from '../world';
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
import { aggregateRequestsByEndpoint } from '../population';
import { AutosaveController, calculateScore, GameSession, LocalStorageSaveRepository, type GameSave, type PlayerProfile } from '../game';
import { MapLibreController } from './MapLibreController';
import type { DemandOverlay, MapController, MapDiagnostic, MapLayerVisibility, MapLifecycleStatus, MapSelection, TransitOverlay } from './types';
import { BottomDrawer, GameplayShell, type GameplayTool } from './GameplayShell';
import { LocalMapFallback } from './LocalMapFallback';
import { DataPanel, DeveloperPanel, InspectorPanel, ModeSummary, SettingsPanel } from './ToolPanels';
import { ConstructionMapOverlay } from './ConstructionMapOverlay';
import { GuidewayWorkspace } from './GuidewayWorkspace';
import 'maplibre-gl/dist/maplibre-gl.css';

const initialVisibility: MapLayerVisibility = { population: 'points', workplaces: true, buildings: true, pois: true, water: true, tripDemand: false, unservedDemand: false, roadIds: false, buildingIds: false, bounds: false };
const compactMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
type ContextPanel = 'inspector' | 'data' | 'transit' | 'construction' | 'finance' | 'settings' | 'menu' | 'score';

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

export function MapView({ world, onBack, player, initialSave }: { readonly world: World; readonly onBack: () => void; readonly player?: PlayerProfile; readonly initialSave?: GameSave }) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<MapController | null>(null);
  const saveRepo = useMemo(() => new LocalStorageSaveRepository(), []);
  const sessionRef = useRef<GameSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new GameSession(world, initialSave?.seed ?? 12345, player ?? { id: 'local-player', displayName: 'Planner', achievementIds: [], settings: { autosave: true } }, initialSave);
  }
  const session = sessionRef.current;
  const economy = session.getEconomy();
  const engine = session.getSimulation();
  const autosave = useMemo(() => new AutosaveController(saveRepo, 300), [saveRepo]);

  const [selection, setSelection] = useState<MapSelection>(null);
  const [coordinate, setCoordinate] = useState<{ readonly latitude: number; readonly longitude: number } | null>(null);
  const [hoverCoordinate, setHoverCoordinate] = useState<{ readonly latitude: number; readonly longitude: number } | null>(null);
  const [pointer, setPointer] = useState<{ readonly x: number; readonly y: number } | null>(null);
  const [clickVersion, setClickVersion] = useState(0);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [transitOverlay, setTransitOverlay] = useState<TransitOverlay>({ lines: [], stops: [] });
  const [network, setNetwork] = useState(() => session.getNetwork());
  const constructionWorkflow = useMemo(() => new ConstructionWorkflow(world, economy, session.getConstruction()), [world, economy, session]);
  const [constructionOverlay, setConstructionOverlay] = useState<ConstructionOverlayState>(() => constructionWorkflow.snapshot());
  const [simulation, setSimulation] = useState(() => engine.snapshot());
  const [mapStatus, setMapStatus] = useState<MapLifecycleStatus>('LOADING');
  const [mapError, setMapError] = useState<string>();
  const [diagnostic, setDiagnostic] = useState<MapDiagnostic>();
  const [activeTool, setActiveTool] = useState<GameplayTool>('select');
  const activeToolRef = useRef<GameplayTool>('select');
  const [activePanel, setActivePanel] = useState<ContextPanel>('inspector');
  const [contextOpen, setContextOpen] = useState(true);
  const [developerMode, setDeveloperMode] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [achievementToast, setAchievementToast] = useState<string | null>(null);
  const seenAchievements = useRef(new Set(session.dashboard().achievements.map((item) => item.id)));
  const networkRef = useRef(network);
  useEffect(() => { networkRef.current = network; }, [network]);

  const lastPlacementAt = useRef(0);
  const lastPlacementKey = useRef('');
  const placeCoordinate = useCallback((next: { readonly latitude: number; readonly longitude: number }): void => {
    const now = performance.now();
    const key = `${next.latitude.toFixed(4)},${next.longitude.toFixed(4)}`;
    if (key === lastPlacementKey.current && now - lastPlacementAt.current < 700) return;
    lastPlacementKey.current = key;
    lastPlacementAt.current = now;
    setCoordinate(next);
    setClickVersion((value) => value + 1);
  }, []);

  const applyNetwork = useCallback((next: TransitNetwork): void => {
    setNetwork(next);
    session.replaceNetwork(next);
  }, [session]);

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
    const instance = new MapLibreController({
      container: container.current,
      world,
      onSelection: selectFeature,
      onCoordinate: placeCoordinate,
      onLifecycle: (status, message, nextDiagnostic) => {
        setMapStatus(status);
        setMapError(message);
        if (nextDiagnostic) setDiagnostic(nextDiagnostic);
      },
    });
    controller.current = instance;
    return () => {
      instance.destroy();
      if (controller.current === instance) controller.current = null;
    };
  }, [placeCoordinate, selectFeature, world]);

  useEffect(() => { controller.current?.setTransitOverlay(transitOverlay); }, [transitOverlay]);
  useEffect(() => { setTransitOverlay((current) => ({ ...networkToOverlay(network, selectedLineId ?? undefined), vehicles: current.vehicles })); }, [network, selectedLineId]);
  const setTransitOverlaySafe = useCallback((overlay: TransitOverlay) => {
    setTransitOverlay((current) => ({ ...overlay, vehicles: overlay.vehicles ?? current.vehicles }));
  }, []);

  const refreshDemand = useCallback(() => {
    controller.current?.setDemandOverlay(toDemandOverlay(session));
  }, [session]);

  const updateSimulation = useCallback((snapshot: import('../time').SimulationSnapshot): void => {
    setSimulation(snapshot);
    refreshDemand();
    session.setConstruction(constructionWorkflow.snapshot().state);
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
          };
        }),
      }));
    }
    void autosave.saveIfDue(session).then((saved) => {
      if (saved) {
        setSaveMessage('Saved just now');
        window.setTimeout(() => setSaveMessage(null), 2500);
      }
    });
  }, [autosave, constructionWorkflow, refreshDemand, session]);

  const refreshEconomy = useCallback(() => setSimulation(engine.snapshot()), [engine]);
  const setToggle = (key: keyof Omit<MapLayerVisibility, 'population'>, value: boolean): void => {
    controller.current?.setLayerVisibility(key, value);
    setVisibility((current) => ({ ...current, [key]: value }));
  };
  const setPopulation = (value: MapLayerVisibility['population']): void => {
    controller.current?.setPopulationMode(value);
    setVisibility((current) => ({ ...current, population: value }));
  };
  const captureMapCoordinate = (event: ReactMouseEvent<HTMLElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const mapCoordinate = controller.current?.coordinateFromScreen(event.clientX - bounds.left, event.clientY - bounds.top);
    if (mapCoordinate) placeCoordinate(mapCoordinate);
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
    setActivePanel(tool === 'select' ? 'inspector' : tool === 'data' ? 'data' : tool === 'bus' ? 'transit' : 'construction');
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      const tool = event.key === 'Escape' ? 'select' : event.key === '1' ? 'bus' : event.key === '2' ? 'tram' : event.key === '3' ? 'subway' : null;
      if (tool) { event.preventDefault(); chooseTool(tool); setContextOpen(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chooseTool]);

  const persist = async (exit = false): Promise<void> => {
    session.setConstruction(constructionWorkflow.snapshot().state);
    session.replaceNetwork(network);
    await autosave.saveNow(session);
    setSaveMessage('Saved just now');
    window.setTimeout(() => setSaveMessage(null), 2500);
    if (exit) onBack();
  };

  const finances = economy.getFinancialSummary(simulation.timestampSeconds);
  const score = calculateScore(simulation, network);
  const stopStats = selection?.kind === 'station' ? engine.stopPassengerStats(selection.id) : undefined;

  const hud = (
    <header className="top-hud">
      <button className="hud-menu" type="button" onClick={() => { setActivePanel('menu'); setContextOpen(true); }}>Menu</button>
      <div className="hud-city"><span>TRANSPORT NETWORK</span><strong>{world.definition.metadata.name}</strong></div>
      <SimulationControls engine={engine} snapshot={simulation} onSnapshot={updateSimulation} compact />
      <button className={`hud-cash ${activePanel === 'score' ? 'active' : ''}`} type="button" onClick={() => { setActivePanel('score'); setContextOpen(true); }}>
        <span>Score</span><strong>{Math.round(score.total)}</strong>
      </button>
      <button className={`hud-cash ${activePanel === 'finance' ? 'active' : ''}`} type="button" onClick={() => { setActivePanel('finance'); setContextOpen(true); }}>
        <span>Cash · Today · Debt</span>
        <strong>{compactMoney.format(finances.cashCents / 100)} · {compactMoney.format(finances.today.cashCents / 100)} · {compactMoney.format(finances.debtCents / 100)}</strong>
      </button>
      <button className={`hud-settings ${activePanel === 'settings' ? 'active' : ''}`} type="button" title="Settings" aria-label="Open settings" onClick={() => { setActivePanel('settings'); setContextOpen(true); }}>⚙</button>
      <button className="hud-panel-button" type="button" onClick={() => setContextOpen((open) => !open)}>Panel</button>
    </header>
  );

  const map = (
    <section className="map-canvas" onClick={captureMapCoordinate} onMouseMove={captureHoverCoordinate} onMouseLeave={() => { setHoverCoordinate(null); setPointer(null); }}>
      <LocalMapFallback world={world} visibility={visibility} transit={transitOverlay} onSelect={selectFeature} />
      <div ref={container} className="maplibre-container" />
      <ConstructionMapOverlay world={world} overlay={constructionOverlay} />
      <ConstructionCostChip preview={activePanel === 'construction' ? constructionOverlay.pending : undefined} pointer={pointer} />
      {mapStatus === 'LOADING' && <div className="map-status loading" role="status">Loading {world.definition.metadata.name}…</div>}
      {mapStatus === 'ERROR' && <div className="map-status error-panel" role="alert"><strong>Map failed to load</strong><span>The city geography could not be rendered.</span>{developerMode && <details><summary>Developer details</summary><pre>{mapError ?? 'No additional diagnostic was provided.'}</pre></details>}</div>}
      {saveMessage && <div className="map-status save-toast" role="status">{saveMessage}</div>}
      {achievementToast && <div className="map-status achievement-toast" role="status">Achievement: {achievementToast}</div>}
      <button className="reset-camera" type="button" onClick={(event) => { event.stopPropagation(); controller.current?.resetCamera(); }}>Reset view</button>
      <MapLegend />
    </section>
  );

  const page = (id: ContextPanel, content: ReactNode) => <div className="context-page" hidden={activePanel !== id}>{content}</div>;
  const guidewayMode = activeTool === 'tram' ? 'TRAM' as const : 'SUBWAY' as const;
  const context = (
    <>
      {page('inspector', <InspectorPanel world={world} selection={selection} coordinate={coordinate} network={network} transit={transitOverlay} simulation={simulation} stopStats={stopStats} />)}
      {page('data', <DataPanel visibility={visibility} developerMode={developerMode} population={simulation.population} operations={simulation.operations} setPopulation={setPopulation} setToggle={setToggle} />)}
      {page('finance', <FinancePanel economy={economy} timestampSeconds={simulation.timestampSeconds} developerMode={developerMode} onChange={refreshEconomy} onTakeLoan={(productId) => { session.execute({ type: 'TAKE_LOAN', productId }); refreshEconomy(); }} />)}
      {page('score', <ScorePanel score={score} simulation={simulation} achievements={session.dashboard().achievements} />)}
      {page('menu', <GameMenuPanel onSave={() => void persist(false)} onSaveExit={() => void persist(true)} onRestart={() => { window.location.reload(); }} onLevels={onBack} />)}
      {page('transit', <ModeSummary modeId="BUS"><BusLinePanel world={world} network={network} coordinate={coordinate} clickVersion={clickVersion} hoverCoordinate={hoverCoordinate} active={activePanel === 'transit'} onNetwork={applyNetwork} onOverlay={setTransitOverlaySafe} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId} engine={engine} snapshot={simulation} onSnapshot={updateSimulation} /></ModeSummary>)}
      {page('construction', <ModeSummary modeId={guidewayMode}><GuidewayWorkspace mode={guidewayMode} world={world} network={network} construction={constructionOverlay.state} workflow={constructionWorkflow} coordinate={coordinate} clickVersion={clickVersion} hoverCoordinate={hoverCoordinate} timestampSeconds={simulation.timestampSeconds} active={activePanel === 'construction'} onOverlayChange={(overlay) => { setConstructionOverlay(overlay); session.setConstruction(overlay.state); void autosave.saveNow(session).then(() => { setSaveMessage('Saved just now'); window.setTimeout(() => setSaveMessage(null), 2500); }); }} onEconomyChange={refreshEconomy} onNetwork={applyNetwork} onTransitOverlay={setTransitOverlaySafe} selectedLineId={selectedLineId} onSelectLine={setSelectedLineId} engine={engine} snapshot={simulation} onSnapshot={updateSimulation} /></ModeSummary>)}
      {page('settings', <SettingsPanel developerMode={developerMode} onDeveloperModeChange={(enabled) => { setDeveloperMode(enabled); if (!enabled) setDrawerOpen(false); }} />)}
    </>
  );
  const drawer = developerMode ? (
    <BottomDrawer open={drawerOpen} title="Developer tools" onToggle={() => setDrawerOpen((open) => !open)}>
      <section className="developer-time"><p className="eyebrow">SIMULATION</p><h2>Manual time controls</h2><DevelopmentTimeControls engine={engine} onSnapshot={updateSimulation} /></section>
      <OperationsDebug engine={engine} snapshot={simulation} />
      <DeveloperPanel diagnostic={diagnostic} />
      <ConstructionDebug world={world} coordinate={coordinate} economy={economy} timestampSeconds={simulation.timestampSeconds} onEconomyChange={refreshEconomy} developerMode />
      <TransitNetworkDebug coordinate={coordinate} onOverlay={setTransitOverlaySafe} onNetwork={applyNetwork} active={drawerOpen} developerMode />
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

function GameMenuPanel({ onSave, onSaveExit, onRestart, onLevels }: { readonly onSave: () => void; readonly onSaveExit: () => void; readonly onRestart: () => void; readonly onLevels: () => void }) {
  return (
    <section className="game-menu-panel">
      <p className="eyebrow">GAME MENU</p>
      <h2>Session</h2>
      <p className="context-intro">Saves stay on this device only. Display names are local profile labels, not secure authentication.</p>
      <div className="context-actions">
        <button type="button" onClick={onSave}>Save</button>
        <button type="button" onClick={onSaveExit}>Save & Exit</button>
        <button className="secondary" type="button" onClick={onRestart}>Restart City</button>
        <button className="secondary" type="button" onClick={onLevels}>Return to Levels</button>
      </div>
    </section>
  );
}
