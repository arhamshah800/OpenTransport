import { useState } from 'react';
import { levelRegistry } from '../levels/manifest';
import type { World } from '../world';
import { MapView } from '../map';

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const levels = levelRegistry.listLevels();
  const load = async (id: string): Promise<void> => { try { setError(null); setWorld(await levelRegistry.loadLevel(id)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load level'); } };
  if (world) return <MapView world={world} onBack={() => setWorld(null)} />;
  return <main className="app-shell"><header><p className="eyebrow">TRANSPORT STRATEGY SANDBOX</p><h1>OpenTransport</h1><p className="intro">Choose a city package to begin planning. Cities are static, validated data - never game-engine code.</p></header><section aria-label="Available levels" className="level-grid">{levels.map((level) => <article className="level-card" key={level.id}><p className="eyebrow">LEVEL PACKAGE</p><h2>{level.name}</h2><p>{level.description}</p><dl><div><dt>Population</dt><dd>{level.approximatePopulation?.toLocaleString() ?? 'Not specified'}</dd></div><div><dt>Map extent</dt><dd>{(level.bounds.northEast.latitude - level.bounds.southWest.latitude).toFixed(3)}° × {(level.bounds.northEast.longitude - level.bounds.southWest.longitude).toFixed(3)}°</dd></div></dl><button type="button" onClick={() => void load(level.id)}>Load level</button></article>)}</section>{error && <p role="alert" className="error">{error}</p>}</main>;
}
