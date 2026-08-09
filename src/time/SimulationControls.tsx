import { useEffect, useRef } from 'react';
import type { SimulationEngine } from './SimulationEngine';
import type { SimulationSnapshot, SimulationSpeed } from './types';

export const simulationTimeLabel = (snapshot: SimulationSnapshot): string => `Day ${snapshot.calendar.day} · ${snapshot.calendar.dayOfWeek} · ${String(snapshot.calendar.hour).padStart(2, '0')}:${String(snapshot.calendar.minute).padStart(2, '0')}`;
/** Thin browser adapter: requestAnimationFrame supplies elapsed time, while SimulationEngine owns all game time. */
export function SimulationControls({ engine, snapshot, onSnapshot, compact = false }: { readonly engine: SimulationEngine; readonly snapshot: SimulationSnapshot; readonly onSnapshot: (snapshot: SimulationSnapshot) => void; readonly compact?: boolean }) {
  const lastFrame = useRef<number | null>(null); const lastPublished = useRef<number>(0);
  useEffect(() => { let frame = 0; const run = (now: number): void => { if (lastFrame.current !== null) { engine.advanceRealTime((now - lastFrame.current) / 1000); if (now - lastPublished.current >= 250) { onSnapshot(engine.snapshot()); lastPublished.current = now; } } lastFrame.current = now; frame = requestAnimationFrame(run); }; frame = requestAnimationFrame(run); return () => cancelAnimationFrame(frame); }, [engine, onSnapshot]);
  const setSpeed = (speed: SimulationSpeed): void => { engine.setSpeed(speed); onSnapshot(engine.snapshot()); };
  const speedControls = <div className="speed-controls"><button type="button" onClick={() => setSpeed(snapshot.paused ? 1 : 0)}>{snapshot.paused ? 'Resume' : 'Pause'}</button>{([1, 2, 4] as const).map((speed) => <button className={snapshot.speed === speed && !snapshot.paused ? 'active-speed' : ''} type="button" onClick={() => setSpeed(speed)} key={speed}>{speed}×</button>)}</div>;
  const period = snapshot.servicePeriod === 'daytime' ? 'Day service' : 'Night service';
  if (compact) return <div className="hud-clock"><div className="hud-clock-text"><strong>{simulationTimeLabel(snapshot)}</strong><span>{period}</span></div>{speedControls}</div>;
  return <section className="simulation-controls"><p className="eyebrow">SIMULATION CLOCK</p><h2>{simulationTimeLabel(snapshot)}</h2><p className="debug-note">{period} frequencies are active</p>{speedControls}</section>;
}
export function DevelopmentTimeControls({ engine, onSnapshot }: { readonly engine: SimulationEngine; readonly onSnapshot: (snapshot: SimulationSnapshot) => void }) { return <div className="developer-time-controls"><button type="button" onClick={() => { engine.advanceBy(3600); onSnapshot(engine.snapshot()); }}>+1 hour</button><button type="button" onClick={() => { engine.advanceBy(86_400); onSnapshot(engine.snapshot()); }}>+1 day</button></div>; }
