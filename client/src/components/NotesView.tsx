import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Pin,
  PinOff,
  Trash2,
  Tag as TagIcon,
  X,
  Link2,
  Send,
  StickyNote,
  Loader2,
  Check,
  ExternalLink,
  Palette,
  Copy,
  Download,
  Folder,
  CalendarDays,
  CheckSquare,
  AlertCircle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote } from '../hooks/useNotes';
import { useProjects, useEditFields } from '../hooks/useRedmine';
import { localChecklists, useChecklist } from '../utils/localChecklists';
import { fuzzyBest } from '../utils/fuzzy';
import { newNoteId, type Note, type NotePatch } from '../api/notes';
import type { EditField } from '../types/redmine';
import { RichNoteEditor } from './RichNoteEditor';
import { RequiredFieldsModal } from './RequiredFieldsModal';
import { redmineApi } from '../api/redmine';
import { markdownToTextile } from '../utils/markdownToTextile';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// ─── Templates de nota ────────────────────────────────────────────────────────
const TPL_ATA = `## Participantes
-

## Pauta
-

## Decisões
-

## Ações
- [ ] `;
const TPL_1ON1 = `## Conquistas recentes
-

## Desafios / bloqueios
-

## Combinados
- [ ] `;
const TPL_RETRO = `## O que foi bem 👍
-

## O que pode melhorar 🔧
-

## Ações 🎯
- [ ] `;
const TPL_DIARIA = `## Foco de hoje
-

## Feito
-

## Anotações
`;

const today = () => format(new Date(), 'dd/MM/yyyy', { locale: ptBR });

const TEMPLATES: { key: string; label: string; make: () => NotePatch }[] = [
  { key: 'blank', label: 'Em branco', make: () => ({}) },
  {
    key: 'meeting',
    label: 'Ata de reunião',
    make: () => ({ title: `Ata — ${today()}`, tags: ['reunião'], body: TPL_ATA }),
  },
  {
    key: '1on1',
    label: '1:1',
    make: () => ({ title: `1:1 — ${today()}`, tags: ['1:1'], body: TPL_1ON1 }),
  },
  {
    key: 'retro',
    label: 'Retrospectiva',
    make: () => ({ title: `Retro — ${today()}`, tags: ['retro'], body: TPL_RETRO }),
  },
];

// Paleta de cores para organização visual (chave salva no campo color)
const COLORS: { key: string; dot: string; stripe: string }[] = [
  { key: 'slate', dot: 'bg-slate-300', stripe: 'bg-slate-300' },
  { key: 'blue', dot: 'bg-blue-400', stripe: 'bg-blue-400' },
  { key: 'green', dot: 'bg-green-400', stripe: 'bg-green-400' },
  { key: 'amber', dot: 'bg-amber-400', stripe: 'bg-amber-400' },
  { key: 'rose', dot: 'bg-rose-400', stripe: 'bg-rose-400' },
  { key: 'violet', dot: 'bg-violet-400', stripe: 'bg-violet-400' },
];
const stripeFor = (key: string | null) => COLORS.find((c) => c.key === key)?.stripe ?? '';

