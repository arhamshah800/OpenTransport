import type { Coordinate } from '../world';
import type { ModeId } from '../modes';

/** Backwards-compatible transit name for a registry-owned, serializable mode ID. */
export type TransitMode = ModeId;
export type TransitNodeKind = 'stop' | 'station';
export interface TransitStop { readonly id: string; readonly name: string; readonly coordinate: Coordinate; readonly kind: TransitNodeKind; readonly supportedModes: readonly TransitMode[]; readonly parentComplexId?: string; readonly infrastructure?: { readonly platformCount?: number; readonly accessibility?: 'unknown' | 'accessible' }; }
export interface TransitTransferComplex { readonly id: string; readonly name: string; readonly stopIds: readonly string[]; }
export interface TransitSegment { readonly id: string; readonly startStopId: string; readonly endStopId: string; readonly geometry: readonly Coordinate[]; readonly engineering?: { readonly verticalProfileReference?: string; readonly reservedRightOfWay?: boolean; }; }
export interface TransitLine { readonly id: string; readonly name: string; readonly mode: TransitMode; readonly stopIds: readonly string[]; readonly segments: readonly TransitSegment[]; readonly direction: 'bidirectional' | 'one-way'; readonly active: boolean; readonly farePolicyId?: string; readonly serviceSettings?: { readonly plannedHeadwayMinutes?: number }; }
export interface TransitNetworkDefinition { readonly version: 1; readonly stops: readonly TransitStop[]; readonly transferComplexes: readonly TransitTransferComplex[]; readonly lines: readonly TransitLine[]; }
export interface TransitInfrastructureValidator { validateProposal(proposal: TransitInfrastructureProposal): ValidationResult; }
export type TransitInfrastructureProposal = { readonly kind: 'stop'; readonly coordinate: Coordinate; readonly modes: readonly TransitMode[] } | { readonly kind: 'line'; readonly mode: TransitMode; readonly stopIds: readonly string[] };
export interface ValidationResult { readonly valid: boolean; readonly reasons: readonly string[]; }
export interface TransitEdge { readonly fromStopId: string; readonly toStopId: string; readonly kind: 'service' | 'transfer'; readonly distanceMeters: number; readonly lineId?: string; }
