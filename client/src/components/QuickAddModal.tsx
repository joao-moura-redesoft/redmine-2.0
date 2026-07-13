import { useMemo, useState } from 'react';
import {
  Zap,
  X,
  NotebookPen,
  ClipboardList,
  CalendarClock,
  Flag,
  Hash,
  Loader2,
} from 'lucide-react';
import { useCreateNote } from '../hooks/useNotes';
import { usePriorities } from '../hooks/useRedmine';
import { quickParse } from '../utils/quickParse';

// Captura rápida em linguagem natural → vira nota ou tarefa. Parser heurístico
// (sem IA): reconhece prazo (hoje/amanhã/sex/dd/mm), prioridade e #refs.
export function QuickAddModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const createNote = useCreateNote();
  const { data: priorities } = usePriorities();
  const parsed = useMemo(() => quickParse(text), [text]);
  const empty = !text.trim();

  const createAsNote = async () => {
    if (empty || saving) return;
    setSaving(true);
    try {
      const tags = [parsed.priorityName, parsed.dueDate].filter(Boolean) as string[];
      await createNote.mutateAsync({
        title: parsed.title.slice(0, 120),
        body: text.trim(),
        tags,
        linkedIssueId: parsed.issueRefs[0] ?? null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const createAsTask = () => {
    const pri = parsed.priorityName
      ? priorities?.find((p) => p.name.toLowerCase() === parsed.priorityName!.toLowerCase())
      : undefined;
    window.dispatchEvent(
      new CustomEvent('bluemine:create-issue', {
        detail: {
          subject: parsed.title.slice(0, 120),
          description: text.trim(),
          priorityId: pri?.id,
          dueDate: parsed.dueDate,
        },
      }),
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Zap size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Captura rápida
          </span>
          <span className="text-[11px] text-slate-400 ml-1 hidden sm:inline">
            ex.: "sex revisar deploy #123 prioridade alta"
          </span>
          <button
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                createAsNote();
              }
            }}
            rows={2}
            placeholder="O que você quer capturar?"
            className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {/* Prévia do que foi entendido */}
          {!empty && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-400">Entendi:</span>
              <span className="font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded max-w-full truncate">
                {parsed.title || '—'}
              </span>
              {parsed.dueDate && (
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded">
                  <CalendarClock size={11} /> {parsed.dueDate}
                </span>
              )}
              {parsed.priorityName && (
                <span className="inline-flex items-center gap-1 text-orange-700 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300 px-1.5 py-0.5 rounded">
                  <Flag size={11} /> {parsed.priorityName}
                </span>
              )}
              {parsed.issueRefs.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded"
                >
                  <Hash size={11} />
                  {r}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={createAsNote}
              disabled={empty || saving}
              className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <NotebookPen size={15} />}
              Criar nota
            </button>
            <button
              onClick={createAsTask}
              disabled={empty}
              title="Abre 'Nova tarefa' já preenchida (você escolhe o projeto)"
              className="flex items-center justify-center gap-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <ClipboardList size={15} /> Virar tarefa
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Ctrl+Enter cria a nota.</p>
        </div>
      </div>
    </div>
  );
}
