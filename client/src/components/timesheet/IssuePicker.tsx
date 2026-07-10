import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, X } from 'lucide-react';
import { redmineApi } from '../../api/redmine';

export interface PickedIssue {
  id: number;
  subject: string;
}

interface Props {
  value: PickedIssue | null;
  onChange: (issue: PickedIssue | null) => void;
  autoFocus?: boolean;
}

/** Busca de tarefa por #ID ou título, no mesmo espírito da busca global. */
export function IssuePicker({ value, onChange, autoFocus }: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => setCursor(0), [debounced]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const { data: results, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => redmineApi.search(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 30 * 1000,
  });

  const list = results ?? [];

  const pick = (issue: PickedIssue) => {
    onChange({ id: issue.id, subject: issue.subject });
    setQuery('');
    setOpen(false);
  };

  // Já escolhida: mostra o chip, com X para trocar.
  if (value) {
    return (
      <div className="flex items-center gap-2 w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-2 bg-slate-50 dark:bg-slate-800">
        <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex-shrink-0">
          #{value.id}
        </span>
        <span className="text-sm text-slate-700 dark:text-slate-200 truncate flex-1">
          {value.subject}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex-shrink-0"
          aria-label="Trocar tarefa"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  const dropdownOpen = open && debounced.length >= 2;

  return (
    <div ref={boxRef} className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar por #ID ou título…"
        aria-label="Tarefa"
        className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-2.5 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
        onKeyDown={(e) => {
          // O diálogo escuta Escape/Enter no window; enquanto a lista está aberta
          // essas teclas pertencem ao autocomplete, não ao formulário.
          if (e.key === 'Escape' && dropdownOpen) {
            e.stopPropagation();
            setOpen(false);
            return;
          }
          // O servidor já resolve um #ID digitado para a tarefa correspondente,
          // então não há atalho "aceitar o número cru": se não veio resultado, o
          // ID não existe e o POST falharia de qualquer jeito.
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            if (list[cursor]) pick(list[cursor]);
            return;
          }
          if (!dropdownOpen || !list.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => (c + 1) % list.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => (c - 1 + list.length) % list.length);
          }
        }}
      />

      {dropdownOpen && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-10 overflow-hidden">
          {isFetching ? (
            <div className="flex items-center justify-center gap-2 py-5 text-slate-400 text-xs">
              <Loader2 size={14} className="animate-spin" /> Buscando…
            </div>
          ) : list.length === 0 ? (
            <div className="py-5 text-center text-xs text-slate-400">
              Nenhuma tarefa encontrada.
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto scrollbar-thin py-1">
              {list.map((issue, i) => (
                <button
                  key={issue.id}
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(issue)}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    i === cursor ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">
                      #{issue.id}
                    </span>
                    <span className="text-xs text-slate-800 dark:text-slate-100 font-medium truncate flex-1">
                      {issue.subject}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate">{issue.project.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
