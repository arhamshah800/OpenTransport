import { useEffect, useRef } from 'react';
import type { SimulationEngine } from './SimulationEngine';
import type { SimulationSnapshot, SimulationSpeed } from './types';

export const simulationTimeLabel = (snapshot: SimulationSnapshot): string => `Day ${snapshot.calendar.day} · ${snapshot.calendar.dayOfWeek} · ${String(snapshot.calendar.hour).padStart(2, '0')}:${String(snapshot.calendar.minute).padStart(2, '0')}`;

/** Optional facade (typically GameSession) so achievements and demand checks stay on the live clock path. */
export interface SimulationClockFacade {
  advanceRealTime(seconds: number): void;
  advanceBy(seconds: number): void;
  snapshot(): SimulationSnapshot;
  setSpeed(speed: SimulationSpeed): void;
}

/** Thin browser adapter: requestAnimationFrame supplies elapsed time while the engine owns game time. */
export function SimulationControls({
  engine,
  snapshot,
  onSnapshot,
  compact = false,
  clock,
}: {
  readonly engine: SimulationEngine;
  readonly snapshot: SimulationSnapshot;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly compact?: boolean;
  readonly clock?: SimulationClockFacade;
}) {
  const lastFrame = useRef<number | null>(null);
  const lastPublished = useRef<number>(0);
  const clockRef = useRef(clock ?? engineAsClock(engine));
  clockRef.current = clock ?? engineAsClock(engine);
  const pausedRef = useRef(snapshot.paused);
  pausedRef.current = snapshot.paused;

  useEffect(() => {
    let frame = 0;
    const run = (now: number): void => {
      if (lastFrame.current !== null) {
        const target = clockRef.current;
        target.advanceRealTime((now - lastFrame.current) / 1000);
        // Skip snapshot publication while paused — speed toggles publish explicitly.
        if (!pausedRef.current && now - lastPublished.current >= 250) {
          onSnapshot(target.snapshot());
          lastPublished.current = now;
        }
      }
      lastFrame.current = now;
      frame = requestAnimationFrame(run);
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [onSnapshot]);

  const setSpeed = (speed: SimulationSpeed): void => {
    clockRef.current.setSpeed(speed);
    onSnapshot(clockRef.current.snapshot());
  };
  const speedControls = (
    <div className="speed-controls">
      <button type="button" onClick={() => setSpeed(snapshot.paused ? 1 : 0)}>{snapshot.paused ? 'Resume' : 'Pause'}</button>
      {([1, 2, 4] as const).map((speed) => (
        <button className={snapshot.speed === speed && !snapshot.paused ? 'active-speed' : ''} type="button" onClick={() => setSpeed(speed)} key={speed}>{speed}×</button>
      ))}
    </div>
  );
  const period = snapshot.servicePeriod === 'daytime' ? 'Day service' : 'Night service';
  if (compact) {
    return <div className="hud-clock"><div className="hud-clock-text"><strong>{simulationTimeLabel(snapshot)}</strong><span>{period}</span></div>{speedControls}</div>;
  }
  return (
    <section className="simulation-controls">
      <p className="eyebrow">SIMULATION CLOCK</p>
      <h2>{simulationTimeLabel(snapshot)}</h2>
      <p className="debug-note">{period} frequencies are active</p>
      {speedControls}
    </section>
  );
}

const engineAsClock = (engine: SimulationEngine): SimulationClockFacade => ({
  advanceRealTime: (seconds) => engine.advanceRealTime(seconds),
  advanceBy: (seconds) => engine.advanceBy(seconds),
  snapshot: () => engine.snapshot(),
  setSpeed: (speed) => engine.setSpeed(speed),
});

export function DevelopmentTimeControls({
  onSnapshot,
  clock,
  engine,
}: {
  readonly engine: SimulationEngine;
  readonly onSnapshot: (snapshot: SimulationSnapshot) => void;
  readonly clock?: SimulationClockFacade;
}) {
  const target = clock ?? engineAsClock(engine);
  return (
    <div className="developer-time-controls">
      <button type="button" onClick={() => { target.advanceBy(3600); onSnapshot(target.snapshot()); }}>+1 hour</button>
      <button type="button" onClick={() => { target.advanceBy(86_400); onSnapshot(target.snapshot()); }}>+1 day</button>
    </div>
  );
}
