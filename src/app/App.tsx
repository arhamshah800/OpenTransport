import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { levelRegistry } from '../levels/manifest';
import type { World } from '../world';
import { LocalProfileRepository, LocalStorageSaveRepository, type GameSave, type PlayerProfile } from '../game';
import { GameErrorBoundary } from './GameErrorBoundary';

const MapView = lazy(() => import('../map/MapView').then((module) => ({ default: module.MapView })));

const saves = new LocalStorageSaveRepository();
const profiles = new LocalProfileRepository();
const defaultPlayer = (): PlayerProfile => ({ id: 'local-player', displayName: 'Planner', achievementIds: [], settings: { autosave: true } });

const setsEqual = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
};

/** Cheap pre-check so Continue never mounts MapView on a save that will throw in GameSession. */
export const validateSaveForLoad = (save: GameSave, levelId: string, levelVersion: number): void => {
  if (save.saveVersion !== 1 || save.gameSchemaVersion !== 1) throw new Error('Unsupported save schema version.');
  if (save.levelId !== levelId || save.levelVersion !== levelVersion) {
    throw new Error('That save belongs to a different city version and cannot be continued here.');
  }
  if (!Number.isInteger(save.seed)) throw new Error('Save seed is invalid. Start a new game for this city.');
  if (!save.transitNetwork || !Array.isArray(save.transitNetwork.lines) || !Array.isArray(save.transitNetwork.stops)) {
    throw new Error('Save transit network is malformed. Start a new game for this city.');
  }
};

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [save, setSave] = useState<GameSave | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerProfile>(defaultPlayer);
  const [continueIds, setContinueIds] = useState<ReadonlySet<string>>(new Set());
  const levels = useMemo(() => levelRegistry.listLevels(), []);
  const commitCount = useRef(0);
  const commitWindowStart = useRef(typeof performance !== 'undefined' ? performance.now() : 0);
  const loopWarned = useRef(false);

  useEffect(() => {
    if (import.meta.env.DEV) {
      commitCount.current += 1;
      const now = performance.now();
      if (now - commitWindowStart.current >= 1000) {
        if (commitCount.current > 30 && !loopWarned.current) {
          loopWarned.current = true;
          console.warn('OpenTransport: App exceeded 30 commits/sec — check unstable effect dependencies.');
        }
        commitCount.current = 0;
        commitWindowStart.current = now;
      }
    }
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const profile = await profiles.load();
      if (cancelled) return;
      if (profile) {
        setPlayer((current) => (current.id === profile.id && current.displayName === profile.displayName ? current : profile));
      } else {
        await profiles.save(defaultPlayer());
      }
      const available = new Set<string>();
      for (const level of levels) {
        if (await saves.hasSave(level.id)) available.add(level.id);
      }
      if (cancelled) return;
      setContinueIds((current) => (setsEqual(current, available) ? current : available));
    })();
    return () => { cancelled = true; };
  }, [levels]);

  const exitToLevels = (): void => {
    setWorld(null);
    setSave(undefined);
  };

  const load = async (id: string, mode: 'new' | 'continue'): Promise<void> => {
    try {
      setError(null);
      const nextWorld = await levelRegistry.loadLevel(id);
      if (mode === 'continue') {
        const existing = await saves.load(id);
        if (!existing) throw new Error('No compatible save was found for this city.');
        validateSaveForLoad(existing, nextWorld.definition.metadata.id, nextWorld.definition.metadata.version);
        setSave(existing);
      } else {
        setSave(undefined);
      }
      setWorld(nextWorld);
    } catch (reason) {
      setWorld(null);
      setSave(undefined);
      setError(reason instanceof Error ? reason.message : 'Unable to load level');
    }
  };

  const rename = async (displayName: string): Promise<void> => {
    const next = { ...player, displayName: displayName.trim() || player.displayName };
    setPlayer(next);
    await profiles.save(next);
  };

  if (world) {
    return (
      <GameErrorBoundary fallbackTitle="Unable to open this city" onReset={exitToLevels}>
        <Suspense fallback={<main className="app-shell"><p className="intro">Loading city map…</p></main>}>
          <MapView
            world={world}
            player={player}
            initialSave={save}
            onBack={() => {
              const levelId = world.definition.metadata.id;
              exitToLevels();
              void saves.hasSave(levelId).then((has) => setContinueIds((current) => {
                const next = new Set(current);
                if (has) next.add(levelId);
                else next.delete(levelId);
                return setsEqual(current, next) ? current : next;
              }));
            }}
          />
        </Suspense>
      </GameErrorBoundary>
    );
  }

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">TRANSPORT STRATEGY SANDBOX</p>
        <h1>OpenTransport</h1>
        <p className="intro">Choose a city package to begin planning. Cities are static, validated data — never game-engine code. Saves stay on this device only (not secure account auth).</p>
        <label className="profile-field">Display name <input aria-label="Local profile display name" value={player.displayName} onChange={(event) => void rename(event.target.value)} /></label>
      </header>
      <section aria-label="Available levels" className="level-grid">
        {levels.map((level) => (
          <article className="level-card" key={level.id}>
            <p className="eyebrow">LEVEL PACKAGE</p>
            <h2>{level.name}</h2>
            <p>{level.description}</p>
            <dl>
              <div><dt>Population</dt><dd>{level.approximatePopulation?.toLocaleString() ?? 'Not specified'}</dd></div>
              <div><dt>Map extent</dt><dd>{(level.bounds.northEast.latitude - level.bounds.southWest.latitude).toFixed(3)}° × {(level.bounds.northEast.longitude - level.bounds.southWest.longitude).toFixed(3)}°</dd></div>
            </dl>
            <div className="level-actions">
              <button type="button" onClick={() => void load(level.id, 'new')}>New Game</button>
              <button className="secondary" type="button" disabled={!continueIds.has(level.id)} onClick={() => void load(level.id, 'continue')}>
                {continueIds.has(level.id) ? 'Continue' : 'No save'}
              </button>
            </div>
          </article>
        ))}
      </section>
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
