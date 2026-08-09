import { modeRegistry, type ModeId } from '../modes';
import type { TransitLine } from './types';
import type { TransitNetwork } from './TransitNetwork';

const PALETTE = ['#3d78ad', '#c45c26', '#2d6a4f', '#7b4b94', '#b08900', '#9b2226', '#0077b6', '#6a994e', '#bc4749', '#5c4d7a', '#e09f3e', '#386641'] as const;

/** Choose a distinct color for a new line, preferring unused palette entries. */
export function nextLineColor(network: TransitNetwork, mode: ModeId): string {
  const used = new Set(network.definition.lines.map((line) => line.color).filter(Boolean));
  const available = PALETTE.find((color) => !used.has(color));
  if (available) return available;
  return modeRegistry.getModeDefinition(mode).color;
}

export function lineDisplayColor(line: TransitLine): string {
  return line.color ?? modeRegistry.getModeDefinition(line.mode).color;
}
