import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, X } from 'lucide-react';
import { redmineApi } from '../api/redmine';

interface Props {
  onSelectIssue: (id: number) => void;
}

export function GlobalSearch({ onSelectIssue }: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Atalho global "/" para focar (sem conflitar com inputs)
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: results, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: () => redmineApi.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 30 * 1000,
  });

  const select = (id: number) => {
    onSelectIssue(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={ref} className="relative flex-1 max-w-md">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar qualquer tarefa por #ID ou título..."
        className="w-full pl-9 pr-8 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-slate-50 focus:bg-white transition-colors"
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
          if (e.key === 'Enter' && /^\d+$/.test(query.trim())) select(parseInt(query.trim()));
        }}
      />
      {query && (
        <button onClick={() => { setQuery(''); setOpen(false); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      )}

      {open && debounced.length >= 2 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
          {isFetching ? (
            <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
              <Loader2 size={15} className="animate-spin" /> Buscando…
            </div>
          ) : !results || results.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">Nenhuma tarefa encontrada.</div>
          ) : (
            <div className="max-h-80 overflow-y-auto scrollbar-thin py-1">
              {results.map(issue => (
                <button
                  key={issue.id}
                  onClick={() => select(issue.id)}
                  className="w-full text-left px-4 py-2 hover:bg-blue-50 transition-colors border-b border-slate-50 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-400 flex-shrink-0">#{issue.id}</span>
                    <span className="text-sm text-slate-800 font-medium truncate flex-1">{issue.subject}</span>
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                      {issue.status.name}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{issue.project.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
