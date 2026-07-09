import { useEffect, useRef, useState } from 'react';
import { Timer, Square, Loader2 } from 'lucide-react';
import { useFocus, focusStore } from '../utils/focus';
import { useStopAndLog } from '../hooks/useStopAndLog';
import { useBrowserNotifications } from '../hooks/useBrowserNotifications';

const pad = (n: number) => String(n).padStart(2, '0');

// Pílula flutuante da sessão de foco: countdown + parar. Ao zerar (ou parar),
// aponta o tempo no Redmine automaticamente e notifica.
export function FocusWidget() {
  const focus = useFocus();
  const { logHours } = useStopAndLog();
  const { notify } = useBrowserNotifications();
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);
  const finishing = useRef(false);

  useEffect(() => {
    if (!focus) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [focus]);

  const endsAt = focus ? focus.startedAt + focus.minutes * 60_000 : 0;
  const remaining = Math.max(0, endsAt - now);

  const finish = async () => {
    if (finishing.current || !focus) return;
    finishing.current = true;
    setSaving(true);
    const issueId = focus.issueId;
    const minutes = focus.minutes;
    // Limita ao tempo da sessão: se passar do fim (app aberto demais / reaberto
    // tarde), aponta os `minutes` planejados — não o elapsed real de horas.
    const elapsedMin = (Date.now() - focus.startedAt) / 60_000;
    const hours = Math.round((Math.min(elapsedMin, minutes) / 60) * 100) / 100;
    focusStore.clear();
    try {
      const res = await logHours(issueId, hours, { comments: `Sessão de foco (${minutes}min)` });
      notify(res.logged ? '✅ Foco concluído' : '⏱️ Foco encerrado', {
        body: res.logged
          ? `${res.hours.toFixed(2)}h apontadas em #${issueId}`
          : `Tempo curto — não apontado (#${issueId})`,
        tag: `focus-${issueId}`,
      });
    } finally {
      setSaving(false);
      finishing.current = false;
    }
  };

  useEffect(() => {
    if (focus && remaining <= 0) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, remaining]);

  if (!focus) return null;

  const secs = Math.ceil(remaining / 1000);
  const done = remaining <= 0;

  return (
    <div className="fixed bottom-6 right-6 z-[55] flex items-center gap-3 bg-slate-900 text-white rounded-xl shadow-2xl pl-3 pr-2 py-2 border border-white/10">
      <span
        className={`flex-shrink-0 ${done ? 'text-emerald-400' : 'text-indigo-300'}`}
        title="Sessão de foco"
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Timer size={16} />}
      </span>
      <div className="leading-tight min-w-0">
        <div className="text-lg font-bold tabular-nums">
          {Math.floor(secs / 60)}:{pad(secs % 60)}
        </div>
        <div className="text-[11px] text-white/60 truncate max-w-40">
          #{focus.issueId} {focus.subject}
        </div>
      </div>
      <button
        onClick={finish}
        disabled={saving}
        title="Parar e apontar o tempo"
        className="flex-shrink-0 p-2 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-50 transition-colors"
      >
        <Square size={14} />
      </button>
    </div>
  );
}
