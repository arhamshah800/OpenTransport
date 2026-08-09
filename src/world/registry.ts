import { World } from './World';
import { validateLevel } from './validation';
import type { LevelDefinition, LevelSummary } from './types';

export interface LevelManifestEntry { readonly summary: LevelSummary; readonly load: () => Promise<LevelDefinition>; }
export function createLevelRegistry(entries: readonly LevelManifestEntry[]) {
  const entriesById = new Map(entries.map((entry) => [entry.summary.id, entry]));
  if (entriesById.size !== entries.length) throw new Error('Level manifest contains duplicate IDs');
  return {
    listLevels: (): readonly LevelSummary[] => entries.map(({ summary }) => summary),
    loadLevel: async (id: string): Promise<World> => {
      const entry = entriesById.get(id);
      if (!entry) throw new Error(`Unknown level "${id}"`);
      const definition = await entry.load();
      validateLevel(definition);
      return new World(definition);
    },
  };
}
