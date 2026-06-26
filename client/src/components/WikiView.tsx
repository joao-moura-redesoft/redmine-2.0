import { useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Search, ExternalLink, X, ChevronRight, Loader2, AlertCircle, FileText, KeyRound } from 'lucide-react';
import { wikiApi, isWikiAvailable } from '../api/wiki';
import type { WikiSearchResult } from '../api/wiki';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// --- WikiPageReader ---

function WikiPageReader({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['wiki', 'page', id],
    queryFn: () => wikiApi.getPage(id),
    staleTime: 0,
  });

  return (
    <div className="flex flex-col h-full border-l border-slate-200 dark:border-slate-700 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0 bg-white dark:bg-slate-900">
        <FileText size={14} className="text-slate-400 flex-shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 flex-1 truncate">
          {id.replace(/_/g, ' ').split(':').join(' / ')}
        </span>
        <a
          href={wikiApi.pageUrl(id)}
          target="_blank"
          rel="noreferrer"
          title="Abrir no DokuWiki"
          className="p-1 text-slate-400 hover:text-blue-500 transition-colors"
        >
          <ExternalLink size={13} />
        </a>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Carregando...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 m-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle size={14} />
            Não foi possível carregar a página. Tente abrir no&nbsp;
            <a href={wikiApi.pageUrl(id)} target="_blank" rel="noreferrer" className="underline">DokuWiki</a>.
          </div>
        )}
        {data && (
          <div
            className="wiki-content max-w-none p-5"
            // HTML vem do DokuWiki (conteúdo de terceiros) — sanitiza no cliente
            // contra XSS armazenado (onerror=, javascript:, etc.). O servidor só
            // tira <script>/<style> via regex, o que é insuficiente sozinho.
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(data.html, { ADD_ATTR: ['target'] }) }}
            onClick={e => {
              const a = (e.target as HTMLElement).closest('a');
              if (a) { e.preventDefault(); const href = a.getAttribute('href'); if (href) window.open(href, '_blank', 'noreferrer'); }
            }}
          />
        )}
      </div>
    </div>
  );
}

// --- PageRow ---

function PageRow({ page, selected, onClick }: {
  page: WikiSearchResult;
  selected: boolean;
  onClick: () => void;
}) {
  const snippet = 'snippet' in page ? page.snippet : undefined;
  const time = page.mtime ? formatDistanceToNow(new Date(page.mtime * 1000), { addSuffix: true, locale: ptBR }) : '';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors group ${selected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
    >
      <div className="flex items-start gap-2">
        <FileText size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>
            {page.title || page.id}
          </p>
          {page.namespace && (
            <p className="text-[11px] text-slate-400 truncate">{page.namespace.replace(/:/g, ' / ')}</p>
          )}
          {snippet && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{snippet}</p>
          )}
          {time && <p className="text-[10px] text-slate-400 mt-0.5">{time}</p>}
        </div>
        <ChevronRight size={13} className="flex-shrink-0 mt-0.5 text-slate-300 group-hover:text-slate-500 dark:group-hover:text-slate-400 transition-colors" />
      </div>
    </button>
  );
}

// --- WikiCredentialsNeeded ---

function WikiCredentialsNeeded() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3 text-slate-500">
      <KeyRound size={32} className="opacity-30" />
      <p className="text-sm font-medium">A Wiki requer login com usuário e senha.</p>
      <p className="text-xs max-w-xs">
        Saia e entre novamente usando seu usuário e senha do AD (em vez de uma API key).
      </p>
    </div>
  );
}

// --- WikiView principal ---

