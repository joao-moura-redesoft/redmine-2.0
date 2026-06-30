import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Sun,
  Plus,
  X,
  Check,
  ChevronUp,
  ChevronDown,
  Play,
  Square,
  Search,
  Timer,
  Pause,
  RotateCcw,
  CheckCircle2,
  Coffee,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useIssues, useIssuesByIds } from '../hooks/useRedmine';
import { useTimer } from '../hooks/useTimer';
import { useStopAndLog } from '../hooks/useStopAndLog';
import { myDay, useMyDay } from '../utils/myDay';
import type { Issue } from '../types/redmine';

// Tarefa concluída/cancelada: nunca deve aparecer como candidata do dia.
function isClosedish(i: Issue): boolean {
  if (i.status?.is_closed) return true;
  const n = i.status?.name?.toLowerCase() ?? '';
  return n.includes('fechad') || n.includes('cancelad') || n.includes('conclu');
}

/* ── Pomodoro de foco (auto-contido) ────────────────────────────────────── */
const FOCUS_MIN = 25;
const BREAK_MIN = 5;

function Pomodoro() {
  const [mode, setMode] = useState<'focus' | 'break'>('focus');
  const [secs, setSecs] = useState(FOCUS_MIN * 60);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (secs > 0) return;
    setRunning(false);
    try {
      new AudioContext();
    } catch {
      /* noop */
    }
    if (mode === 'focus') {
      setCycles((c) => c + 1);
      setMode('break');
      setSecs(BREAK_MIN * 60);
    } else {
      setMode('focus');
      setSecs(FOCUS_MIN * 60);
    }
  }, [secs, mode]);

  const total = (mode === 'focus' ? FOCUS_MIN : BREAK_MIN) * 60;
  const pct = ((total - secs) / total) * 100;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');

  const reset = () => {
    setRunning(false);
    setSecs((mode === 'focus' ? FOCUS_MIN : BREAK_MIN) * 60);
  };
  const switchMode = (m: 'focus' | 'break') => {
    setMode(m);
    setRunning(false);
    setSecs((m === 'focus' ? FOCUS_MIN : BREAK_MIN) * 60);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Timer size={15} className={mode === 'focus' ? 'text-blue-500' : 'text-emerald-500'} />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Foco (Pomodoro)
          </span>
        </div>
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs">
          <button
            onClick={() => switchMode('focus')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors ${mode === 'focus' ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}
          >
            Foco
          </button>
          <button
            onClick={() => switchMode('break')}
            className={`px-2 py-0.5 rounded-md font-medium transition-colors flex items-center gap-1 ${mode === 'break' ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}
          >
            <Coffee size={11} />
            Pausa
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-4xl font-mono font-bold tabular-nums text-slate-800 dark:text-slate-100">
          {mm}:{ss}
        </div>
        <div className="flex-1">
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${mode === 'focus' ? 'bg-blue-500' : 'bg-emerald-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            {cycles} ciclo{cycles !== 1 ? 's' : ''} de foco concluído{cycles !== 1 ? 's' : ''} hoje
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setRunning((r) => !r)}
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            title={running ? 'Pausar' : 'Iniciar'}
          >
            {running ? <Pause size={16} /> : <Play size={16} className="fill-current" />}
          </button>
          <button
            onClick={reset}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
            title="Reiniciar"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Linha de tarefa do plano ───────────────────────────────────────────── */
function PlanRow({
  issue,
  done,
  isFirst,
  isLast,
  onIssueClick,
}: {
  issue: Issue;
  done: boolean;
  isFirst: boolean;
  isLast: boolean;
  onIssueClick: (id: number) => void;
}) {
  const timer = useTimer();
  const { logHours, isLogging } = useStopAndLog();
  const [feedback, setFeedback] = useState<{ ok: boolean; hours: number } | null>(null);
  const isThis = timer.isRunning && timer.activeIssueId === issue.id;
  const otherRunning = timer.isRunning && !isThis;

  // Para o timer e aponta as horas medidas (atividade padrão). Mostra confirmação
  // transitória; se o POST falhar com tempo relevante, avisa para registrar manual
  // abrindo a tarefa — o tempo nunca é descartado em silêncio como antes.
  const handleStop = async () => {
    const h = timer.stop();
    const r = await logHours(issue.id, h);
    if (r.logged) {
      setFeedback({ ok: true, hours: r.hours });
      setTimeout(() => setFeedback(null), 4000);
    } else if (h >= 0.02) {
      setFeedback({ ok: false, hours: h });
    }
  };

  const fmtHours = (h: number) =>
    h < 1 ? `${Math.round(h * 60)}min` : `${h.toFixed(h % 1 === 0 ? 0 : 1)}h`;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 group ${done ? 'opacity-55' : ''}`}>
      <button
        onClick={() => myDay.toggleDone(issue.id)}
        className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${
          done
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-slate-300 dark:border-slate-600 hover:border-green-400'
        }`}
        title={done ? 'Marcar como pendente' : 'Concluir no plano'}
      >
        {done && <Check size={13} />}
      </button>

      <button onClick={() => onIssueClick(issue.id)} className="flex-1 min-w-0 text-left">
        <p
          className={`text-sm text-slate-700 dark:text-slate-200 truncate group-hover:text-blue-600 ${done ? 'line-through' : ''}`}
        >
          {issue.subject}
        </p>
        <p className="text-[11px] text-slate-400 truncate">
          #{issue.id} · {issue.project.name} · {issue.status.name}
        </p>
      </button>

      {feedback ? (
        <button
          onClick={() => {
            if (!feedback.ok) onIssueClick(issue.id);
            setFeedback(null);
          }}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium flex-shrink-0 ${
            feedback.ok
              ? 'text-green-600 dark:text-green-400'
              : 'bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400'
          }`}
          title={
            feedback.ok
              ? 'Horas apontadas automaticamente'
              : 'Falha ao apontar — clique para registrar manualmente'
          }
        >
          {feedback.ok ? (
            <>
              <Check size={11} /> {fmtHours(feedback.hours)}
            </>
          ) : (
            <>
              <AlertTriangle size={11} /> {fmtHours(feedback.hours)} não apontada
            </>
          )}
        </button>
      ) : isThis ? (
        <button
          onClick={handleStop}
          disabled={isLogging}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-xs font-medium flex-shrink-0 disabled:opacity-50"
          title="Parar e apontar as horas automaticamente"
        >
          {isLogging ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Square size={10} className="fill-current" />
          )}
          {timer.formatted}
        </button>
      ) : (
        <button
          onClick={() => timer.start(issue.id)}
          disabled={otherRunning}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 text-xs hover:text-green-600 hover:border-green-300 disabled:opacity-30 flex-shrink-0 transition-colors"
          title={otherRunning ? 'Timer ativo em outra tarefa' : 'Iniciar timer'}
        >
          <Play size={10} className="fill-current" />
        </button>
      )}

      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => myDay.move(issue.id, -1)}
          disabled={isFirst}
          className="text-slate-300 hover:text-slate-500 disabled:opacity-20"
        >
          <ChevronUp size={13} />
        </button>
        <button
          onClick={() => myDay.move(issue.id, 1)}
          disabled={isLast}
          className="text-slate-300 hover:text-slate-500 disabled:opacity-20"
        >
          <ChevronDown size={13} />
        </button>
      </div>

      <button
        onClick={() => myDay.remove(issue.id)}
        className="text-slate-300 hover:text-red-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remover do plano"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/* ── View principal ─────────────────────────────────────────────────────── */
