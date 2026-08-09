import { useState } from 'react';
import { levelRegistry } from '../levels/manifest';
import type { World } from '../world';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const levels = levelRegistry.listLevels();
  const load = async (id: string): Promise<void> => { try { setError(null); setWorld(await levelRegistry.loadLevel(id)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load level'); } };
  if (world) return <LoadedWorld world={world} onBack={() => setWorld(null)} />;
  return <main className="app-shell"><header><p className="eyebrow">TRANSPORT STRATEGY SANDBOX</p><h1>OpenTransport</h1><p className="intro">Choose a city package to begin planning. Cities are static, validated data - never game-engine code.</p></header><section aria-label="Available levels" className="level-grid">{levels.map((level) => <article className="level-card" key={level.id}><p className="eyebrow">LEVEL PACKAGE</p><h2>{level.name}</h2><p>{level.description}</p><dl><div><dt>Population</dt><dd>{level.approximatePopulation?.toLocaleString() ?? 'Not specified'}</dd></div><div><dt>Map extent</dt><dd>{(level.bounds.northEast.latitude - level.bounds.southWest.latitude).toFixed(3)}° × {(level.bounds.northEast.longitude - level.bounds.southWest.longitude).toFixed(3)}°</dd></div></dl><button type="button" onClick={() => void load(level.id)}>Load level</button></article>)}</section>{error && <p role="alert" className="error">{error}</p>}</main>;
}

function LoadedWorld({ world, onBack }: { readonly world: World; readonly onBack: () => void }) {
  const { definition: level } = world;
  const metrics = [['Roads', level.roads.length], ['Buildings', level.buildings.length], ['Population records', level.population.length], ['Workplaces', level.workplaces.length], ['POIs', level.pointsOfInterest.length], ['Waterways', level.waterways.length]];
  return <main className="app-shell"><button className="back" type="button" onClick={onBack}>← All levels</button><p className="eyebrow">WORLD LOADED</p><h1>{level.metadata.name}</h1><p className="intro">The runtime world holds read-only indexes for later simulation modules while the source level remains immutable.</p><section className="debug-panel" aria-label="Loaded level diagnostics"><h2>Level debug summary</h2><div className="metric-grid">{metrics.map(([name, value]) => <div key={name as string}><span>{name}</span><strong>{(value as number).toLocaleString()}</strong></div>)}<div><span>Starting budget</span><strong>{money.format(level.economy.startingBudget)}</strong></div></div><p className="index-note">Indexes ready: {world.roadsById.size} roads, {world.buildingsById.size} buildings, {world.workplacesById.size} workplaces, and {world.pointsOfInterestById.size} POIs.</p></section></main>;
}
