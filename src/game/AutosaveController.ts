import type { SaveRepository } from './types';
import type { GameSession } from './GameSession';

/** Throttles persistence by simulated time; callers invoke it after snapshots, never per animation frame. */
export class AutosaveController {
  private lastSavedAtSeconds = -Infinity;
  public constructor(private readonly repository: SaveRepository, private readonly intervalSeconds = 300) {}
  public async saveIfDue(session: GameSession): Promise<boolean> { const now = session.dashboard().simulation.timestampSeconds; if (now - this.lastSavedAtSeconds < this.intervalSeconds) return false; await this.repository.save(session.save()); this.lastSavedAtSeconds = now; return true; }
  public async saveNow(session: GameSession): Promise<void> { await this.repository.save(session.save()); this.lastSavedAtSeconds = session.dashboard().simulation.timestampSeconds; }
}
