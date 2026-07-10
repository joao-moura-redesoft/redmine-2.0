import { useEffect, useState } from 'react';
import { Check, Loader2, Trash2, X, ExternalLink } from 'lucide-react';
import {
  useTimeEntryActivities,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
} from '../../hooks/useRedmine';
import { parseSpentOn } from '../../utils/time';
import { IssuePicker, type PickedIssue } from './IssuePicker';
import type { TimeEntry } from '../../types/redmine';

interface Props {
  /** Ausente => criar um apontamento novo em `defaultDate`. */
  entry?: TimeEntry;
  defaultDate?: string;
  onClose: () => void;
  onIssueClick: (id: number) => void;
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
};

export function TimeEntryDialog({ entry, defaultDate, onClose, onIssueClick }: Props) {
  const isNew = !entry;
  const { data: activities } = useTimeEntryActivities();
  const create = useCreateTimeEntry();
  const update = useUpdateTimeEntry();
  const remove = useDeleteTimeEntry();

  const [hours, setHours] = useState(entry ? String(entry.hours) : '');
  const [activityId, setActivityId] = useState<number | ''>(entry?.activity.id ?? '');
  const [comments, setComments] = useState(entry?.comments ?? '');
  const [spentOn, setSpentOn] = useState(entry?.spent_on ?? defaultDate ?? '');
  const [issue, setIssue] = useState<PickedIssue | null>(null);
  // Excluir é destrutivo e irreversível no Redmine: exige um segundo clique.
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Só na criação: pré-seleciona a atividade padrão assim que a lista carrega.
  useEffect(() => {
    if (isNew && !activityId && activities?.length) {
      setActivityId((activities.find((a) => a.is_default) ?? activities[0]).id);
    }
  }, [isNew, activityId, activities]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = create.isPending || update.isPending || remove.isPending;
  const parsedHours = parseFloat(hours);
  const valid = parsedHours > 0 && !!activityId && !!spentOn && (!isNew || !!issue);

  const handleSave = async () => {
    if (!valid || busy) return;
    if (isNew) {
      await create.mutateAsync({
        issue_id: issue!.id,
        hours: parsedHours,
        activity_id: activityId as number,
        comments: comments.trim() || undefined,
        spent_on: spentOn,
      });
    } else {
      await update.mutateAsync({
        id: entry!.id,
        issueId: entry!.issue?.id,
        hours: parsedHours,
        activity_id: activityId as number,
        comments: comments.trim(),
        spent_on: spentOn,
      });
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!confirmDelete) return setConfirmDelete(true);
    await remove.mutateAsync({ id: entry!.id, issueId: entry!.issue?.id });
    onClose();
  };

  const label = 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1';
  const field =
    'w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400';

  const subtitle = isNew
    ? spentOn
      ? parseSpentOn(spentOn).toLocaleDateString('pt-BR', LONG_DATE)
      : ''
    : entry!.project.name;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={isNew ? 'Novo apontamento' : 'Editar apontamento'}
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {isNew ? 'Novo apontamento' : 'Editar apontamento'}
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5 truncate capitalize">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {isNew ? (
            <div>
              <span className={label}>Tarefa *</span>
              <IssuePicker value={issue} onChange={setIssue} autoFocus />
            </div>
          ) : (
            entry!.issue && (
              <button
                onClick={() => {
                  onClose();
                  onIssueClick(entry!.issue!.id);
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Abrir #{entry!.issue.id} <ExternalLink size={12} />
              </button>
            )
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className={label} htmlFor="te-hours">
                Horas *
              </label>
              <input
                id="te-hours"
                autoFocus={!isNew}
                type="number"
                min="0.25"
                step="0.25"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="ex: 1.5"
                className={field}
              />
            </div>
            <div>
              <label className={label} htmlFor="te-activity">
                Atividade *
              </label>
              <select
                id="te-activity"
                value={activityId}
                onChange={(e) => setActivityId(Number(e.target.value))}
                className={field}
              >
                {activities?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="te-date">
              Data
            </label>
            <input
              id="te-date"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <label className={label} htmlFor="te-comments">
              Comentário
            </label>
            <input
              id="te-comments"
              type="text"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="Opcional"
              className={field}
            />
          </div>

          {(create.isError || update.isError || remove.isError) && (
            <p className="text-xs text-red-500">
              Não consegui salvar. Confira se a tarefa existe e se você tem permissão — o Redmine
              bloqueia apontamentos de outras pessoas e de períodos já fechados.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
          {entry ? (
            <button
              onClick={handleDelete}
              disabled={busy}
              onBlur={() => setConfirmDelete(false)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 ${
                confirmDelete
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20'
              }`}
            >
              {remove.isPending ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Trash2 size={12} />
              )}
              {confirmDelete ? 'Confirmar exclusão' : 'Excluir'}
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 px-2 py-1"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!valid || busy}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
            >
              {create.isPending || update.isPending ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Salvando…
                </>
              ) : (
                <>
                  <Check size={12} /> Salvar
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
