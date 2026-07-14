import { useEffect } from 'react';
import { X } from 'lucide-react';

export interface ModalIssue {
  id: number;
  subject: string;
  meta?: string; // texto auxiliar (status, projeto, responsável…)
  tag?: string; // etiqueta à direita (ex.: "3d atrasada")
  tone?: 'red' | 'amber' | 'blue' | 'slate';
}

const TAG_TONE: Record<NonNullable<ModalIssue['tone']>, string> = {
  red: 'bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300',
  amber: 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-300',
  blue: 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300',
  slate: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400',
};

interface Props {
  title: string;
  items: ModalIssue[];
  onClose: () => void;
  onIssueClick: (id: number) => void;
}

// Lista de tarefas por trás de um KPI. Cada item abre a issue.
export function IssueListModal({ title, items, onClose, onIssueClick }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {title} <span className="text-slate-400 font-normal">· {items.length}</span>
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto scrollbar-thin p-2">
          {items.length === 0 && (
            <p className="text-sm text-slate-400 px-3 py-4 text-center">Nada por aqui.</p>
          )}
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => {
                onIssueClick(it.id);
                onClose();
              }}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-800 transition-colors group"
            >
              <span className="text-xs font-medium text-slate-400 flex-shrink-0">#{it.id}</span>
              <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400 truncate flex-1">
                {it.subject}
              </span>
              {it.meta && (
                <span className="text-[10px] text-slate-400 flex-shrink-0 max-w-28 truncate">
                  {it.meta}
                </span>
              )}
              {it.tag && (
                <span
                  className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                    TAG_TONE[it.tone ?? 'slate']
                  }`}
                >
                  {it.tag}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
