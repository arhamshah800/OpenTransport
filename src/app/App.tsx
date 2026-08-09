import { lazy, Suspense, useEffect, useState } from 'react';
import { levelRegistry } from '../levels/manifest';
import type { World } from '../world';
import { LocalProfileRepository, LocalStorageSaveRepository, type GameSave, type PlayerProfile } from '../game';

const MapView = lazy(() => import('../map/MapView').then((module) => ({ default: module.MapView })));

const saves = new LocalStorageSaveRepository();
const profiles = new LocalProfileRepository();
const defaultPlayer = (): PlayerProfile => ({ id: 'local-player', displayName: 'Planner', achievementIds: [], settings: { autosave: true } });

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [save, setSave] = useState<GameSave | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerProfile>(defaultPlayer);
  const [continueIds, setContinueIds] = useState<ReadonlySet<string>>(new Set());
  const levels = levelRegistry.listLevels();

  useEffect(() => {
    void (async () => {
      const profile = await profiles.load();
      if (profile) setPlayer(profile);
      else await profiles.save(defaultPlayer());
      const available = new Set<string>();
      for (const level of levels) {
        if (await saves.hasSave(level.id)) available.add(level.id);
      }
      setContinueIds(available);
    })();
  }, [levels]);

  const load = async (id: string, mode: 'new' | 'continue'): Promise<void> => {
    try {
      setError(null);
      const nextWorld = await levelRegistry.loadLevel(id);
      if (mode === 'continue') {
        const existing = await saves.load(id);
        if (!existing) throw new Error('No compatible save was found for this city.');
        if (existing.levelId !== nextWorld.definition.metadata.id || existing.levelVersion !== nextWorld.definition.metadata.version) {
          throw new Error('That save belongs to a different city version and cannot be continued here.');
        }
        setSave(existing);
      } else {
        setSave(undefined);
      }
      setWorld(nextWorld);
    } catch (reason) {
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
      <Suspense fallback={<main className="app-shell"><p className="intro">Loading city map…</p></main>}>
        <MapView
          world={world}
          player={player}
          initialSave={save}
          onBack={() => { setWorld(null); setSave(undefined); void saves.hasSave(world.definition.metadata.id).then((has) => setContinueIds((current) => { const next = new Set(current); if (has) next.add(world.definition.metadata.id); else next.delete(world.definition.metadata.id); return next; })); }}
        />
      </Suspense>
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
