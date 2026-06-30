import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Folder,
  File,
  FileText,
  Image as ImageIcon,
  Music,
  Video as VideoIcon,
  Archive,
  Download,
  Trash2,
  Pencil,
  FolderPlus,
  Upload,
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  Home,
  HardDrive,
  X,
  MoreVertical,
  Loader2,
  FileCode,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  Share2,
  Copy,
  FolderInput,
  RotateCcw,
  Link2,
  Trash,
  Folder as FolderIcn,
  Globe,
  CheckSquare,
  Square,
  CornerUpLeft,
  Star,
  Clock,
  Users,
  FolderClosed,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listDir,
  fetchQuota,
  makeFolder,
  deleteItem,
  moveItem,
  copyItem,
  uploadToDrive,
  downloadDriveFile,
  fetchThumb,
  fetchDriveBlob,
  searchDrive,
  listShares,
  createShare,
  removeShare,
  listTrash,
  restoreTrash,
  deleteTrashItem,
  emptyTrash,
  fetchFavorites,
  fetchRecent,
  fetchSharedView,
  setFavorite,
} from '../../api/drive';
import type { DriveEntry, DriveShare, TrashItem } from '../../api/drive';
import { getTalkAuth, searchNCUsers } from '../../api/talk';
import { FilePreviewModal } from '../FilePreview';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!n) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

type SortKey = 'name' | 'mtime' | 'size';
const SORT_LABELS: Record<SortKey, string> = { name: 'Nome', mtime: 'Modificado', size: 'Tamanho' };

type DriveViewKind = 'files' | 'recent' | 'favorites' | 'shared-in' | 'shared-out' | 'shared-link';
const VIEW_LABELS: Record<DriveViewKind, string> = {
  files: 'Meus arquivos',
  recent: 'Recentes',
  favorites: 'Favoritos',
  'shared-in': 'Comigo',
  'shared-out': 'Por mim',
  'shared-link': 'Por link',
};

const EXT_RE = /\.([a-z0-9]+)$/i;
function ext(name: string) {
  return (EXT_RE.exec(name)?.[1] || '').toLowerCase();
}

// Subtítulo do item conforme o contexto (pasta/busca/compartilhado).
function subtitleFor(e: DriveEntry, searchMode: boolean, special: boolean): string {
  if (e.sharedBy) return `de ${e.sharedBy}`;
  if (e.sharedWith) return `para ${e.sharedWith}`;
  if (searchMode || special) return e.path.split('/').slice(0, -1).join('/') || 'Início';
  const meta = e.isDir ? 'Pasta' : formatBytes(e.size);
  return e.mtime
    ? `${meta} · ${format(new Date(e.mtime * 1000), 'd MMM yyyy', { locale: ptBR })}`
    : meta;
}

function isImage(e: DriveEntry) {
  return e.mime.startsWith('image/') || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(ext(e.name));
}

// Ícone + cor por tipo de arquivo.
function FileGlyph({ entry, size = 22 }: { entry: DriveEntry; size?: number }) {
  if (entry.isDir)
    return <Folder size={size} className="text-blue-400 fill-blue-100 dark:fill-blue-900/40" />;
  const e = ext(entry.name);
  const m = entry.mime;
  const cls = 'flex-shrink-0';
  if (m.startsWith('image/') || isImage(entry))
    return <ImageIcon size={size} className={`${cls} text-emerald-500`} />;
  if (m.startsWith('audio/') || /^(mp3|wav|ogg|m4a|aac|opus|webm)$/.test(e))
    return <Music size={size} className={`${cls} text-pink-500`} />;
  if (m.startsWith('video/') || /^(mp4|mkv|mov|avi|wmv)$/.test(e))
    return <VideoIcon size={size} className={`${cls} text-purple-500`} />;
  if (/^(zip|rar|7z|tar|gz)$/.test(e))
    return <Archive size={size} className={`${cls} text-amber-500`} />;
  if (/^(pdf|doc|docx|txt|rtf|odt)$/.test(e))
    return <FileText size={size} className={`${cls} text-red-500`} />;
  if (/^(xls|xlsx|csv|ods)$/.test(e))
    return <FileSpreadsheet size={size} className={`${cls} text-green-600`} />;
  if (/^(js|ts|tsx|jsx|json|html|css|py|java|c|cpp|sh|xml|yml|yaml)$/.test(e))
    return <FileCode size={size} className={`${cls} text-sky-500`} />;
  return <File size={size} className={`${cls} text-slate-400`} />;
}

// Miniatura lazy (só busca quando entra na viewport e tem preview).
function DriveThumb({ entry, className }: { entry: DriveEntry; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!entry.hasPreview && !isImage(entry)) return;
    const el = ref.current;
    if (!el) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !done) {
          done = true;
          io.disconnect();
          fetchThumb(entry, 256)
            .then((u) => {
              if (u) {
                urlRef.current = u;
                setSrc(u);
              }
            })
            .catch(() => {});
        }
      },
      { rootMargin: '100px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [entry.fileId]);

  return (
    <div ref={ref} className={`flex items-center justify-center overflow-hidden ${className}`}>
      {src ? (
        <img src={src} alt={entry.name} className="w-full h-full object-cover" />
      ) : (
        <FileGlyph entry={entry} size={34} />
      )}
    </div>
  );
}

