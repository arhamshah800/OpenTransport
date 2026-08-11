import { useRef, type ReactNode } from 'react';

export type GameplayTool = 'select' | 'bus' | 'tram' | 'subway' | 'data';
const tools: readonly { readonly id: GameplayTool; readonly label: string }[] = [
  { id: 'select', label: 'Select' }, { id: 'bus', label: 'Bus' }, { id: 'tram', label: 'Tram' }, { id: 'subway', label: 'Subway' }, { id: 'data', label: 'Data' },
];

function ToolIcon({ tool }: { readonly tool: GameplayTool }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (tool === 'select') return <svg {...common}><path d="m5 3 13 8-6 1 3 7-3 1-3-7-4 4V3Z" /></svg>;
  if (tool === 'bus') return <svg {...common}><rect x="5" y="3" width="14" height="17" rx="2"/><path d="M5 14h14M8 20v1M16 20v1M8 7h8M8 17h.01M16 17h.01" /></svg>;
  if (tool === 'tram') return <svg {...common}><path d="M7 20h10M9 20l-2-4V7a5 5 0 0 1 10 0v9l-2 4M6 3h12M12 3v3M9 10h6M10 14h.01M14 14h.01" /></svg>;
  if (tool === 'subway') return <svg {...common}><rect x="5" y="3" width="14" height="17" rx="3"/><path d="M8 20l-2 2M16 20l2 2M8 8h8M8 14h.01M16 14h.01" /></svg>;
  return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M2 19h20" /></svg>;
}

export function GameplayShell({ hud, activeTool, onToolChange, map, context, contextOpen, onContextOpenChange, drawer }: { readonly hud: ReactNode; readonly activeTool: GameplayTool; readonly onToolChange: (tool: GameplayTool) => void; readonly map: ReactNode; readonly context: ReactNode; readonly contextOpen: boolean; readonly onContextOpenChange: (open: boolean) => void; readonly drawer: ReactNode }) {
  const invokingControl = useRef<HTMLButtonElement | null>(null);
  const closeContext = (): void => { onContextOpenChange(false); window.requestAnimationFrame(() => invokingControl.current?.focus()); };
  return <main className="game-shell">{hud}<div className="game-workspace"><nav className="build-toolbar" aria-label="Build tools">{tools.map((tool) => <button className={activeTool === tool.id ? 'active' : ''} type="button" aria-pressed={activeTool === tool.id} title={tool.label} onClick={(event) => { invokingControl.current = event.currentTarget; onToolChange(tool.id); onContextOpenChange(true); }} key={tool.id}><ToolIcon tool={tool.id} /><small>{tool.label}</small></button>)}</nav><aside className={`context-panel ${contextOpen ? 'open' : ''}`} aria-label="Context panel"><button className="context-close" type="button" onClick={closeContext} aria-label="Close context panel">×</button>{context}</aside><section className="map-workspace" aria-label="Interactive city map">{map}</section></div>{drawer}</main>;
}

export function BottomDrawer({ open, title, onToggle, children }: { readonly open: boolean; readonly title: string; readonly onToggle: () => void; readonly children: ReactNode }) { return <section className={`bottom-drawer ${open ? 'open' : ''}`}><button className="drawer-toggle" type="button" aria-expanded={open} onClick={onToggle}><span>{open ? '▾' : '▴'}</span>{title}</button>{open && <div className="drawer-content">{children}</div>}</section>; }
