import { useState, useEffect } from 'react';
import { Play, Square, Clock, Plus, Check, Loader2, ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useTimer } from '../hooks/useTimer';
import { useStopAndLog } from '../hooks/useStopAndLog';
import { useIssueTimeEntries, useTimeEntryActivities, useCreateTimeEntry } from '../hooks/useRedmine';

interface Props {
  issueId: number;
  spentHours?: number;
}

function fmtH(h: number): string {
  if (h === 0) return '0h';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h % 1 === 0 ? h : h.toFixed(1)}h`;
}

export function TimeTracker({ issueId, spentHours }: Props) {
  const timer = useTimer();
  const isThisIssue = timer.isRunning && timer.activeIssueId === issueId;
  const otherRunning = timer.isRunning && !isThisIssue;

  const { data: entries, isLoading: entriesLoading } = useIssueTimeEntries(issueId);
  const { data: activities } = useTimeEntryActivities();
  const createEntry = useCreateTimeEntry();
  const { logHours } = useStopAndLog();

  const defaultActivity = activities?.find(a => a.is_default) ?? activities?.[0];

  const [formOpen, setFormOpen] = useState(false);
  const [hours, setHours] = useState('');
  const [activityId, setActivityId] = useState<number | ''>('');
  const [comment, setComment] = useState('');
  const [spentOn, setSpentOn] = useState(new Date().toISOString().split('T')[0]);
  const [showEntries, setShowEntries] = useState(false);
  // Confirmação transitória após apontamento automático ao parar o timer.
  const [justLogged, setJustLogged] = useState<number | null>(null);

  // Sync default activity when loaded
  useEffect(() => {
    if (defaultActivity && !activityId) setActivityId(defaultActivity.id);
  }, [defaultActivity, activityId]);

  const openFormWithHours = (h: number) => {
    setHours(h > 0 ? String(h) : '');
    setFormOpen(true);
  };

  // Para o timer e já aponta as horas no Redmine automaticamente, usando a
  // atividade padrão. Cai no formulário manual quando: o tempo é irrisório
  // (< 1 min), ainda não há atividade carregada, ou o POST falha — assim o
  // tempo medido nunca se perde.
  const handleStopAndLog = async () => {
    const h = timer.stop();
    const result = await logHours(issueId, h, { activityId: activityId || undefined });
    if (result.logged) {
      setJustLogged(result.hours);
      setTimeout(() => setJustLogged(null), 4000);
    } else {
      // Tempo irrisório, sem atividade ou POST falhou — cai no form manual
      // já preenchido, para o tempo medido nunca se perder.
      openFormWithHours(h);
    }
  };

  const handleSubmit = async () => {
    const h = parseFloat(hours);
    if (!h || !activityId) return;
    await createEntry.mutateAsync({
      issue_id: issueId,
      hours: h,
      activity_id: activityId as number,
      comments: comment.trim() || undefined,
      spent_on: spentOn,
    });
    setFormOpen(false);
    setHours('');
    setComment('');
    setSpentOn(new Date().toISOString().split('T')[0]);
  };

  return (
    <div className="px-5 py-3 border-b border-slate-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Clock size={13} />
          Horas
          {justLogged != null ? (
            <span className="flex items-center gap-1 text-green-600 font-medium">
              <Check size={12} /> {fmtH(justLogged)} apontada{justLogged === 1 ? '' : 's'} automaticamente
            </span>
          ) : (
            spentHours != null && spentHours > 0 && (
              <span className="text-slate-400 font-normal">· {fmtH(spentHours)} registradas</span>
            )
          )}
        </span>

        <div className="flex items-center gap-1.5">
          {/* Timer control */}
          {isThisIssue ? (
            <button
              onClick={handleStopAndLog}
              title="Parar e apontar as horas automaticamente"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors"
            >
              <Square size={11} className="fill-red-600" />
              {timer.formatted}
            </button>
          ) : (
            <button
              onClick={() => timer.start(issueId)}
              disabled={otherRunning}
              title={otherRunning ? `Timer ativo em outra tarefa (#${timer.activeIssueId})` : 'Iniciar timer'}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-green-50 hover:border-green-300 hover:text-green-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={11} className="fill-current" />
              {otherRunning ? `#${timer.activeIssueId}` : 'Timer'}
            </button>
          )}

          {/* Manual log button */}
          <button
            onClick={() => { setFormOpen(v => !v); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-slate-500 text-xs hover:bg-blue-50 hover:border-blue-300 hover:text-blue-600 transition-colors"
            title="Registrar horas manualmente"
          >
            <Plus size={11} />
            Registrar
          </button>
        </div>
      </div>

      {/* Log form */}
      {formOpen && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Horas *</label>
              <input
                autoFocus
                type="number"
                min="0.25"
                step="0.25"
                value={hours}
                onChange={e => setHours(e.target.value)}
                placeholder="ex: 1.5"
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Atividade *</label>
              <select
                value={activityId}
                onChange={e => setActivityId(Number(e.target.value))}
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {activities?.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Data</label>
              <input
                type="date"
                value={spentOn}
                onChange={e => setSpentOn(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Comentário</label>
              <input
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') setFormOpen(false); }}
                placeholder="Opcional"
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setFormOpen(false)} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1">
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={!hours || !activityId || createEntry.isPending}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
            >
              {createEntry.isPending
                ? <><Loader2 size={11} className="animate-spin" /> Salvando…</>
                : <><Check size={11} /> Salvar</>}
            </button>
          </div>
          {createEntry.isError && (
            <p className="text-xs text-red-500">Erro ao registrar horas. Tente novamente.</p>
          )}
        </div>
      )}

      {/* Recent entries for this issue */}
      {(entries?.length ?? 0) > 0 && (
        <div>
          <button
            onClick={() => setShowEntries(v => !v)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showEntries ? 'rotate-180' : ''}`} />
            {entries!.length} registro{entries!.length !== 1 ? 's' : ''} nesta tarefa
            · {fmtH(entries!.reduce((s, e) => s + e.hours, 0))} total
          </button>
          {showEntries && (
            <div className="mt-1.5 space-y-1">
              {entries!.slice(0, 8).map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700 w-8 flex-shrink-0">{fmtH(e.hours)}</span>
                  <span className="text-slate-400 flex-shrink-0">{e.activity.name}</span>
                  {e.comments && <span className="text-slate-500 truncate flex-1">{e.comments}</span>}
                  <span className="text-slate-300 flex-shrink-0 ml-auto">
                    {formatDistanceToNow(new Date(e.spent_on + 'T12:00:00'), { addSuffix: true, locale: ptBR })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {entriesLoading && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Loader2 size={11} className="animate-spin" /> Carregando registros…
        </div>
      )}
    </div>
  );
}