function noteTitle(n: Note): string {
  if (n.title.trim()) return n.title.trim();
  const firstLine = n.body.split('\n').find((l) => l.trim());
  return firstLine?.replace(/^#+\s*/, '').trim() || 'Sem título';
}

// ─── Busca de tarefa para vincular ────────────────────────────────────────────
function IssueLinker({
  onPick,
  onClose,
}: {
  onPick: (issue: { id: number; subject: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora do dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['note-issue-search', q],
    queryFn: () => redmineApi.searchIssues(q),
    enabled: q.trim().length >= 2,
    staleTime: 30_000,
  });
  return (
    <div
      ref={ref}
      className="absolute z-30 top-full left-0 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        <Search size={13} className="text-slate-400 flex-shrink-0" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Buscar tarefa (#id ou texto)…"
          className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400"
        />
      </div>
      <div className="max-h-56 overflow-y-auto scrollbar-thin">
        {isFetching && <div className="px-3 py-3 text-xs text-slate-400">Buscando…</div>}
        {!isFetching && q.trim().length >= 2 && results.length === 0 && (
          <div className="px-3 py-3 text-xs text-slate-400">Nenhuma tarefa encontrada</div>
        )}
        {q.trim().length < 2 && (
          <div className="px-3 py-3 text-xs text-slate-400">Digite ao menos 2 caracteres</div>
        )}
        {results.slice(0, 8).map((issue) => (
          <button
            key={issue.id}
            onClick={() => onPick(issue)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
          >
            <span className="font-mono text-[10px] font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">
              #{issue.id}
            </span>
            <span className="text-xs text-slate-700 dark:text-slate-200 truncate">
              {issue.subject}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Chip da tarefa vinculada ─────────────────────────────────────────────────
function LinkedIssueChip({
  id,
  onOpen,
  onUnlink,
}: {
  id: number;
  onOpen?: (id: number) => void;
  onUnlink: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['note-linked-issue', id],
    queryFn: () =>
      redmineApi
        .getIssue(id)
        .then((i) => ({ id: i.id, subject: i.subject }))
        .catch(() => null),
    staleTime: 10 * 60 * 1000,
  });
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg text-xs bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300">
      <button
        onClick={() => onOpen?.(id)}
        className="inline-flex items-center gap-1 hover:underline"
        title="Abrir tarefa"
      >
        <span className="font-mono font-bold">#{id}</span>
        {data?.subject && <span className="max-w-40 truncate">{data.subject}</span>}
        <ExternalLink size={10} />
      </button>
      <button onClick={onUnlink} className="text-blue-400 hover:text-red-500" title="Desvincular">
        <X size={11} />
      </button>
    </span>
  );
}

// ─── Editor de uma nota (estilo documento, minimalista) ──────────────────────
function NoteEditor({
  note,
  onIssueClick,
  projectName,
  onDuplicate,
  onAutoDeleteEmpty,
  allNotes,
  onSelectNote,
}: {
  note: Note;
  onIssueClick?: (id: number) => void;
  projectName?: string;
  onDuplicate: (note: Note) => void;
  onAutoDeleteEmpty: (id: string) => void;
  allNotes: Note[];
  onSelectNote: (id: string) => void;
}) {
  const updateNote = useUpdateNote();
  const checklist = useChecklist(note.linkedIssueId ?? -1);
  const [clInput, setClInput] = useState('');
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tagInput, setTagInput] = useState('');
  const [showTagInput, setShowTagInput] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState('');
  const [saving, setSaving] = useState(false);

  // Campos obrigatórios: quando o Redmine recusa o comentário (422) por campo em
  // branco, abrimos o mesmo popup do IssueModal para preencher e reenviar tudo junto.
  // `pendingRequired` guarda os erros (persiste p/ reabrir); `requiredOpen` é a visibilidade.
  const [pendingRequired, setPendingRequired] = useState<{ errors: string[] } | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(false);
  // Busca projeto/tracker da tarefa só quando o popup é necessário (p/ a chave de
  // cache do schema; o scraping em si usa o id da tarefa).
  const { data: linkedIssue } = useQuery({
    queryKey: ['note-issue-fields', note.linkedIssueId],
    queryFn: () => redmineApi.getIssue(note.linkedIssueId!),
    enabled: !!pendingRequired && !!note.linkedIssueId,
    staleTime: 5 * 60 * 1000,
  });
  const { data: editFields = [], isFetching: editFieldsLoading } = useEditFields(
    {
      issueId: note.linkedIssueId ?? null,
      projectId: linkedIssue?.project.id,
      trackerId: linkedIssue?.tracker.id,
    },
    !!pendingRequired && !!linkedIssue,
  );
  const missingFields = useMemo<EditField[]>(() => {
    if (!pendingRequired) return [];
    return editFields.filter(
      (f) =>
        f.name !== 'status_id' &&
        pendingRequired.errors.some((e) => e.toLowerCase().includes(f.label.toLowerCase())),
    );
  }, [pendingRequired, editFields]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guardam a última edição ainda não persistida, para flush ao desmontar
  const pendingTitle = useRef<string | null>(null);
  const pendingBody = useRef<string | null>(null);
  // Espelham SEMPRE o valor atual (state e prop) para o efeito de desmontagem
  // não depender da closure obsoleta do `note`/refs do primeiro render — senão
  // uma nota recém-salva era considerada vazia e auto-excluída ao trocar de nota.
  const latestTitle = useRef(note.title);
  const latestBody = useRef(note.body);
  const noteRef = useRef(note);
  latestTitle.current = title;
  latestBody.current = body;
  noteRef.current = note;
  // Momento em que o editor montou — evita que desmontagens instantâneas
  // (StrictMode em dev, reconciliação da criação otimista) auto-excluam a nota
  // recém-criada antes de o usuário ter chance de escrever.
  const mountedAt = useRef<number>(Date.now());

  // Reseta o estado local só ao trocar de nota (não a cada atualização otimista)
  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
    setTagInput('');
    setShowTagInput(false);
    setLinking(false);
    setShowColors(false);
    setSendState('idle');
    setSendError('');
    setPendingRequired(null);
    setRequiredOpen(false);
    setSaving(false);
    setClInput('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Notas relacionadas: outras notas vinculadas à mesma tarefa (backlinks)
  const related = note.linkedIssueId
    ? allNotes.filter((n) => n.id !== note.id && n.linkedIssueId === note.linkedIssueId)
    : [];

  const patch = (p: NotePatch) => updateNote.mutate({ id: note.id, patch: p });

  const save = (p: NotePatch) => {
    setSaving(true);
    updateNote.mutate({ id: note.id, patch: p }, { onSettled: () => setSaving(false) });
  };

  const onTitle = (v: string) => {
    setTitle(v);
    pendingTitle.current = v;
    setSaving(true);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      save({ title: v });
      pendingTitle.current = null;
    }, 500);
  };
  const onBody = (v: string) => {
    setBody(v);
    pendingBody.current = v;
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      save({ body: v });
      pendingBody.current = null;
    }, 600);
  };

  // Ao desmontar (troca de nota/aba): auto-exclui se vazia, senão persiste o
  // que estava no debounce (flush) para não perder as últimas edições.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      const n = noteRef.current;
      const lt = latestTitle.current;
      const lb = latestBody.current;
      const empty = !lt.trim() && !lb.trim() && n.tags.length === 0 && !n.linkedIssueId;
      // Só auto-exclui se o editor ficou aberto tempo suficiente — desmontagens
      // instantâneas não são uma saída deliberada do usuário.
      const settled = Date.now() - mountedAt.current > 1200;
      if (empty && settled) {
        onAutoDeleteEmpty(n.id);
        return;
      }
      if (empty) return;
      // Persiste edições ainda no debounce (não salvas) antes de sair.
      const flush: NotePatch = {};
      if (pendingTitle.current !== null) flush.title = pendingTitle.current;
      if (pendingBody.current !== null) flush.body = pendingBody.current;
      if (Object.keys(flush).length) updateNote.mutate({ id: n.id, patch: flush });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  const exportMarkdown = () => {
    const content = (title.trim() ? `# ${title.trim()}\n\n` : '') + body;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(noteTitle(note) || 'nota').replace(/[^\w\-]+/g, '_').slice(0, 60)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || note.tags.includes(t)) {
      setTagInput('');
      return;
    }
    patch({ tags: [...note.tags, t] });
    setTagInput('');
  };
  const removeTag = (t: string) => patch({ tags: note.tags.filter((x) => x !== t) });

  const sendAsComment = async () => {
    if (!note.linkedIssueId || !body.trim()) return;
    setSendState('sending');
    setSendError('');
    try {
      await redmineApi.addNote(note.linkedIssueId, markdownToTextile(body));
      setSendState('sent');
      setTimeout(() => setSendState('idle'), 2500);
    } catch (err: unknown) {
      // O Redmine valida a tarefa INTEIRA ao salvar um comentário: campos
      // obrigatórios vazios voltam como 422 { errors: [...] }. Mostramos a lista
      // ao usuário em vez de um genérico "Falhou" (antes só dava pra ver no DevTools).
      const data = (err as { response?: { data?: { errors?: string[]; error?: string } } })
        ?.response?.data;
      const errs = Array.isArray(data?.errors) && data.errors.length ? data.errors : null;
      const msg = errs
        ? errs.join(' · ')
        : data?.error || 'Não foi possível enviar o comentário. Tente novamente.';
      setSendError(msg);
      setSendState('error'); // permanece até o próximo envio (não some sozinho)
      // 422 com lista de campos → abre o popup para preencher e reenviar.
      if (errs) {
        setPendingRequired({ errors: errs });
        setRequiredOpen(true);
      }
    }
  };

  // Reenvia o comentário JUNTO com os campos obrigatórios preenchidos no popup
  // (um único PUT: notes + campos padrão + custom_fields).
  const submitRequired = async (values: Record<string, unknown>) => {
    if (!note.linkedIssueId) return;
    setSendState('sending');
    setSendError('');
    try {
      await redmineApi.updateIssue(note.linkedIssueId, {
        notes: markdownToTextile(body),
        ...values,
      });
      setPendingRequired(null);
      setRequiredOpen(false);
      setSendState('sent');
      setTimeout(() => setSendState('idle'), 2500);
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { errors?: string[]; error?: string } } })
        ?.response?.data;
      const errs = Array.isArray(data?.errors) && data.errors.length ? data.errors : null;
      setSendError(
        errs ? errs.join(' · ') : data?.error || 'Não foi possível enviar o comentário.',
      );
      setSendState('error');
      if (errs) {
        setPendingRequired({ errors: errs });
        setRequiredOpen(true);
      } // ainda falta algo
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Controles discretos no topo */}
      <div className="flex items-center justify-end gap-0.5 px-3 pt-2.5 pb-1">
        <span className="mr-auto pl-2 flex items-center gap-1 text-[11px] text-slate-300 dark:text-slate-600">
          {saving ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Salvando…
            </>
          ) : (
            <>
              Salvo · editado{' '}
              {formatDistanceToNow(new Date(note.updatedAt), { addSuffix: true, locale: ptBR })}
            </>
          )}
        </span>

        <button
          onClick={exportMarkdown}
          title="Exportar como .md"
          className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Download size={14} />
        </button>
        <button
          onClick={() => onDuplicate(note)}
          title="Duplicar nota"
          className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Copy size={14} />
        </button>

        {/* Cor */}
        <div className="relative">
          <button
            onClick={() => setShowColors((v) => !v)}
            title="Cor"
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Palette size={14} />
          </button>
          {showColors && (
            <div className="absolute z-30 top-full right-0 mt-1 flex items-center gap-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-2">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  title={c.key}
                  onClick={() => {
                    patch({ color: note.color === c.key ? null : c.key });
                    setShowColors(false);
                  }}
                  className={`w-4 h-4 rounded-full ${c.dot} transition-transform hover:scale-125 ${
                    note.color === c.key
                      ? 'ring-2 ring-offset-1 ring-slate-400 dark:ring-offset-slate-800'
                      : ''
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => patch({ pinned: !note.pinned })}
          title={note.pinned ? 'Desafixar' : 'Fixar'}
          className={`p-1.5 rounded-md transition-colors ${note.pinned ? 'text-amber-500' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
        >
          {note.pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>
      </div>

      {/* Documento centralizado */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto px-8 pb-16 pt-2">
          {/* Título */}
          <input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Sem título"
            className="w-full text-3xl font-bold bg-transparent focus:outline-none text-slate-800 dark:text-slate-100 placeholder-slate-300 dark:placeholder-slate-600 mb-2"
          />

          {/* Propriedades discretas: tarefa + tags */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5 text-slate-400">
            {note.linkedIssueId ? (
              <LinkedIssueChip
                id={note.linkedIssueId}
                onOpen={onIssueClick}
                onUnlink={() => patch({ linkedIssueId: null, linkedProjectId: null })}
              />
            ) : (
              <div className="relative">
                <button
                  onClick={() => setLinking((v) => !v)}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors"
                >
                  <Link2 size={12} /> Vincular tarefa
                </button>
                {linking && (
                  <IssueLinker
                    onClose={() => setLinking(false)}
                    onPick={(issue) => {
                      patch({ linkedIssueId: issue.id });
                      setLinking(false);
                      // Busca o projeto da tarefa para habilitar o filtro por projeto
                      redmineApi
                        .getIssue(issue.id)
                        .then((full) => patch({ linkedProjectId: full.project.id }))
                        .catch(() => {});
                    }}
                  />
                )}
              </div>
            )}

            {projectName && (
              <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                <Folder size={11} /> {projectName}
              </span>
            )}

            {note.tags.length > 0 && <span className="text-slate-200 dark:text-slate-700">·</span>}

            {note.tags.map((t) => (
              <span
                key={t}
                className="group/tag inline-flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400"
              >
                #{t}
                <button
                  onClick={() => removeTag(t)}
                  className="text-slate-300 hover:text-red-500 opacity-0 group-hover/tag:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {showTagInput ? (
              <input
                autoFocus
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                  if (e.key === 'Escape') {
                    setShowTagInput(false);
                    setTagInput('');
                  }
                }}
                onBlur={() => {
                  addTag();
                  setShowTagInput(false);
                }}
                placeholder="tag…"
                className="w-20 text-xs bg-transparent focus:outline-none placeholder-slate-300 border-b border-slate-200 dark:border-slate-700"
              />
            ) : (
              <button
                onClick={() => setShowTagInput(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <TagIcon size={11} /> tag
              </button>
            )}
          </div>

          {/* Corpo: documento WYSIWYG (Markdown renderizado em tempo real) */}
          <RichNoteEditor
            noteId={note.id}
            value={note.body}
            onChange={onBody}
            onIssueClick={onIssueClick}
          />

          {/* Checklist espelhada da tarefa vinculada (mesma do modal da tarefa) */}
          {note.linkedIssueId && (
            <div className="mt-8 border-t border-slate-100 dark:border-slate-700 pt-4">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                <CheckSquare size={12} /> Checklist da tarefa #{note.linkedIssueId}
              </h4>
              <div className="space-y-0.5">
                {checklist.map((it) => (
                  <label key={it.id} className="group/cl flex items-center gap-2 text-sm py-0.5">
                    <input
                      type="checkbox"
                      checked={it.done}
                      onChange={() => localChecklists.toggle(note.linkedIssueId!, it.id)}
                      className="accent-blue-600 w-4 h-4 flex-shrink-0"
                    />
                    <span
                      className={
                        it.done
                          ? 'line-through text-slate-400'
                          : 'text-slate-700 dark:text-slate-200'
                      }
                    >
                      {it.text}
                    </span>
                    <button
                      onClick={() => localChecklists.remove(note.linkedIssueId!, it.id)}
                      className="ml-auto text-slate-300 hover:text-red-500 opacity-0 group-hover/cl:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </label>
                ))}
              </div>
              <input
                value={clInput}
                onChange={(e) => setClInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && clInput.trim()) {
                    localChecklists.add(note.linkedIssueId!, clInput);
                    setClInput('');
                  }
                }}
                placeholder="+ adicionar item"
                className="mt-1 w-full text-sm bg-transparent focus:outline-none placeholder-slate-300 dark:placeholder-slate-600 py-1"
              />
            </div>
          )}

          {/* Backlinks: outras notas sobre a mesma tarefa */}
          {related.length > 0 && (
            <div className="mt-6 border-t border-slate-100 dark:border-slate-700 pt-4">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                <Link2 size={12} /> Relacionadas
              </h4>
              <div className="space-y-1">
                {related.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onSelectNote(r.id)}
                    className="w-full flex items-center gap-2 text-left text-sm text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    <StickyNote size={12} className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{noteTitle(r)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Ação contextual: enviar para a tarefa vinculada (rodapé discreto) */}
      {note.linkedIssueId && (
        <div className="flex flex-col items-end gap-1.5 px-4 py-2 border-t border-slate-100 dark:border-slate-700">
          {sendState === 'error' && sendError && (
            <div className="w-full flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-2.5 py-1.5">
              <AlertCircle size={13} className="flex-shrink-0 mt-px" />
              <span className="whitespace-pre-wrap flex-1">{sendError}</span>
              {pendingRequired && !requiredOpen && (
                <button
                  onClick={() => setRequiredOpen(true)}
                  className="flex-shrink-0 font-medium underline hover:text-red-800 dark:hover:text-red-300"
                >
                  Preencher campos
                </button>
              )}
            </div>
          )}
          <button
            onClick={sendAsComment}
            disabled={sendState === 'sending' || !body.trim()}
            title={`Adicionar o conteúdo desta nota como comentário na tarefa #${note.linkedIssueId}`}
            className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-colors disabled:opacity-40 ${
              sendState === 'sent'
                ? 'bg-green-50 text-green-600 dark:bg-green-900/20'
                : sendState === 'error'
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/20'
                  : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
            }`}
          >
            {sendState === 'sending' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : sendState === 'sent' ? (
              <Check size={13} />
            ) : (
              <Send size={13} />
            )}
            {sendState === 'sent'
              ? 'Enviado como comentário!'
              : sendState === 'error'
                ? 'Falhou ao enviar'
                : `Enviar como comentário em #${note.linkedIssueId}`}
          </button>
        </div>
      )}

      {requiredOpen && pendingRequired && (
        <RequiredFieldsModal
          statusName={`#${note.linkedIssueId}`}
          intro={
            <>
              Para enviar o comentário na tarefa{' '}
              <span className="font-medium">#{note.linkedIssueId}</span>, preencha:
            </>
          }
          submitLabel="Preencher e enviar comentário"
          fields={missingFields}
          loading={editFieldsLoading || !linkedIssue}
          saving={sendState === 'sending'}
          onCancel={() => setRequiredOpen(false)}
          onSubmit={submitRequired}
        />
      )}
    </div>
  );
}

// ─── View principal ───────────────────────────────────────────────────────────
export function NotesView({
  onIssueClick,
  seed,
  focus,
}: {
  onIssueClick?: (id: number) => void;
  seed?: { nonce: number; patch: NotePatch } | null;
  focus?: { nonce: number; issueId: number } | null;
}) {
  const { data: notes = [], isLoading } = useNotes();
  const { data: projects = [] } = useProjects();
  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeProject, setActiveProject] = useState<number | null>(null);
  const [activeIssue, setActiveIssue] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Note | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const newBtnRef = useRef<HTMLDivElement>(null);
  const consumedSeed = useRef<number>(0);
  const consumedFocus = useRef<number>(0);

  // Foco externo (vindo do modal da tarefa): filtra notas por essa tarefa
  useEffect(() => {
    if (!focus || focus.nonce === consumedFocus.current) return;
    consumedFocus.current = focus.nonce;
    setActiveIssue(focus.issueId);
    setActiveTag(null);
    setActiveProject(null);
    setPinnedOnly(false);
    setSearch('');
    const first = notes.find((n) => n.linkedIssueId === focus.issueId);
    if (first) setSelectedId(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  // Fecha o menu de templates ao clicar fora
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      if (newBtnRef.current && !newBtnRef.current.contains(e.target as Node))
        setShowTemplates(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplates]);

  const projectName = (id: number | null) => projects.find((p) => p.id === id)?.name;

  // Consome um "seed" externo (captura rápida / nova nota a partir da tarefa)
  useEffect(() => {
    if (!seed || seed.nonce === consumedSeed.current) return;
    consumedSeed.current = seed.nonce;
    const id = newNoteId();
    setSelectedId(id);
    createNote.mutate({ ...seed.patch, id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach((n) => n.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [notes]);

  // Projetos que aparecem em alguma nota (para o filtro)
  const noteProjects = useMemo(() => {
    const ids = [
      ...new Set(notes.map((n) => n.linkedProjectId).filter((id): id is number => !!id)),
    ];
    return ids.map((id) => ({ id, name: projectName(id) ?? `#${id}` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, projects]);

  const filtered = useMemo(() => {
    const q = search.trim();
    const base = notes
      .filter((n) => !pinnedOnly || n.pinned)
      .filter((n) => !activeTag || n.tags.includes(activeTag))
      .filter((n) => !activeProject || n.linkedProjectId === activeProject)
      .filter((n) => !activeIssue || n.linkedIssueId === activeIssue);

    if (!q) {
      // Sem busca: fixadas primeiro, depois mais recentes
      return base.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
    }
    // Com busca: ranking fuzzy (título pesa mais que corpo/tags)
    return base
      .map((n) => {
        const score = Math.max(
          fuzzyBest(q, noteTitle(n)),
          fuzzyBest(q, n.body) - 30,
          fuzzyBest(q, n.tags.join(' ')) - 10,
        );
        return { n, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.n);
  }, [notes, search, pinnedOnly, activeTag, activeProject, activeIssue]);

  // Mantém uma seleção válida
  useEffect(() => {
    if (selectedId && notes.some((n) => n.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, filtered.length]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const handleNew = (patch: NotePatch = {}) => {
    const id = newNoteId();
    setSelectedId(id);
    setSearch('');
    createNote.mutate({ ...patch, id });
  };

  // Nota diária: abre a de hoje se já existir, senão cria
  const openDailyNote = () => {
    const title = `Diária — ${today()}`;
    const existing = notes.find((n) => n.title === title);
    if (existing) {
      setSelectedId(existing.id);
      setSearch('');
    } else handleNew({ title, tags: ['diária'], body: TPL_DIARIA });
    setShowTemplates(false);
  };

  const handleDuplicate = (n: Note) => {
    const id = newNoteId();
    setSelectedId(id);
    createNote.mutate({
      id,
      title: n.title ? `${n.title} (cópia)` : '',
      body: n.body,
      tags: n.tags,
      color: n.color,
      linkedIssueId: n.linkedIssueId,
      linkedProjectId: n.linkedProjectId,
    });
  };

  // Auto-exclui notas vazias ao sair delas (evita acúmulo de notas em branco)
  const handleAutoDeleteEmpty = (id: string) => {
    deleteNote.mutate(id);
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    deleteNote.mutate(id);
    if (selectedId === id) setSelectedId(null);
    setPendingDelete(null);
  };

  return (
    <div className="flex h-[calc(100vh-170px)] gap-4 max-w-7xl mx-auto">
      {/* Lista */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg px-2.5 py-1.5">
              <Search size={13} className="text-slate-400 flex-shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar notas…"
                className="flex-1 text-xs bg-transparent focus:outline-none placeholder-slate-400 min-w-0"
              />
            </div>
            <div className="relative flex-shrink-0" ref={newBtnRef}>
              <button
                onClick={() => setShowTemplates((v) => !v)}
                title="Nova nota"
                className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <Plus size={15} />
              </button>
              {showTemplates && (
                <div className="absolute z-30 top-full right-0 mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden py-1">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => {
                        handleNew(t.make());
                        setShowTemplates(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                    >
                      <StickyNote size={12} className="text-slate-400 flex-shrink-0" /> {t.label}
                    </button>
                  ))}
                  <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                  <button
                    onClick={openDailyNote}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-left transition-colors"
                  >
                    <CalendarDays size={12} className="text-slate-400 flex-shrink-0" /> Nota diária
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeIssue && (
              <button
                onClick={() => setActiveIssue(null)}
                title="Remover filtro de tarefa"
                className="inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/20"
              >
                <span className="font-mono font-bold">#{activeIssue}</span> <X size={10} />
              </button>
            )}
            <button
              onClick={() => setPinnedOnly((v) => !v)}
              className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
                pinnedOnly
                  ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500'
              }`}
            >
              <Pin size={10} /> Fixadas
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                className={`text-[11px] rounded-full px-2 py-0.5 border transition-colors ${
                  activeTag === t
                    ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500'
                }`}
              >
                #{t}
              </button>
            ))}
            {noteProjects.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveProject(activeProject === p.id ? null : p.id)}
                title={p.name}
                className={`inline-flex items-center gap-1 text-[11px] rounded-full px-2 py-0.5 border transition-colors max-w-[140px] ${
                  activeProject === p.id
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-900/20'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500'
                }`}
              >
                <Folder size={10} className="flex-shrink-0" />{' '}
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {isLoading && <div className="p-4 text-xs text-slate-400">Carregando…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 px-4 text-center">
              <StickyNote size={28} className="mb-2 opacity-30" />
              <p className="text-xs">
                {notes.length === 0 ? 'Nenhuma nota ainda. Crie a primeira!' : 'Nada encontrado.'}
              </p>
            </div>
          )}
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => setSelectedId(n.id)}
              className={`w-full flex items-stretch gap-0 text-left border-b border-slate-50 dark:border-slate-800 last:border-0 transition-colors group ${
                selectedId === n.id
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <span className={`w-1 flex-shrink-0 ${stripeFor(n.color)}`} />
              <span className="flex-1 min-w-0 px-3 py-2.5">
                <span className="flex items-center gap-1.5">
                  {n.pinned && <Pin size={11} className="text-amber-500 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                    {noteTitle(n)}
                  </span>
                </span>
                <span className="block text-[11px] text-slate-400 truncate mt-0.5">
                  {n.body
                    .replace(/[#*_`>-]/g, '')
                    .trim()
                    .slice(0, 60) || 'Vazia'}
                </span>
                <span className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-slate-400">
                    {formatDistanceToNow(new Date(n.updatedAt), { addSuffix: true, locale: ptBR })}
                  </span>
                  {n.linkedIssueId && (
                    <span className="text-[10px] font-mono text-blue-500">#{n.linkedIssueId}</span>
                  )}
                  {n.tags.slice(0, 2).map((t) => (
                    <span key={t} className="text-[10px] text-slate-400">
                      #{t}
                    </span>
                  ))}
                </span>
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete(n);
                }}
                className="px-2 flex items-center text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                title="Excluir"
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            onIssueClick={onIssueClick}
            projectName={projectName(selected.linkedProjectId)}
            onDuplicate={handleDuplicate}
            onAutoDeleteEmpty={handleAutoDeleteEmpty}
            allNotes={notes}
            onSelectNote={setSelectedId}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <StickyNote size={40} className="mb-3 opacity-30" />
            <p className="text-sm">Selecione uma nota ou crie uma nova.</p>
            <button
              onClick={() => handleNew()}
              className="mt-3 inline-flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 transition-colors"
            >
              <Plus size={14} /> Nova nota
            </button>
          </div>
        )}
      </div>

      {/* Confirmação de exclusão */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3 p-5">
              <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Excluir nota
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Tem certeza que deseja excluir{' '}
                  <strong className="text-slate-700 dark:text-slate-200">
                    “{noteTitle(pendingDelete)}”
                  </strong>
                  ? Esta ação não pode ser desfeita.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                <Trash2 size={12} /> Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
