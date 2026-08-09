import type { ReactNode } from 'react';

export type GameplayTool = 'select' | 'bus' | 'tram' | 'subway' | 'data';
const tools: readonly { readonly id: GameplayTool; readonly icon: string; readonly label: string }[] = [
  { id: 'select', icon: '↖', label: 'Select' }, { id: 'bus', icon: 'B', label: 'Bus' }, { id: 'tram', icon: 'T', label: 'Tram' }, { id: 'subway', icon: 'S', label: 'Subway' }, { id: 'data', icon: '◫', label: 'Data' },
];

export function GameplayShell({ hud, activeTool, onToolChange, map, context, contextOpen, onContextOpenChange, drawer }: { readonly hud: ReactNode; readonly activeTool: GameplayTool; readonly onToolChange: (tool: GameplayTool) => void; readonly map: ReactNode; readonly context: ReactNode; readonly contextOpen: boolean; readonly onContextOpenChange: (open: boolean) => void; readonly drawer: ReactNode }) {
  return <main className="game-shell">{hud}<div className="game-workspace"><nav className="build-toolbar" aria-label="Build tools">{tools.map((tool) => <button className={activeTool === tool.id ? 'active' : ''} type="button" aria-pressed={activeTool === tool.id} title={tool.label} onClick={() => { onToolChange(tool.id); onContextOpenChange(true); }} key={tool.id}><span>{tool.icon}</span><small>{tool.label}</small></button>)}</nav><section className="map-workspace" aria-label="Interactive city map">{map}</section><aside className={`context-panel ${contextOpen ? 'open' : ''}`} aria-label="Context panel"><button className="context-close" type="button" onClick={() => onContextOpenChange(false)} aria-label="Close context panel">×</button>{context}</aside></div>{drawer}</main>;
}

export function BottomDrawer({ open, title, onToggle, children }: { readonly open: boolean; readonly title: string; readonly onToggle: () => void; readonly children: ReactNode }) { return <section className={`bottom-drawer ${open ? 'open' : ''}`}><button className="drawer-toggle" type="button" aria-expanded={open} onClick={onToggle}><span>{open ? '▾' : '▴'}</span>{title}</button>{open && <div className="drawer-content">{children}</div>}</section>; }
