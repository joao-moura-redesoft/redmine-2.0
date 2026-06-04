import { useState, useEffect, useCallback } from 'react';

const TIMER_KEY = 'rk_active_timer';

interface TimerState {
  issueId: number;
  startedAt: string; // ISO
}

function load(): TimerState | null {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); }
  catch { return null; }
}

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Global timer — persists across page refreshes via localStorage.
 * Only one timer can be active at a time.
 */
function elapsedFromState(s: TimerState | null): number {
  if (!s) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
}

export function useTimer() {
  const [state, setState] = useState<TimerState | null>(load);
  const [elapsed, setElapsed] = useState(() => elapsedFromState(load()));

  useEffect(() => {
    if (!state) { setElapsed(0); return; }
    const tick = () =>
      setElapsed(Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback((issueId: number) => {
    const s: TimerState = { issueId, startedAt: new Date().toISOString() };
    localStorage.setItem(TIMER_KEY, JSON.stringify(s));
    setState(s);
  }, []);

  /** Stops the timer and returns elapsed hours (rounded to 2 decimals). */
  const stop = useCallback((): number => {
    const hours = Math.round((elapsed / 3600) * 100) / 100;
    localStorage.removeItem(TIMER_KEY);
    setState(null);
    setElapsed(0);
    return hours;
  }, [elapsed]);

  return {
    isRunning: !!state,
    activeIssueId: state?.issueId ?? null,
    elapsed,
    formatted: fmt(elapsed),
    start,
    stop,
  };
}