// ─── Breadcrumb ─────────────────────────────────────────────────────────────────

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean);
  return (
    <div className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
      <button
        onClick={() => onNavigate('')}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <Home size={14} /> Início
      </button>
      {parts.map((seg, i) => {
        const full = parts.slice(0, i + 1).join('/');
        const last = i === parts.length - 1;
        return (
          <div key={full} className="flex items-center gap-1 min-w-0">
            <ChevronRight size={13} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />
            <button
              onClick={() => onNavigate(full)}
              disabled={last}
              className={`px-1.5 py-0.5 rounded-md truncate max-w-[160px] transition-colors ${
                last
                  ? 'font-semibold text-slate-800 dark:text-slate-100 cursor-default'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {seg}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── View principal ───────────────────────────────────────────────────────────

export function DriveView() {
  const auth = getTalkAuth();
  const qc = useQueryClient();
  const [path, setPath] = useState('');
  const [view, setView] = useState<DriveViewKind>('files');
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>(() => {
    try {
      const r = JSON.parse(localStorage.getItem('rk_drive_sort') || '');
      if (r?.key) return r;
    } catch {
      /* ignore */
    }
    return { key: 'name', dir: 'asc' };
  });
  const [sortOpen, setSortOpen] = useState(false);
  const applySort = (s: { key: SortKey; dir: 'asc' | 'desc' }) => {
    setSort(s);
    try {
      localStorage.setItem('rk_drive_sort', JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DriveEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DriveEntry | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<DriveEntry | null>(null);
  const [shareTarget, setShareTarget] = useState<DriveEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    entries: DriveEntry[];
    mode: 'move' | 'copy';
  } | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [globalTerm, setGlobalTerm] = useState(''); // busca global recursiva
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [dropHover, setDropHover] = useState<string | null>(null); // pasta-alvo do drag interno
  const [visibleCount, setVisibleCount] = useState(120); // virtualização leve
  const sentinelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['drive', path],
    queryFn: () => listDir(path),
    enabled: !!auth,
    staleTime: 10_000,
  });
  const { data: quota } = useQuery({
    queryKey: ['drive-quota'],
    queryFn: fetchQuota,
    enabled: !!auth,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['drive', path] });
    qc.invalidateQueries({ queryKey: ['drive-quota'] });
  }, [qc, path]);

  const entries = useMemo(() => {
    const list = (data?.entries ?? []).filter(
      (e) => !query.trim() || e.name.toLowerCase().includes(query.toLowerCase()),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    const byName = (a: DriveEntry, b: DriveEntry) =>
      a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' });
    return [...list].sort((a, b) => {
      // Pastas sempre primeiro, independente da direção.
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      let r = 0;
      if (sort.key === 'size') r = a.size - b.size;
      else if (sort.key === 'mtime') r = a.mtime - b.mtime;
      else r = byName(a, b);
      if (r === 0) r = byName(a, b); // desempate estável por nome
      return r * dir;
    });
  }, [data, query, sort]);

  // Busca global recursiva (dispara ao pressionar Enter / clicar no globo)
  const { data: globalResults = [], isFetching: searching } = useQuery({
    queryKey: ['drive-search', globalTerm],
    queryFn: () => searchDrive(globalTerm),
    enabled: !!auth && globalTerm.length >= 2,
    staleTime: 30_000,
  });
  // Visões inteligentes (Recentes/Favoritos/Compartilhados)
  const special = view !== 'files';
  const { data: viewData = [], isFetching: viewLoading } = useQuery({
    queryKey: ['drive-special', view],
    queryFn: () =>
      view === 'recent'
        ? fetchRecent()
        : view === 'favorites'
          ? fetchFavorites()
          : view === 'shared-in'
            ? fetchSharedView('in')
            : view === 'shared-out'
              ? fetchSharedView('out')
              : view === 'shared-link'
                ? fetchSharedView('link')
                : Promise.resolve([] as DriveEntry[]),
    enabled: !!auth && special,
    staleTime: 15_000,
  });

  const searchMode = globalTerm.length >= 2;
  const canManage = view === 'files' && !searchMode; // drag/seleção/upload só aqui
  const shown = searchMode ? globalResults : special ? viewData : entries;
  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);

  const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');

  // Reseta a janela de virtualização quando muda o contexto.
  useEffect(() => {
    setVisibleCount(120);
  }, [path, query, sort, globalTerm, view]);

  // Alterna favorito e atualiza as listas afetadas.
  const toggleFav = async (e: DriveEntry) => {
    try {
      await setFavorite(e.path, !e.favorite);
      qc.invalidateQueries({ queryKey: ['drive', path] });
      qc.invalidateQueries({ queryKey: ['drive-special', 'favorites'] });
    } catch {
      /* noop */
    }
  };
  // Revela mais itens ao chegar no fim (virtualização leve).
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || visibleCount >= shown.length) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) setVisibleCount((c) => c + 120);
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, shown.length]);

  // ── Seleção múltipla ──
  const toggleSelect = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  const clearSelection = () => setSelected(new Set());
  useEffect(() => {
    clearSelection();
  }, [path, globalTerm, view]); // limpa ao trocar de pasta/busca/visão
  const selectedEntries = useMemo(
    () => shown.filter((e) => selected.has(e.path)),
    [shown, selected],
  );

  // Move um item arrastado para uma pasta-alvo (drag interno).
  const internalMove = async (fromPath: string, destFolder: string) => {
    const name = fromPath.split('/').pop()!;
    const dest = destFolder ? `${destFolder}/${name}` : name;
    if (dest === fromPath || destFolder === parentOf(fromPath)) return; // mesmo lugar
    if (destFolder === fromPath || destFolder.startsWith(fromPath + '/')) return; // pasta dentro de si
    try {
      await moveItem(fromPath, dest);
      refresh();
    } catch {
      /* noop */
    }
  };

  const doBulkDelete = async () => {
    setBusy(true);
    try {
      for (const e of selectedEntries) {
        try {
          await deleteItem(e.path);
        } catch {
          /* segue */
        }
      }
      clearSelection();
      setBulkDelete(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  // ── Ações ──
  const openEntry = (e: DriveEntry) => {
    if (e.isDir) {
      setView('files');
      setPath(e.path);
      setQuery('');
      setGlobalTerm('');
      return;
    }
    setPreview(e); // pré-visualiza (imagem/pdf/texto/áudio/vídeo) com fallback
  };

  const doCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await makeFolder(path ? `${path}/${name}` : name);
      refresh();
      setNewFolderOpen(false);
      setNewFolderName('');
    } finally {
      setBusy(false);
    }
  };

  const doRename = async () => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    setBusy(true);
    const dir = parentOf(renameTarget.path);
    try {
      await moveItem(renameTarget.path, dir ? `${dir}/${name}` : name);
      refresh();
      setRenameTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await deleteItem(deleteTarget.path);
      refresh();
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (!arr.length) return;
    for (let i = 0; i < arr.length; i++) {
      setUploadPct(0);
      try {
        await uploadToDrive(path, arr[i], (pct) => setUploadPct(pct));
      } catch {
        /* segue */
      }
    }
    setUploadPct(null);
    refresh();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) uploadFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  };

  // drag-drop
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    if ([...e.dataTransfer.types].includes('Files')) setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  };

  if (!auth) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <HardDrive size={40} className="text-slate-300 dark:text-slate-600 mb-3" />
        <h2 className="text-lg font-semibold text-slate-700 dark:text-slate-200">
          Drive não conectado
        </h2>
        <p className="text-sm text-slate-400 mt-1 max-w-sm">
          Conecte sua conta Nextcloud (na aba Mensagens/Talk) para acessar seus arquivos aqui.
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
        <HardDrive size={20} className="text-blue-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {view === 'files' ? (
            <Breadcrumb
              path={path}
              onNavigate={(p) => {
                setPath(p);
                setQuery('');
                setGlobalTerm('');
              }}
            />
          ) : (
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {VIEW_LABELS[view]}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5 mr-1">
            <Search size={13} className="text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim().length >= 2) setGlobalTerm(query.trim());
              }}
              placeholder="Filtrar (Enter = buscar tudo)"
              className="bg-transparent text-xs focus:outline-none w-28 md:w-40 placeholder-slate-400 text-slate-700 dark:text-slate-200"
            />
            {searching && <Loader2 size={12} className="text-blue-400 animate-spin" />}
            <button
              onClick={() => query.trim().length >= 2 && setGlobalTerm(query.trim())}
              title="Buscar em todo o Drive"
              className="text-slate-400 hover:text-blue-600"
            >
              <Globe size={13} />
            </button>
            {(query || globalTerm) && (
              <button
                onClick={() => {
                  setQuery('');
                  setGlobalTerm('');
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Ordenação */}
          <div className="relative">
            <button
              onClick={() => setSortOpen((v) => !v)}
              title="Ordenar"
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${sortOpen ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            >
              <ArrowUpDown size={14} />
              <span className="hidden lg:inline">{SORT_LABELS[sort.key]}</span>
              {sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 overflow-hidden">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => applySort({ key: k, dir: sort.dir })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <span className="w-3.5">
                        {sort.key === k && <Check size={13} className="text-blue-600" />}
                      </span>
                      {SORT_LABELS[k]}
                    </button>
                  ))}
                  <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                  <button
                    onClick={() => applySort({ key: sort.key, dir: 'asc' })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <span className="w-3.5">
                      {sort.dir === 'asc' && <Check size={13} className="text-blue-600" />}
                    </span>
                    <ArrowUp size={12} className="text-slate-400" /> Crescente
                  </button>
                  <button
                    onClick={() => applySort({ key: sort.key, dir: 'desc' })}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <span className="w-3.5">
                      {sort.dir === 'desc' && <Check size={13} className="text-blue-600" />}
                    </span>
                    <ArrowDown size={12} className="text-slate-400" /> Decrescente
                  </button>
                </div>
              </>
            )}
          </div>
          {canManage && (
            <>
              <button
                onClick={() => setNewFolderOpen(true)}
                title="Nova pasta"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <FolderPlus size={15} /> <span className="hidden md:inline">Nova pasta</span>
              </button>
              <input
                type="file"
                ref={fileRef}
                multiple
                onChange={handleFileInput}
                className="hidden"
              />
              <button
                onClick={() => fileRef.current?.click()}
                title="Enviar arquivos"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
              >
                <Upload size={15} /> <span className="hidden md:inline">Enviar</span>
              </button>
            </>
          )}
          <button
            onClick={() => setShowTrash(true)}
            title="Lixeira"
            className="p-1.5 rounded-lg text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Trash size={15} />
          </button>
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 ml-1">
            <button
              onClick={() => setMode('grid')}
              title="Grade"
              className={`p-1.5 rounded-md transition-colors ${mode === 'grid' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setMode('list')}
              title="Lista"
              className={`p-1.5 rounded-md transition-colors ${mode === 'list' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <ListIcon size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Abas de visões (pills) */}
      <div className="flex items-center gap-1.5 flex-wrap flex-shrink-0">
        {[
          { v: 'files' as DriveViewKind, icon: <FolderClosed size={13} /> },
          { v: 'recent' as DriveViewKind, icon: <Clock size={13} /> },
          { v: 'favorites' as DriveViewKind, icon: <Star size={13} /> },
        ].map((t) => (
          <button
            key={t.v}
            onClick={() => {
              setView(t.v);
              setGlobalTerm('');
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              view === t.v
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-300'
            }`}
          >
            {t.icon} {VIEW_LABELS[t.v]}
          </button>
        ))}
        {/* Compartilhados (com sub-filtro) */}
        <button
          onClick={() => {
            setView('shared-in');
            setGlobalTerm('');
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            view.startsWith('shared')
              ? 'bg-blue-600 text-white'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-300'
          }`}
        >
          <Users size={13} /> Compartilhados
        </button>
        {view.startsWith('shared') && (
          <div className="flex items-center gap-1 ml-1 pl-2 border-l border-slate-200 dark:border-slate-700">
            {(['shared-in', 'shared-out', 'shared-link'] as DriveViewKind[]).map((sv) => (
              <button
                key={sv}
                onClick={() => setView(sv)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  view === sv
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {VIEW_LABELS[sv]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progresso de upload */}
      {uploadPct !== null && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/40 rounded-xl flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
            <Upload size={13} /> Enviando… {uploadPct}%
          </div>
          <div className="h-1 bg-blue-100 dark:bg-blue-900/40 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-blue-500 transition-all duration-200 rounded-full"
              style={{ width: `${uploadPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Barra de busca global / seleção */}
      {searchMode && selected.size === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-700 dark:text-blue-300 flex-shrink-0">
          <Globe size={14} /> Resultados para <b>“{globalTerm}”</b> em todo o Drive · {shown.length}
          <button
            onClick={() => {
              setGlobalTerm('');
              setQuery('');
            }}
            className="ml-auto flex items-center gap-1 hover:underline"
          >
            <CornerUpLeft size={12} /> Voltar
          </button>
        </div>
      )}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex-shrink-0">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {selected.size} selecionado(s)
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setMoveTarget({ entries: selectedEntries, mode: 'move' })}
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <FolderInput size={13} /> Mover
          </button>
          <button
            onClick={() => setMoveTarget({ entries: selectedEntries, mode: 'copy' })}
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
          >
            <Copy size={13} /> Copiar
          </button>
          <button
            onClick={() => setBulkDelete(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
          >
            <Trash2 size={13} /> Excluir
          </button>
          <button onClick={clearSelection} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Conteúdo */}
      <div className="relative min-h-[340px]">
        {isDragging && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-blue-50/90 dark:bg-blue-900/40 border-2 border-dashed border-blue-400 rounded-2xl pointer-events-none">
            <Upload size={34} className="text-blue-500 mb-2" />
            <p className="text-sm font-semibold text-blue-600 dark:text-blue-300">
              Soltar para enviar nesta pasta
            </p>
          </div>
        )}

        {((isLoading && !special && !searchMode) ||
          (special && viewLoading) ||
          (searchMode && searching)) && (
          <div className="flex items-center justify-center h-40 text-slate-400 gap-2">
            <Loader2 size={18} className="animate-spin" />{' '}
            {searchMode ? 'Buscando…' : 'Carregando…'}
          </div>
        )}
        {isError && !searchMode && !special && (
          <div className="flex items-center justify-center h-40 text-red-400 text-sm">
            Não foi possível acessar o Drive.
          </div>
        )}
        {!isLoading && !viewLoading && !isError && !searching && shown.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            {special ? (
              <Star size={32} className="mb-2 opacity-40" />
            ) : (
              <Folder size={32} className="mb-2 opacity-40" />
            )}
            <p className="text-sm">
              {searchMode
                ? 'Nenhum resultado'
                : special
                  ? `Nada em ${VIEW_LABELS[view]}`
                  : query
                    ? 'Nenhum item encontrado'
                    : 'Pasta vazia'}
            </p>
          </div>
        )}

        {/* GRADE */}
        {mode === 'grid' && shown.length > 0 && (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}
          >
            {visible.map((e) => {
              const sel = selected.has(e.path);
              return (
                <div
                  key={e.path}
                  draggable={canManage}
                  onDragStart={
                    canManage
                      ? (ev) => {
                          ev.dataTransfer.setData('application/x-drive-path', e.path);
                          ev.dataTransfer.effectAllowed = 'move';
                        }
                      : undefined
                  }
                  onDragOver={
                    canManage && e.isDir
                      ? (ev) => {
                          if (ev.dataTransfer.types.includes('application/x-drive-path')) {
                            ev.preventDefault();
                            setDropHover(e.path);
                          }
                        }
                      : undefined
                  }
                  onDragLeave={
                    canManage && e.isDir
                      ? () => setDropHover((h) => (h === e.path ? null : h))
                      : undefined
                  }
                  onDrop={
                    canManage && e.isDir
                      ? (ev) => {
                          const from = ev.dataTransfer.getData('application/x-drive-path');
                          if (from) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setDropHover(null);
                            internalMove(from, e.path);
                          }
                        }
                      : undefined
                  }
                  className={`group relative flex flex-col bg-white dark:bg-slate-900 border rounded-xl overflow-hidden transition-all cursor-pointer ${
                    dropHover === e.path
                      ? 'border-blue-500 ring-2 ring-blue-300'
                      : sel
                        ? 'border-blue-400 ring-1 ring-blue-300'
                        : 'border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md'
                  }`}
                >
                  {canManage && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleSelect(e.path);
                      }}
                      className={`absolute top-1.5 left-1.5 z-10 transition-opacity ${sel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      {sel ? (
                        <CheckSquare
                          size={17}
                          className="text-blue-600 bg-white dark:bg-slate-900 rounded"
                        />
                      ) : (
                        <Square
                          size={17}
                          className="text-slate-400 bg-white/80 dark:bg-slate-900/80 rounded"
                        />
                      )}
                    </button>
                  )}
                  {e.favorite && (
                    <Star
                      size={14}
                      className="absolute top-1.5 right-1.5 z-10 text-amber-400 fill-amber-400 drop-shadow"
                    />
                  )}
                  <div
                    className="relative aspect-square bg-slate-50 dark:bg-slate-800/50 flex items-center justify-center overflow-hidden"
                    onClick={() => openEntry(e)}
                  >
                    {e.isDir ? (
                      <Folder
                        size={42}
                        className="text-blue-400 fill-blue-100 dark:fill-blue-900/40"
                      />
                    ) : (
                      <DriveThumb entry={e} className="absolute inset-0" />
                    )}
                  </div>
                  <div className="px-2 py-1.5 border-t border-slate-100 dark:border-slate-800 min-w-0">
                    <p
                      className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate"
                      title={e.name}
                    >
                      {e.name}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {subtitleFor(e, searchMode, special)}
                    </p>
                  </div>
                  <ItemMenu
                    entry={e}
                    open={menuFor === e.path}
                    onToggle={() => setMenuFor(menuFor === e.path ? null : e.path)}
                    onClose={() => setMenuFor(null)}
                    canManage={canManage}
                    onDownload={() => downloadDriveFile(e.path)}
                    onRename={() => {
                      setRenameTarget(e);
                      setRenameValue(e.name);
                    }}
                    onDelete={() => setDeleteTarget(e)}
                    onShare={() => setShareTarget(e)}
                    onMove={() => setMoveTarget({ entries: [e], mode: 'move' })}
                    onCopy={() => setMoveTarget({ entries: [e], mode: 'copy' })}
                    onToggleFav={() => toggleFav(e)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* LISTA */}
        {mode === 'list' && shown.length > 0 && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            {visible.map((e) => {
              const sel = selected.has(e.path);
              return (
                <div
                  key={e.path}
                  draggable={canManage}
                  onDragStart={
                    canManage
                      ? (ev) => {
                          ev.dataTransfer.setData('application/x-drive-path', e.path);
                          ev.dataTransfer.effectAllowed = 'move';
                        }
                      : undefined
                  }
                  onDragOver={
                    canManage && e.isDir
                      ? (ev) => {
                          if (ev.dataTransfer.types.includes('application/x-drive-path')) {
                            ev.preventDefault();
                            setDropHover(e.path);
                          }
                        }
                      : undefined
                  }
                  onDragLeave={
                    canManage && e.isDir
                      ? () => setDropHover((h) => (h === e.path ? null : h))
                      : undefined
                  }
                  onDrop={
                    canManage && e.isDir
                      ? (ev) => {
                          const from = ev.dataTransfer.getData('application/x-drive-path');
                          if (from) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            setDropHover(null);
                            internalMove(from, e.path);
                          }
                        }
                      : undefined
                  }
                  className={`group flex items-center gap-3 px-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors cursor-pointer ${
                    dropHover === e.path
                      ? 'bg-blue-50 dark:bg-blue-900/30'
                      : sel
                        ? 'bg-blue-50/60 dark:bg-blue-900/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {canManage && (
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        toggleSelect(e.path);
                      }}
                      className="flex-shrink-0"
                    >
                      {sel ? (
                        <CheckSquare size={16} className="text-blue-600" />
                      ) : (
                        <Square
                          size={16}
                          className="text-slate-300 dark:text-slate-600 group-hover:text-slate-400"
                        />
                      )}
                    </button>
                  )}
                  {e.isDir ? (
                    <div className="w-9 h-9 flex items-center justify-center flex-shrink-0">
                      <Folder
                        size={22}
                        className="text-blue-400 fill-blue-100 dark:fill-blue-900/40"
                      />
                    </div>
                  ) : (
                    <DriveThumb
                      entry={e}
                      className="w-9 h-9 rounded-md bg-slate-100 dark:bg-slate-800 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0" onClick={() => openEntry(e)}>
                    <p
                      className="text-sm text-slate-700 dark:text-slate-200 truncate flex items-center gap-1.5"
                      title={e.name}
                    >
                      {e.name}
                      {e.favorite && (
                        <Star size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />
                      )}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {subtitleFor(e, searchMode, special)}
                    </p>
                  </div>
                  <ItemMenu
                    entry={e}
                    open={menuFor === e.path}
                    onToggle={() => setMenuFor(menuFor === e.path ? null : e.path)}
                    onClose={() => setMenuFor(null)}
                    inline
                    canManage={canManage}
                    onDownload={() => downloadDriveFile(e.path)}
                    onRename={() => {
                      setRenameTarget(e);
                      setRenameValue(e.name);
                    }}
                    onDelete={() => setDeleteTarget(e)}
                    onShare={() => setShareTarget(e)}
                    onMove={() => setMoveTarget({ entries: [e], mode: 'move' })}
                    onCopy={() => setMoveTarget({ entries: [e], mode: 'copy' })}
                    onToggleFav={() => toggleFav(e)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Sentinela de virtualização leve */}
        {visibleCount < shown.length && (
          <div
            ref={sentinelRef}
            className="h-10 flex items-center justify-center text-[11px] text-slate-400"
          >
            Carregando mais… ({visibleCount}/{shown.length})
          </div>
        )}
      </div>

      {/* Rodapé: quota */}
      {quota &&
        quota.available >= 0 &&
        (() => {
          const total = quota.used + quota.available;
          const pct = total > 0 ? Math.min(100, (quota.used / total) * 100) : 0;
          return (
            <div className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3 flex-shrink-0">
              <HardDrive size={14} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 max-w-xs h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-blue-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[11px] text-slate-400">
                {formatBytes(quota.used)} de {formatBytes(total)}
              </span>
            </div>
          );
        })()}

      {/* Pré-visualização */}
      {preview && (
        <FilePreviewModal
          file={{ name: preview.name, mime: preview.mime, ncFileId: preview.fileId }}
          load={() => fetchDriveBlob(preview.path)}
          onDownload={() => downloadDriveFile(preview.path)}
          ncUrl={auth?.url}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Dialog: nova pasta */}
      {newFolderOpen && (
        <Modal
          onClose={() => setNewFolderOpen(false)}
          title="Nova pasta"
          icon={<FolderPlus size={16} className="text-blue-600" />}
        >
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doCreateFolder();
            }}
            placeholder="Nome da pasta"
            className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-700 dark:text-slate-200"
          />
          <ModalActions
            onCancel={() => setNewFolderOpen(false)}
            onConfirm={doCreateFolder}
            confirmLabel="Criar"
            busy={busy}
            disabled={!newFolderName.trim()}
          />
        </Modal>
      )}

      {/* Dialog: renomear */}
      {renameTarget && (
        <Modal
          onClose={() => setRenameTarget(null)}
          title="Renomear"
          icon={<Pencil size={16} className="text-blue-600" />}
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doRename();
            }}
            className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-700 dark:text-slate-200"
          />
          <ModalActions
            onCancel={() => setRenameTarget(null)}
            onConfirm={doRename}
            confirmLabel="Salvar"
            busy={busy}
            disabled={!renameValue.trim()}
          />
        </Modal>
      )}

      {/* Dialog: excluir */}
      {deleteTarget && (
        <Modal
          onClose={() => setDeleteTarget(null)}
          title="Mover para a lixeira"
          icon={<Trash2 size={16} className="text-red-600" />}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Mover <b className="break-all">{deleteTarget.name}</b> para a lixeira do Nextcloud? Você
            pode restaurar depois por lá.
          </p>
          <ModalActions
            onCancel={() => setDeleteTarget(null)}
            onConfirm={doDelete}
            confirmLabel="Mover para lixeira"
            busy={busy}
            danger
          />
        </Modal>
      )}

      {shareTarget && <ShareModal entry={shareTarget} onClose={() => setShareTarget(null)} />}
      {moveTarget && (
        <FolderPicker
          entries={moveTarget.entries}
          mode={moveTarget.mode}
          onClose={() => setMoveTarget(null)}
          onDone={() => {
            setMoveTarget(null);
            clearSelection();
            refresh();
          }}
        />
      )}
      {bulkDelete && (
        <Modal
          onClose={() => setBulkDelete(false)}
          title="Mover para a lixeira"
          icon={<Trash2 size={16} className="text-red-600" />}
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Mover <b>{selected.size}</b> item(ns) para a lixeira do Nextcloud?
          </p>
          <ModalActions
            onCancel={() => setBulkDelete(false)}
            onConfirm={doBulkDelete}
            confirmLabel="Mover para lixeira"
            busy={busy}
            danger
          />
        </Modal>
      )}
      {showTrash && <TrashModal onClose={() => setShowTrash(false)} onChanged={refresh} />}
    </div>
  );
}

