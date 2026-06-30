import { useState } from 'react';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import {
  loadSavedFilters,
  persistFilter,
  removeFilter,
  type SavedFilter,
} from '../utils/savedFilters';
import { useProjects } from '../hooks/useRedmine';

const ALERT_LABELS: Record<string, string> = {
  overdue: 'Vencidas',
  reviewToday: 'Rev. hoje',
  reviewOverdue: 'Rev. atrasada',
  missing: 'Campos faltando',
};

interface CurrentFilter {
  projectId?: number;
  sortBy: 'priority' | 'due_date' | 'updated';
  priorityFilter: string;
  alertFilter: string | null;
}

interface Props {
  currentFilter: CurrentFilter;
  onApply: (filter: SavedFilter) => void;
}

export function SavedFiltersBar({ currentFilter, onApply }: Props) {
  const [filters, setFilters] = useState<SavedFilter[]>(loadSavedFilters);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const { data: projects } = useProjects();

  const refresh = () => setFilters(loadSavedFilters());

  const handleSave = () => {
    if (!name.trim()) return;
    persistFilter({ id: Date.now().toString(), name: name.trim(), ...currentFilter });
    refresh();
    setName('');
    setSaving(false);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    removeFilter(id);
    refresh();
  };

  const projectLabel = (id?: number) =>
    id ? (projects?.find((p) => p.id === id)?.name ?? `Projeto ${id}`) : 'Todos';

  const filterSummary = (f: SavedFilter) => {
    const parts: string[] = [];
    if (f.projectId) parts.push(projectLabel(f.projectId));
    if (f.priorityFilter) parts.push(f.priorityFilter);
    if (f.alertFilter) parts.push(ALERT_LABELS[f.alertFilter] ?? f.alertFilter);
    const sortLabels: Record<string, string> = {
      priority: 'Prioridade',
      due_date: 'Prazo',
      updated: 'Atualizado',
    };
    if (f.sortBy !== 'priority') parts.push(sortLabels[f.sortBy]);
    return parts.join(' · ') || 'Geral';
  };

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <Bookmark size={13} className="text-slate-400 flex-shrink-0" />

      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onApply(f)}
          title={filterSummary(f)}
          className="group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium
            bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700
            border border-slate-200 hover:border-blue-300 transition-colors"
        >
          <span className="max-w-[10rem] truncate">{f.name}</span>
          <span className="text-[10px] text-slate-400 group-hover:text-blue-400 max-w-[6rem] truncate hidden sm:inline">
            {filterSummary(f)}
          </span>
          <span
            role="button"
            onClick={(e) => handleDelete(f.id, e)}
            className="ml-0.5 p-0.5 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
          >
            <X size={10} />
          </span>
        </button>
      ))}

      {saving ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') {
                setSaving(false);
                setName('');
              }
            }}
            placeholder="Nome do filtro…"
            className="text-xs border border-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
          />
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors"
          >
            Salvar
          </button>
          <button
            onClick={() => {
              setSaving(false);
              setName('');
            }}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors"
          title="Salvar os filtros ativos como favorito"
        >
          <BookmarkPlus size={13} />
          Salvar filtro atual
        </button>
      )}
    </div>
  );
}
