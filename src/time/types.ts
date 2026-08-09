import type { FinancialSummary } from '../economy';
import type { OperationsSnapshot } from '../operations';
import type { PopulationSummary } from '../population';

export type SimulationSpeed = 0 | 1 | 2 | 4;
export interface SimulationCalendar { readonly day: number; readonly dayOfWeek: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'; readonly hour: number; readonly minute: number; readonly second: number; }
export interface SimulationTickContext { readonly previousSeconds: number; readonly currentSeconds: number; readonly deltaSeconds: number; readonly crossedDayBoundary: boolean; readonly crossedHourBoundary: boolean; readonly calendar: SimulationCalendar; }
export interface ScheduledEvent { readonly id: string; readonly timestampSeconds: number; readonly type: string; readonly payload?: Readonly<Record<string, string | number>>; }
export interface SimulationEngineState { readonly version: 1; readonly timestampSeconds: number; readonly speed: SimulationSpeed; readonly scheduledEvents: readonly ScheduledEvent[]; }
export interface SimulationSnapshot { readonly timestampSeconds: number; readonly speed: SimulationSpeed; readonly paused: boolean; readonly calendar: SimulationCalendar; readonly servicePeriod: 'daytime' | 'nighttime'; readonly population: PopulationSummary; readonly operations?: OperationsSnapshot; readonly finances: FinancialSummary; }
