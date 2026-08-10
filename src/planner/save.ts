import type { PlannerSession } from './types';
const key = (cityId: string) => `opentransport.planner.${cityId}`;
export type LoadResult = { session?: PlannerSession; error?: string };
export const saveSession = (session: PlannerSession): void => localStorage.setItem(key(session.cityId), JSON.stringify(session));
export const loadSession = (cityId: string): LoadResult => { try { const value = localStorage.getItem(key(cityId)); if (!value) return {}; const parsed: unknown = JSON.parse(value); if (!isSession(parsed) || parsed.cityId !== cityId) return { error: 'This saved plan is incompatible. You can safely start a fresh plan.' }; return { session: parsed }; } catch { return { error: 'This local save could not be read. You can safely start a fresh plan.' }; } };
export const hasSession = (cityId: string): boolean => Boolean(localStorage.getItem(key(cityId)));
export const deleteSession = (cityId: string): void => localStorage.removeItem(key(cityId));
const isSession = (value: unknown): value is PlannerSession => typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1 && Array.isArray((value as { routes?: unknown }).routes) && Array.isArray((value as { stations?: unknown }).stations);
