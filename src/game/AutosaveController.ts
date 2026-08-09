import type { SaveRepository } from './types';
import type { GameSession } from './GameSession';

/** Throttles persistence by simulated time; callers invoke it after snapshots, never per animation frame. */
export class AutosaveController {
  private lastSavedAtSeconds = -Infinity;
  private lastWallSaveMs = 0;
  public constructor(private readonly repository: SaveRepository, private readonly intervalSeconds = 300, private readonly minWallMs = 2_000) {}
  public async saveIfDue(session: GameSession): Promise<boolean> {
    const now = session.dashboard().simulation.timestampSeconds;
    if (now - this.lastSavedAtSeconds < this.intervalSeconds) return false;
    await this.repository.save(session.save());
    this.lastSavedAtSeconds = now;
    this.lastWallSaveMs = performance.now();
    return true;
  }
  /** Menu/explicit saves pass force; hover/preview callers must not. */
  public async saveNow(session: GameSession, options: { readonly force?: boolean } = {}): Promise<boolean> {
    const wall = performance.now();
    if (!options.force && wall - this.lastWallSaveMs < this.minWallMs) return false;
    await this.repository.save(session.save());
    this.lastSavedAtSeconds = session.dashboard().simulation.timestampSeconds;
    this.lastWallSaveMs = wall;
    return true;
  }
}