// ─── Menu de ações por item ───────────────────────────────────────────────────

function ItemMenu({
  entry,
  open,
  onToggle,
  onClose,
  onDownload,
  onRename,
  onDelete,
  onShare,
  onMove,
  onCopy,
  onToggleFav,
  canManage,
  inline,
}: {
  entry: DriveEntry;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDownload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: () => void;
  onMove: () => void;
  onCopy: () => void;
  onToggleFav: () => void;
  canManage: boolean;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'relative flex-shrink-0' : 'absolute top-1.5 right-1.5'}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`p-1 rounded-lg bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 shadow-sm transition-opacity ${
          inline ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
        } ${open ? '!opacity-100' : ''}`}
      >
        <MoreVertical size={14} />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-40 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {!entry.isDir && (
              <button
                onClick={() => {
                  onDownload();
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
              >
                <Download size={13} className="text-slate-400" /> Baixar
              </button>
            )}
            <button
              onClick={() => {
                onToggleFav();
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            >
              <Star
                size={13}
                className={entry.favorite ? 'text-amber-400 fill-amber-400' : 'text-slate-400'}
              />{' '}
              {entry.favorite ? 'Desfavoritar' : 'Favoritar'}
            </button>
            <button
              onClick={() => {
                onShare();
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
            >
              <Share2 size={13} className="text-slate-400" /> Compartilhar
            </button>
            {canManage && (
              <>
                <button
                  onClick={() => {
                    onMove();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <FolderInput size={13} className="text-slate-400" /> Mover…
                </button>
                <button
                  onClick={() => {
                    onCopy();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Copy size={13} className="text-slate-400" /> Copiar…
                </button>
                <button
                  onClick={() => {
                    onRename();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  <Pencil size={13} className="text-slate-400" /> Renomear
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-700 my-1" />
                <button
                  onClick={() => {
                    onDelete();
                    onClose();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={13} /> Excluir
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Modal genérico ─────────────────────────────────────────────────────────────

function Modal({
  title,
  icon,
  children,
  onClose,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          {icon}
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
  disabled,
  danger,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex gap-2 justify-end">
      <button
        onClick={onCancel}
        className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
      >
        Cancelar
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors disabled:opacity-40 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
      >
        {busy ? '…' : confirmLabel}
      </button>
    </div>
  );
}

// ─── Compartilhar ───────────────────────────────────────────────────────────────

function ShareModal({ entry, onClose }: { entry: DriveEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: shares = [], isLoading } = useQuery({
    queryKey: ['drive-shares', entry.path],
    queryFn: () => listShares(entry.path),
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const { data: users = [] } = useQuery({
    queryKey: ['nc-users', userQuery],
    queryFn: () => searchNCUsers(userQuery),
    enabled: userQuery.length >= 2,
    staleTime: 30_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['drive-shares', entry.path] });
  const links = (shares as DriveShare[]).filter((s) => s.share_type === 3);
  const people = (shares as DriveShare[]).filter((s) => s.share_type === 0);
  const sharedIds = new Set(people.map((p) => p.share_with));

  const addLink = async () => {
    setBusy(true);
    try {
      await createShare(entry.path, 3);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const addUser = async (id: string) => {
    setBusy(true);
    try {
      await createShare(entry.path, 0, id);
      setUserQuery('');
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: number) => {
    setBusy(true);
    try {
      await removeShare(id);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const copy = (s: DriveShare) => {
    if (s.url) {
      navigator.clipboard?.writeText(s.url).catch(() => {});
      setCopied(s.id);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  return (
    <Modal
      title="Compartilhar"
      icon={<Share2 size={16} className="text-blue-600" />}
      onClose={onClose}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 truncate -mt-1">{entry.name}</p>

      {/* Links públicos */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
            Links públicos
          </span>
          <button
            onClick={addLink}
            disabled={busy}
            className="flex items-center gap-1 text-[11px] text-blue-600 hover:text-blue-700 font-medium"
          >
            <Link2 size={12} /> Criar link
          </button>
        </div>
        {isLoading && <p className="text-[11px] text-slate-400">Carregando…</p>}
        {!isLoading && links.length === 0 && (
          <p className="text-[11px] text-slate-400">Nenhum link.</p>
        )}
        <div className="space-y-1">
          {links.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg px-2 py-1.5"
            >
              <Link2 size={12} className="text-slate-400 flex-shrink-0" />
              <span className="flex-1 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                {s.url}
              </span>
              <button
                onClick={() => copy(s)}
                title="Copiar"
                className="text-slate-400 hover:text-blue-600"
              >
                {copied === s.id ? (
                  <Check size={13} className="text-green-500" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
              <button
                onClick={() => remove(s.id)}
                title="Remover"
                className="text-slate-400 hover:text-red-500"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Compartilhar com usuário */}
      <div>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
          Com pessoas
        </span>
        <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg px-2.5 py-1.5 mt-1.5">
          <Search size={12} className="text-slate-400" />
          <input
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="Buscar usuário…"
            className="flex-1 bg-transparent text-xs focus:outline-none placeholder-slate-400 text-slate-700 dark:text-slate-200"
          />
        </div>
        {userQuery.length >= 2 && users.filter((u) => !sharedIds.has(u.id)).length > 0 && (
          <div className="mt-1 border border-slate-200 dark:border-slate-700 rounded-lg max-h-32 overflow-y-auto">
            {users
              .filter((u) => !sharedIds.has(u.id))
              .map((u) => (
                <button
                  key={u.id}
                  onClick={() => addUser(u.id)}
                  disabled={busy}
                  className="w-full text-left px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 truncate"
                >
                  {u.label}
                </button>
              ))}
          </div>
        )}
        <div className="space-y-1 mt-1.5">
          {people.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-2.5 py-1.5"
            >
              <span className="flex-1 text-xs text-slate-700 dark:text-slate-200 truncate">
                {s.share_with_displayname || s.share_with}
              </span>
              <button
                onClick={() => remove(s.id)}
                title="Remover"
                className="text-slate-400 hover:text-red-500"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
        >
          Fechar
        </button>
      </div>
    </Modal>
  );
}

// ─── Mover / Copiar para pasta ────────────────────────────────────────────────────

function FolderPicker({
  entries,
  mode,
  onClose,
  onDone,
}: {
  entries: DriveEntry[];
  mode: 'move' | 'copy';
  onClose: () => void;
  onDone: () => void;
}) {
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['drive-pick', path],
    queryFn: () => listDir(path),
  });
  const folders = (data?.entries ?? []).filter((e) => e.isDir);
  // Inválido se for o mesmo lugar de algum item, ou destino dentro de uma pasta selecionada.
  const invalid = entries.some((e) => {
    const parent = e.path.split('/').slice(0, -1).join('/');
    return path === parent || (e.isDir && (path === e.path || path.startsWith(e.path + '/')));
  });
  const label = entries.length === 1 ? entries[0].name : `${entries.length} itens`;
  const parts = path.split('/').filter(Boolean);

  const go = async () => {
    setBusy(true);
    try {
      for (const e of entries) {
        const dest = path ? `${path}/${e.name}` : e.name;
        try {
          mode === 'move' ? await moveItem(e.path, dest) : await copyItem(e.path, dest);
        } catch {
          /* segue */
        }
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'move' ? 'Mover para…' : 'Copiar para…'}
      icon={
        mode === 'move' ? (
          <FolderInput size={16} className="text-blue-600" />
        ) : (
          <Copy size={16} className="text-blue-600" />
        )
      }
      onClose={onClose}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 truncate -mt-1">{label}</p>
      {/* Breadcrumb do destino */}
      <div className="flex items-center gap-1 text-xs flex-wrap">
        <button
          onClick={() => setPath('')}
          className="px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1"
        >
          <Home size={12} /> Início
        </button>
        {parts.map((seg, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight size={12} className="text-slate-300" />
            <button
              onClick={() => setPath(parts.slice(0, i + 1).join('/'))}
              className="px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 truncate max-w-[110px]"
            >
              {seg}
            </button>
          </div>
        ))}
      </div>
      {/* Lista de pastas */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg max-h-56 overflow-y-auto scrollbar-thin">
        {isLoading && <p className="text-[11px] text-slate-400 text-center py-4">Carregando…</p>}
        {!isLoading && folders.length === 0 && (
          <p className="text-[11px] text-slate-400 text-center py-4">Sem subpastas aqui</p>
        )}
        {folders.map((f) => (
          <button
            key={f.path}
            onClick={() => setPath(f.path)}
            disabled={entries.some((e) => e.isDir && f.path === e.path)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 text-left"
          >
            <FolderIcn size={15} className="text-blue-400 flex-shrink-0" />
            <span className="flex-1 truncate">{f.name}</span>
            <ChevronRight size={13} className="text-slate-300" />
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400">
        Destino: <b className="text-slate-600 dark:text-slate-300">{path || 'Início'}</b>
        {invalid && <span className="text-amber-500"> — escolha outra pasta</span>}
      </p>
      <ModalActions
        onCancel={onClose}
        onConfirm={go}
        confirmLabel={mode === 'move' ? 'Mover aqui' : 'Copiar aqui'}
        busy={busy}
        disabled={invalid}
      />
    </Modal>
  );
}

// ─── Lixeira ────────────────────────────────────────────────────────────────────

function TrashModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['drive-trash'],
    queryFn: listTrash,
  });
  const [busy, setBusy] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['drive-trash'] });
    onChanged();
  };

  const restore = async (it: TrashItem) => {
    setBusy(true);
    try {
      await restoreTrash(it.href);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const del = async (it: TrashItem) => {
    setBusy(true);
    try {
      await deleteTrashItem(it.href);
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const empty = async () => {
    setBusy(true);
    try {
      await emptyTrash();
      setConfirmEmpty(false);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-96 max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Trash size={16} className="text-slate-500" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Lixeira
            </span>
            <span className="text-[11px] text-slate-400">{items.length}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
          {isLoading && <p className="text-xs text-slate-400 text-center py-6">Carregando…</p>}
          {!isLoading && items.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-6">A lixeira está vazia</p>
          )}
          {items.map((it) => (
            <div
              key={it.href}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              {it.isDir ? (
                <FolderIcn size={18} className="text-blue-400 flex-shrink-0" />
              ) : (
                <File size={18} className="text-slate-400 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-700 dark:text-slate-200 truncate">{it.name}</p>
                {it.deletedAt > 0 && (
                  <p className="text-[10px] text-slate-400">
                    {format(new Date(it.deletedAt * 1000), "d MMM yyyy 'às' HH:mm", {
                      locale: ptBR,
                    })}
                  </p>
                )}
              </div>
              <button
                onClick={() => restore(it)}
                disabled={busy}
                title="Restaurar"
                className="p-1 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
              >
                <RotateCcw size={13} />
              </button>
              <button
                onClick={() => del(it)}
                disabled={busy}
                title="Excluir permanentemente"
                className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <div className="px-4 py-2.5 border-t border-slate-100 dark:border-slate-800">
            {confirmEmpty ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300 flex-1">
                  Esvaziar tudo permanentemente?
                </span>
                <button
                  onClick={() => setConfirmEmpty(false)}
                  className="px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  onClick={empty}
                  disabled={busy}
                  className="px-2 py-1 text-[11px] bg-red-600 hover:bg-red-700 text-white rounded-lg"
                >
                  Esvaziar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmEmpty(true)}
                className="w-full flex items-center justify-center gap-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <Trash size={13} /> Esvaziar lixeira
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
