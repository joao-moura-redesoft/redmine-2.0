import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Loader2, CornerDownLeft, Hash } from 'lucide-react';
import { redmineApi } from '../api/redmine';

interface TabItem { id: string; label: string; icon: ReactNode; }
interface ActionItem { id: string; label: string; icon: ReactNode; run: () => void; }

interface Props {
  open: boolean;
  onClose: () => void;
  tabs: TabItem[];
  actions?: ActionItem[];
  onSelectTab: (id: string) => void;
  onSelectIssue: (id: number) => void;
}

type Item =
  | { type: 'action'; id: string; label: string; icon: ReactNode; run: () => void }
  | { type: 'tab'; id: string; label: string; icon: ReactNode }
  | { type: 'issue'; id: number; label: string; status: string };

export function CommandPalette({ open, onClose, tabs, actions = [], onSelectTab, onSelectIssue }: Props) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Mantém o item selecionado visível ao navegar com as setas
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  useEffect(() => {
    if (open) { setQ(''); setDebounced(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: issues, isFetching } = useQuery({
    queryKey: ['cmd-search', debounced],
    queryFn: () => redmineApi.search(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 30 * 1000,
  });

  const ql = q.toLowerCase();
  const actionMatches = useMemo(
    () => actions.filter(a => a.label.toLowerCase().includes(ql)),
    [actions, ql]
  );
  const tabMatches = useMemo(
    () => tabs.filter(t => t.label.toLowerCase().includes(ql)),
    [tabs, ql]
  );

  const items = useMemo<Item[]>(() => [
    ...actionMatches.map(a => ({ type: 'action' as const, id: a.id, label: a.label, icon: a.icon, run: a.run })),
    ...tabMatches.map(t => ({ type: 'tab' as const, id: t.id, label: t.label, icon: t.icon })),
    ...(issues ?? []).map(i => ({ type: 'issue' as const, id: i.id, label: i.subject, status: i.status.name })),
  ], [actionMatches, tabMatches, issues]);

  useEffect(() => { setSel(0); }, [items.length]);

  const activate = (item: Item) => {
    if (item.type === 'action') item.run();
    else if (item.type === 'tab') onSelectTab(item.id);
    else onSelectIssue(item.id);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') { onClose(); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (/^\d+$/.test(q.trim())) { onSelectIssue(parseInt(q.trim())); onClose(); return; }
            if (items[sel]) activate(items[sel]);
          }
        }}
      >
        <div className="flex items-center gap-2 px-4 border-b border-slate-100">
          <Search size={16} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar tarefa por #ID/título ou ir para uma aba…"
            className="flex-1 py-3 text-sm focus:outline-none bg-transparent"
          />
          {isFetching && <Loader2 size={14} className="animate-spin text-slate-400" />}
          <kbd className="text-[10px] text-slate-400 border border-slate-200 rounded px-1.5 py-0.5">esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto scrollbar-thin py-1">
          {items.map((item, i) => {
            const active = i === sel;
            const isIssue = item.type === 'issue';
            const showHeader = i === 0 || items[i - 1].type !== item.type;
            const headerLabel = item.type === 'action' ? 'Ações' : item.type === 'tab' ? 'Ir para' : 'Tarefas';
            return (
              <div key={`${item.type}-${item.id}`}>
                {showHeader && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-4 pt-2 pb-1">{headerLabel}</p>
                )}
                <button
                  ref={active ? activeRef : undefined}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => activate(item)}
                  className={`w-full text-left flex items-center gap-2.5 px-4 py-2 ${active ? 'bg-blue-50' : ''}`}
                >
                  <span className={`flex-shrink-0 ${active ? 'text-blue-600' : 'text-slate-400'}`}>
                    {isIssue ? <Hash size={14} /> : item.icon}
                  </span>
                  {isIssue && <span className="text-xs font-medium text-slate-400 flex-shrink-0">#{item.id}</span>}
                  <span className={`text-sm truncate flex-1 ${active ? 'text-blue-700' : 'text-slate-700'}`}>{item.label}</span>
                  {isIssue && (
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{item.status}</span>
                  )}
                  {active && <CornerDownLeft size={13} className="text-slate-300 flex-shrink-0" />}
                </button>
              </div>
            );
          })}

          {debounced.length >= 2 && !isFetching && (issues?.length ?? 0) === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">Nenhuma tarefa encontrada.</p>
          )}
          {items.length === 0 && debounced.length < 2 && (
            <p className="px-4 py-3 text-sm text-slate-400">Digite para buscar tarefas…</p>
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><kbd className="border border-slate-200 rounded px-1">↑</kbd><kbd className="border border-slate-200 rounded px-1">↓</kbd> navegar</span>
          <span className="flex items-center gap-1"><kbd className="border border-slate-200 rounded px-1">↵</kbd> abrir</span>
        </div>
      </div>
    </div>
  );
}