export function WikiView() {
  if (!isWikiAvailable()) return <WikiCredentialsNeeded />;
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSearch = activeSearch.length >= 2;

  const searchQuery = useQuery({
    queryKey: ['wiki', 'search', activeSearch],
    queryFn: () => wikiApi.search(activeSearch),
    staleTime: 60_000,
    enabled: hasSearch,
  });

  const items: WikiSearchResult[] = searchQuery.data ?? [];
  const loading = searchQuery.isLoading;
  const err = searchQuery.error;

  function handleSearch() {
    setActiveSearch(searchTerm.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSearch();
    if (e.key === 'Escape') { setSearchTerm(''); setActiveSearch(''); }
  }

  function clearSearch() {
    setSearchTerm('');
    setActiveSearch('');
    inputRef.current?.focus();
  }

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <BookOpen size={18} />
          Wiki
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">wiki.redesoft.com.br</p>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left panel: search + list */}
        <div className={`flex flex-col min-h-0 ${selectedId ? 'w-80 flex-shrink-0' : 'flex-1'}`}>
          {/* Search bar */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              placeholder="Buscar páginas da wiki… (Enter)"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-8 pr-8 py-2 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {(searchTerm || activeSearch) && (
              <button onClick={clearSearch} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Status bar */}
          {hasSearch && (
            <div className="flex items-center justify-between mb-2 px-0.5">
              <span className="text-xs text-slate-400">
                {loading ? 'Buscando…' : `${items.length} resultado${items.length !== 1 ? 's' : ''} para "${activeSearch}"`}
              </span>
              <button onClick={clearSearch} className="text-xs text-blue-500 hover:text-blue-600">
                Limpar
              </button>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {loading && (
              <div className="flex items-center justify-center h-24 gap-2 text-slate-400">
                <Loader2 size={15} className="animate-spin" />
                <span className="text-sm">Buscando…</span>
              </div>
            )}
            {err && (
              <div className="flex items-center gap-2 m-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
                <AlertCircle size={14} />
                Erro ao buscar no DokuWiki. Verifique as credenciais.
              </div>
            )}
            {!hasSearch && !loading && (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                <BookOpen size={28} className="opacity-30" />
                <p className="text-sm">Digite um termo e pressione Enter para buscar.</p>
              </div>
            )}
            {hasSearch && !loading && !err && items.length === 0 && (
              <div className="flex flex-col items-center justify-center h-24 text-slate-400 gap-1">
                <p className="text-sm">Nenhum resultado.</p>
              </div>
            )}
            {items.map(page => (
              <PageRow
                key={page.id}
                page={page}
                selected={selectedId === page.id}
                onClick={() => setSelectedId(page.id === selectedId ? null : page.id)}
              />
            ))}
          </div>
        </div>

        {/* Right panel: page reader */}
        {selectedId && (
          <div className="flex-1 flex flex-col min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            <WikiPageReader id={selectedId} onClose={() => setSelectedId(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

// --- WikiLinkSearch: dialog para vincular página a uma tarefa ---

export function WikiLinkSearch({
  onSelect,
  onClose,
}: {
  onSelect: (id: string, title: string, namespace: string) => void;
  onClose: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const wikiAvailable = isWikiAvailable();

  const hasSearch = activeSearch.length >= 2;

  const searchQuery = useQuery({
    queryKey: ['wiki', 'search', activeSearch],
    queryFn: () => wikiApi.search(activeSearch),
    staleTime: 60_000,
    enabled: hasSearch,
  });

  const items: WikiSearchResult[] = searchQuery.data ?? [];
  const loading = searchQuery.isLoading;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') setActiveSearch(searchTerm.trim());
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
          <BookOpen size={15} className="text-slate-400" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex-1">Vincular página da Wiki</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {!wikiAvailable ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-slate-500">
            <KeyRound size={24} className="opacity-40" />
            <p className="text-sm">Requer login com usuário e senha do AD.</p>
          </div>
        ) : null}

        {/* Search */}
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              autoFocus
              type="text"
              placeholder="Buscar páginas… (Enter)"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-16 gap-2 text-slate-400">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-sm">Carregando...</span>
            </div>
          )}
          {!hasSearch && !loading && (
            <div className="flex items-center justify-center h-16 text-slate-400 text-sm">
              Digite um termo e pressione Enter para buscar.
            </div>
          )}
          {hasSearch && !loading && items.length === 0 && (
            <div className="flex items-center justify-center h-16 text-slate-400 text-sm">
              Nenhum resultado.
            </div>
          )}
          {items.map(page => (
            <button
              key={page.id}
              onClick={() => onSelect(page.id, page.title || page.id, page.namespace)}
              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800 last:border-0 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <FileText size={13} className="mt-0.5 flex-shrink-0 text-slate-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
                    {page.title || page.id}
                  </p>
                  {page.namespace && (
                    <p className="text-[11px] text-slate-400">{page.namespace.replace(/:/g, ' / ')}</p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