export function MyDayView({ onIssueClick }: { onIssueClick: (id: number) => void }) {
  const { ids, done } = useMyDay();
  const { data: openIssues } = useIssues();
  const { data: plannedIssues } = useIssuesByIds(ids);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Resolve cada id planejado para sua issue (preferindo as abertas já em cache).
  const byId = useMemo(() => {
    const m = new Map<number, Issue>();
    [...(openIssues ?? []), ...(plannedIssues ?? [])].forEach((i) => m.set(i.id, i));
    return m;
  }, [openIssues, plannedIssues]);

  const planned = ids.map((id) => byId.get(id)).filter((i): i is Issue => !!i);
  const doneCount = ids.filter((id) => done.includes(id)).length;
  const progress = ids.length ? Math.round((doneCount / ids.length) * 100) : 0;

  const candidates = (openIssues ?? [])
    .filter((i) => !isClosedish(i))
    .filter((i) => !ids.includes(i.id))
    .filter((i) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return i.subject.toLowerCase().includes(q) || String(i.id).includes(q);
    })
    .slice(0, 50);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const today = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Sun size={18} className="text-amber-500" /> Meu Dia
          </h2>
          <p className="text-sm text-slate-500 mt-0.5 capitalize">{today}</p>
        </div>
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPicker((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={15} /> Adicionar tarefas
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-20 overflow-hidden">
              <div className="p-2 border-b border-slate-100 dark:border-slate-800">
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar nas minhas tarefas…"
                    className="w-full text-sm pl-8 pr-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin">
                {candidates.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">
                    Nenhuma tarefa disponível.
                  </p>
                ) : (
                  candidates.map((i) => (
                    <button
                      key={i.id}
                      onClick={() => {
                        myDay.add(i.id);
                        setSearch('');
                      }}
                      className="w-full flex items-start gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-800 text-left transition-colors"
                    >
                      <Plus size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm text-slate-700 dark:text-slate-200 truncate">
                          {i.subject}
                        </p>
                        <p className="text-[11px] text-slate-400 truncate">
                          #{i.id} · {i.status.name}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <Pomodoro />

      {/* Progresso */}
      {ids.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {doneCount} de {ids.length} concluída{ids.length !== 1 ? 's' : ''}
            </span>
            {doneCount > 0 && (
              <button
                onClick={() => myDay.clearDone()}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                Limpar concluídas
              </button>
            )}
          </div>
          <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Lista do plano */}
      {planned.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <CheckCircle2 size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Seu dia está vazio.</p>
          <p className="text-xs mt-1">Adicione tarefas para montar seu plano de foco de hoje.</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-50 dark:divide-slate-800 overflow-hidden">
          {planned.map((issue, idx) => (
            <PlanRow
              key={issue.id}
              issue={issue}
              done={done.includes(issue.id)}
              isFirst={idx === 0}
              isLast={idx === planned.length - 1}
              onIssueClick={onIssueClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
