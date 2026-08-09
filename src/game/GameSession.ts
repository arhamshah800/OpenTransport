import { ConstructionEngine, type ConstructionState } from '../construction';
import { Economy } from '../economy';
import { TransitNetwork } from '../transit';
import { SimulationEngine } from '../time';
import type { World } from '../world';
import { calculateScore } from './scoring';
import type { Achievement, GameCommand, GameDashboard, GameSave, NetworkDesign, PlayerProfile } from './types';

const achievements: readonly Achievement[] = [
  { id: 'first-route', name: 'First Route', description: 'Operate your first transit route.' },
  { id: 'first-tram', name: 'First Tram Line', description: 'Create a tram line.' },
  { id: 'first-subway', name: 'First Subway Line', description: 'Create a subway line.' },
  { id: 'first-loan', name: 'Expansion Financed', description: 'Take a capital loan.' },
  { id: 'river-crossing', name: 'Cross the River', description: 'Build a subway alignment under a waterway.' },
  { id: 'thousand-riders', name: '1,000 Riders', description: 'Record 1,000 boardings on your network.' },
  { id: 'profitable-day', name: 'Profitable Day', description: 'Finish a day with positive net operations from fares.' },
];
const emptyConstruction = (): ConstructionState => ({ demolishedBuildingIds: [], engineeringSegments: [], stations: [] });

/** Coordinates player commands and save-ready state without absorbing subsystem domain logic. */
export class GameSession {
  private network: TransitNetwork;
  private construction: ConstructionState;
  private economy: Economy;
  private simulation: SimulationEngine;
  private readonly constructionEngine: ConstructionEngine;
  private unlocked = new Set<string>();

  public constructor(private readonly world: World, private readonly seed: number, private readonly player: PlayerProfile, saved?: GameSave) {
    if (saved) {
      this.assertSaveCompatibility(saved);
      this.network = new TransitNetwork(saved.transitNetwork);
      this.construction = saved.construction;
      this.economy = Economy.restore(saved.economy);
      this.unlocked = new Set(saved.unlockedAchievementIds);
      this.simulation = new SimulationEngine(world, this.economy, this.network, { seed, state: saved.simulation });
    } else {
      this.network = new TransitNetwork();
      this.construction = emptyConstruction();
      this.economy = new Economy(world.definition.economy.startingBudget);
      this.simulation = new SimulationEngine(world, this.economy, this.network, { seed });
    }
    this.constructionEngine = new ConstructionEngine(world);
  }

  public execute(command: GameCommand): { readonly ok: boolean; readonly message: string } {
    try {
      if (command.type === 'SET_SPEED') {
        this.simulation.setSpeed(command.speed);
        return { ok: true, message: 'Simulation speed updated.' };
      }
      if (command.type === 'TAKE_LOAN') {
        this.economy.takeLoan(command.productId, this.simulation.snapshot().timestampSeconds);
        this.unlock('first-loan');
        return { ok: true, message: 'Loan proceeds added to cash.' };
      }
      const evaluation = this.constructionEngine.evaluate(command.proposal, this.construction);
      if (!evaluation.plan) return { ok: false, message: evaluation.issues.map((issue) => issue.message).join(' ') || 'Construction proposal is invalid.' };
      if (!this.economy.recordConstruction(evaluation.estimate, this.simulation.snapshot().timestampSeconds, evaluation.plan.proposal.id)) {
        return { ok: false, message: 'Insufficient cash. Construction was not committed.' };
      }
      this.construction = this.constructionEngine.commit(evaluation.plan, this.construction);
      if (evaluation.estimate.riverCrossingIds.length) this.unlock('river-crossing');
      return { ok: true, message: 'Construction committed.' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Command failed.' };
    }
  }

  public replaceNetwork(network: TransitNetwork): void {
    this.network = network;
    for (const line of network.definition.lines) {
      this.unlock('first-route');
      if (line.mode === 'TRAM') this.unlock('first-tram');
      if (line.mode === 'SUBWAY') this.unlock('first-subway');
    }
    this.simulation.syncNetwork(network);
    this.checkDemandAchievements();
  }

  public getNetwork(): TransitNetwork { return this.network; }
  public getEconomy(): Economy { return this.economy; }
  public getSimulation(): SimulationEngine { return this.simulation; }
  public getConstruction(): ConstructionState { return this.construction; }
  public setConstruction(state: ConstructionState): void { this.construction = state; }

  public advanceBy(seconds: number): void {
    this.simulation.advanceBy(seconds);
    this.checkDemandAchievements();
  }

  public advanceRealTime(seconds: number): void {
    this.simulation.advanceRealTime(seconds);
    this.checkDemandAchievements();
  }

  public dashboard(): GameDashboard {
    const simulation = this.simulation.snapshot();
    return {
      simulation,
      score: calculateScore(simulation, this.network),
      achievements: achievements.filter((achievement) => this.unlocked.has(achievement.id)),
      lineCounts: {
        BUS: this.network.definition.lines.filter((line) => line.mode === 'BUS').length,
        TRAM: this.network.definition.lines.filter((line) => line.mode === 'TRAM').length,
        SUBWAY: this.network.definition.lines.filter((line) => line.mode === 'SUBWAY').length,
      },
    };
  }

  public save(): GameSave {
    return {
      saveVersion: 1,
      gameSchemaVersion: 1,
      levelId: this.world.definition.metadata.id,
      levelVersion: this.world.definition.metadata.version,
      seed: this.seed,
      savedAt: new Date().toISOString(),
      player: this.player,
      transitNetwork: this.network.definition,
      construction: this.construction,
      economy: this.economy.serialize(),
      simulation: this.simulation.serialize(),
      unlockedAchievementIds: [...this.unlocked],
    };
  }

  public exportDesign(): NetworkDesign {
    return {
      designVersion: 1,
      levelId: this.world.definition.metadata.id,
      levelVersion: this.world.definition.metadata.version,
      transitNetwork: this.network.definition,
      construction: this.construction,
    };
  }

  public importDesign(design: NetworkDesign): { readonly ok: boolean; readonly message: string } {
    if (design.designVersion !== 1 || design.levelId !== this.world.definition.metadata.id || design.levelVersion !== this.world.definition.metadata.version) {
      return { ok: false, message: 'This design is incompatible with the current level.' };
    }
    try {
      this.network = new TransitNetwork(design.transitNetwork);
      this.construction = design.construction;
      this.simulation.syncNetwork(this.network);
      return { ok: true, message: 'Network design imported.' };
    } catch {
      return { ok: false, message: 'The imported design is malformed.' };
    }
  }

  private checkDemandAchievements(): void {
    const snap = this.simulation.snapshot();
    if ((snap.operations?.statistics.boardings ?? 0) >= 1000) this.unlock('thousand-riders');
    if (snap.finances.today.netOperatingCents > 0 && snap.finances.today.fareRevenueCents > 0) this.unlock('profitable-day');
  }

  private unlock(id: string): void { this.unlocked.add(id); }

  private assertSaveCompatibility(save: GameSave): void {
    if (save.saveVersion !== 1 || save.gameSchemaVersion !== 1) throw new Error('Unsupported save schema version.');
    if (save.levelId !== this.world.definition.metadata.id || save.levelVersion !== this.world.definition.metadata.version) {
      throw new Error('Save is incompatible with this level version.');
    }
  }
}
