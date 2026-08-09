import type { ConstructionProposal, ConstructionState } from '../construction';
import type { EconomyState } from '../economy';
import type { TransitNetworkDefinition } from '../transit';
import type { SimulationEngineState, SimulationSnapshot, SimulationSpeed } from '../time';

export interface PlayerProfile { readonly id: string; readonly displayName: string; readonly achievementIds: readonly string[]; readonly settings: { readonly autosave: boolean }; }
export interface ScoreComponents { readonly ridership: number; readonly coverage: number; readonly reliability: number; readonly financialHealth: number; readonly connectivity: number; }
export interface ScoreSnapshot { readonly total: number; readonly components: ScoreComponents; }
export interface Achievement { readonly id: string; readonly name: string; readonly description: string; }
export interface GameSave { readonly saveVersion: 1; readonly gameSchemaVersion: 1; readonly levelId: string; readonly levelVersion: number; readonly seed: number; readonly savedAt: string; readonly player: PlayerProfile; readonly transitNetwork: TransitNetworkDefinition; readonly construction: ConstructionState; readonly economy: EconomyState; readonly simulation: SimulationEngineState; readonly unlockedAchievementIds: readonly string[]; }
export interface NetworkDesign { readonly designVersion: 1; readonly levelId: string; readonly levelVersion: number; readonly transitNetwork: TransitNetworkDefinition; readonly construction: ConstructionState; }
export interface GameDashboard { readonly simulation: SimulationSnapshot; readonly score: ScoreSnapshot; readonly achievements: readonly Achievement[]; readonly lineCounts: Readonly<Record<'BUS' | 'TRAM' | 'SUBWAY', number>>; }
export type GameCommand = { readonly type: 'BUILD'; readonly proposal: ConstructionProposal } | { readonly type: 'TAKE_LOAN'; readonly productId: string } | { readonly type: 'SET_SPEED'; readonly speed: SimulationSpeed };
export interface SaveRepository { save(save: GameSave): Promise<void>; load(levelId: string): Promise<GameSave | null>; hasSave(levelId: string): Promise<boolean>; }
export interface PlayerRepository { load(): Promise<PlayerProfile | null>; save(profile: PlayerProfile): Promise<void>; }
export interface LeaderboardEntry { readonly profileId: string; readonly displayName: string; readonly levelId: string; readonly score: ScoreSnapshot; readonly submittedAt: string; }
export interface LeaderboardRepository { submitScore(entry: LeaderboardEntry): Promise<void>; getScores(levelId: string): Promise<readonly LeaderboardEntry[]>; }
