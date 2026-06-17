import { useState, useRef, useEffect, useMemo } from 'react';
import { X, ExternalLink, ChevronDown, ChevronRight, ChevronLeft, Check, Pencil, Play, GitBranch, ArrowRight, Loader2, AlertCircle, RotateCcw, FileText, File, Star, Link2, GitMerge, Copy, Plus, CheckSquare, User, Clock, Tag, Calendar, Search, CircleDot, Image as ImageIcon, Paperclip, Download, NotebookPen, StickyNote, BookOpen } from 'lucide-react';
import type { Attachment } from '../types/redmine';
import { localChecklists, useChecklist } from '../utils/localChecklists';
import { TimeTracker } from './TimeTracker';
import { IssueAIPanel } from './IssueAIPanel';
import { CommentComposer } from './CommentComposer';
import { MarkdownEditor } from './MarkdownEditor';
import { markdownToTextile } from '../utils/markdownToTextile';
import { textileToMarkdown } from '../utils/textileToMarkdown';
import { redmineApi, attachmentUrl } from '../api/redmine';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useIssueDetail, useAddNote, useStatuses, useUpdateIssue, useProjectMembers, useCurrentUser, useUpdateJournal } from '../hooks/useRedmine';
import { useNotes } from '../hooks/useNotes';
import { talkBridge } from '../utils/talkBridge';
import { localWatches, useLocalWatches } from '../utils/localWatches';
import { wikiLinks, type WikiLink } from '../utils/wikiLinks';
import { WikiLinkSearch } from './WikiView';
import { Markdown } from './Markdown';
import { getMissingFields } from '../utils/alerts';

function isClosedName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('fechad') || n.includes('cancelad');
}

// Quando a tarefa entrou no status atual (última mudança de status nos journals,
// ou a criação se nunca mudou). Usado para "há X dias nesta etapa".
function statusEnteredAt(issue: { journals?: { created_on: string; details?: { property: string; name: string }[] }[]; created_on?: string }): Date | null {
  const changes = (issue.journals ?? []).filter(j =>
    j.details?.some(d => d.property === 'attr' && d.name === 'status_id'));
  const last = changes[changes.length - 1];
  if (last) return new Date(last.created_on);
  return issue.created_on ? new Date(issue.created_on) : null;
}

// Quantas vezes a tarefa foi para Pendente Correção (34) — "ping-pong" de revisão.
function countRejections(issue: { journals?: { details?: { property: string; name: string; new_value: string | null }[] }[] }): number {
  return (issue.journals ?? []).filter(j =>
    j.details?.some(d => d.property === 'attr' && d.name === 'status_id' && d.new_value === '34')).length;
}

type PendingNote = { id: string; text: string; status: 'pending' | 'error'; files?: File[] };
type SavingField = { key: string; label: string; status: 'saving' | 'error' };

const IMPACTO_OPTIONS = [
  'JAVA','B2CLICK','B2CLICKPAF','ROTEADORPDV','AUTOMACAO','B2CLICKPOS','B2CLICKPAY',
  'JAVA+B2CLICK','JAVA+B2CLICKPAF','JAVA+B2CLICKPAY','B2CLICK+B2CLICKPAF','B2CLICK+B2CLICKPAY',
  'B2CLICKPAF+ROTEADORPDV','B2CLICKPAF+AUTOMACAO','B2CLICKPAF+B2CLICKPOS','B2CLICKPAF+B2CLICKPAY',
  'ROTEADORPDV+AUTOMACAO','ROTEADORPDV+B2CLICKPOS','AUTOMACAO+B2CLICKPOS','B2CLICKPOS+B2CLICKPAY',
  'JAVA+B2CLICK+B2CLICKPAF','JAVA+B2CLICK+B2CLICKPAY','JAVA+B2CLICKPAF+ROTEADORPDV',
  'JAVA+B2CLICKPAF+AUTOMACAO','JAVA+B2CLICKPAF+B2CLICKPOS','JAVA+B2CLICKPAF+B2CLICKPAY',
  'B2CLICK+B2CLICKPAF+ROTEADORPDV','B2CLICK+B2CLICKPAF+B2CLICKPOS','B2CLICK+B2CLICKPAF+B2CLICKPAY',
  'B2CLICK+B2CLICKPOS+B2CLICKPAY','B2CLICKPAF+ROTEADORPDV+AUTOMACAO','B2CLICKPAF+ROTEADORPDV+B2CLICKPOS',
  'B2CLICKPAF+ROTEADORPDV+B2CLICKPAY','B2CLICKPAF+AUTOMACAO+B2CLICKPOS','B2CLICKPAF+AUTOMACAO+B2CLICKPAY',
  'B2CLICKPAF+B2CLICKPOS+B2CLICKPAY','ROTEADORPDV+AUTOMACAO+B2CLICKPOS','ROTEADORPDV+B2CLICKPOS+B2CLICKPAY',
  'JAVA+B2CLICK+B2CLICKPAF+ROTEADORPDV','JAVA+B2CLICK+B2CLICKPAF+B2CLICKPOS','JAVA+B2CLICK+B2CLICKPAF+B2CLICKPAY',
  'JAVA+B2CLICK+ROTEADORPDV+B2CLICKPOS','JAVA+B2CLICK+ROTEADORPDV+B2CLICKPAY','JAVA+B2CLICK+B2CLICKPOS+B2CLICKPAY',
  'JAVA+B2CLICKPAF+ROTEADORPDV+AUTOMACAO','JAVA+B2CLICKPAF+ROTEADORPDV+B2CLICKPOS','JAVA+B2CLICKPAF+ROTEADORPDV+B2CLICKPAY',
  'JAVA+B2CLICKPAF+B2CLICKPOS+B2CLICKPAY','JAVA+ROTEADORPDV+AUTOMACAO+B2CLICKPOS','JAVA+ROTEADORPDV+AUTOMACAO+B2CLICKPAY',
  'JAVA+ROTEADORPDV+B2CLICKPOS+B2CLICKPAY','JAVA+AUTOMACAO+B2CLICKPOS+B2CLICKPAY',
  'B2CLICK+B2CLICKPAF+ROTEADORPDV+AUTOMACAO','B2CLICK+B2CLICKPAF+ROTEADORPDV+B2CLICKPOS',
  'B2CLICK+B2CLICKPAF+ROTEADORPDV+B2CLICKPAY','B2CLICK+B2CLICKPAF+AUTOMACAO+B2CLICKPOS',
  'B2CLICK+B2CLICKPAF+AUTOMACAO+B2CLICKPAY','B2CLICK+B2CLICKPAF+B2CLICKPOS+B2CLICKPAY',
  'B2CLICK+ROTEADORPDV+AUTOMACAO+B2CLICKPOS','B2CLICK+ROTEADORPDV+AUTOMACAO+B2CLICKPAY',
  'B2CLICK+ROTEADORPDV+B2CLICKPOS+B2CLICKPAY','B2CLICK+AUTOMACAO+B2CLICKPOS+B2CLICKPAY',
  'B2CLICKPAF+ROTEADORPDV+AUTOMACAO+B2CLICKPOS','B2CLICKPAF+ROTEADORPDV+AUTOMACAO+B2CLICKPAY',
  'B2CLICKPAF+ROTEADORPDV+B2CLICKPOS+B2CLICKPAY','B2CLICKPAF+AUTOMACAO+B2CLICKPOS+B2CLICKPAY',
  'ROTEADORPDV+AUTOMACAO+B2CLICKPOS+B2CLICKPAY',
];

// IDs dos campos customizados relevantes
const CF = {
  BRANCH: 140,
  IMPACTO: 229,
  NOTA_VERSAO: 213,
  PREVISAO_REVISAO: 228,
  REVISOR: 210,
  DEV_DEVELOPER: 141,
} as const;

interface Props {
  issueId: number;
  onClose: () => void;
  onNavigate?: (id: number) => void;
  /** Cria uma nova nota pré-vinculada a esta tarefa e abre o módulo de Notas */
  onNewNote?: (patch: { title?: string; linkedIssueId?: number; linkedProjectId?: number }) => void;
  /** Abre o módulo de Notas filtrado por esta tarefa */
  onViewNotes?: (issueId: number) => void;
}

/* Tamanho de arquivo legível */
function fmtSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const attUrl = (a: Attachment) => attachmentUrl(a.id, a.filename);

/* Anexos da própria tarefa: imagens como miniatura, demais como chips */
function TaskAttachments({ attachments }: { attachments: Attachment[] }) {
  if (attachments.length === 0) return null;
  const images = attachments.filter(a => a.content_type?.startsWith('image/'));
  const files = attachments.filter(a => !a.content_type?.startsWith('image/'));
  return (
    <div className="mt-3 pt-3 border-t border-slate-100">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
        <Paperclip size={12} /> Anexos da tarefa ({attachments.length})
      </div>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map(a => (
            <a key={a.id} href={attUrl(a)} target="_blank" rel="noopener noreferrer" title={a.filename}>
              <img src={attUrl(a)} alt={a.filename} className="rounded-lg border border-slate-200 w-32 h-[88px] object-cover hover:border-blue-300 transition-colors" />
            </a>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {files.map(a => (
          <a
            key={a.id}
            href={attUrl(a)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 hover:border-blue-300"
          >
            <File size={15} className="text-slate-400" />
            <span className="max-w-48 truncate">{a.filename}</span>
            {a.filesize ? <span className="text-slate-400">{fmtSize(a.filesize)}</span> : null}
            <Download size={13} className="text-slate-400" />
          </a>
        ))}
      </div>
    </div>
  );
}

/* Visualizador de imagens em tela cheia, com navegação ◀ ▶ */
function Lightbox({ images, index, onClose }: { images: string[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') setI(v => (v - 1 + images.length) % images.length);
      else if (e.key === 'ArrowRight') setI(v => (v + 1) % images.length);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [images.length, onClose]);
  if (images.length === 0) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white"><X size={24} /></button>
      {images.length > 1 && (
        <button onClick={e => { e.stopPropagation(); setI(v => (v - 1 + images.length) % images.length); }}
          className="absolute left-3 text-white/60 hover:text-white p-2"><ChevronLeft size={30} /></button>
      )}
      <img src={images[i]} className="max-h-[88vh] max-w-[88vw] object-contain rounded shadow-2xl" onClick={e => e.stopPropagation()} />
      {images.length > 1 && (
        <button onClick={e => { e.stopPropagation(); setI(v => (v + 1) % images.length); }}
          className="absolute right-3 text-white/60 hover:text-white p-2"><ChevronRight size={30} /></button>
      )}
      {images.length > 1 && (
        <div className="absolute bottom-4 text-white/60 text-sm">{i + 1} / {images.length}</div>
      )}
    </div>
  );
}

/* Descrição colapsável + anexos da tarefa (topo do painel de chat) */
function DescriptionPanel({ description, attachments, open, onToggle, onEdit }: {
  description?: string; attachments: Attachment[]; open: boolean; onToggle: () => void;
  onEdit?: () => void;
}) {
  if (!description && attachments.length === 0) return null;
  const imgCount = attachments.filter(a => a.content_type?.startsWith('image/')).length;
  const fileCount = attachments.length - imgCount;
  return (
    <div className="border-b border-slate-100 bg-slate-50/40 group">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors">
        <ChevronRight size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileText size={13} /> Descrição
        {attachments.length > 0 && (
          <span className="ml-auto flex items-center gap-2.5 text-slate-400">
            {imgCount > 0 && <span className="flex items-center gap-1"><ImageIcon size={12} />{imgCount}</span>}
            {fileCount > 0 && <span className="flex items-center gap-1"><Paperclip size={12} />{fileCount}</span>}
          </span>
        )}
        {onEdit && (
          <span
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="ml-2 p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            title="Editar descrição"
          >
            <Pencil size={11} />
          </span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-3">
          {description && (
            <div className="bg-white rounded-lg p-3 border border-slate-100 group">
              <Markdown text={description} attachments={attachments} textile />
            </div>
          )}
          <TaskAttachments attachments={attachments} />
        </div>
      )}
    </div>
  );
}

/* ── Componentes de campo inline ── */

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-400 mb-0.5 uppercase tracking-wide font-medium">{children}</p>;
}

/* Cabeçalho de grupo de campos (Geral / Desenvolvimento) */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-5 pt-3 pb-1">
      {children}
    </p>
  );
}

/* Linha de campo: ícone + rótulo (largura fixa) + controle editável */
function FieldRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 px-5 py-2">
      <span className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</span>
      <span className="text-xs font-medium text-slate-500 w-32 flex-shrink-0 mt-0.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function StatusField({ currentId, currentName, statuses, allowedIds, onChange, bare }: {
  currentId: number; currentName: string;
  statuses: { id: number; name: string }[];
  allowedIds?: number[];
  onChange: (id: number) => void;
  bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasRestrictions = allowedIds !== undefined;
  const noTransitions = hasRestrictions && allowedIds.length === 0;

  return (
    <div className="relative">
      {!bare && <FieldLabel>Situação</FieldLabel>}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-sm font-medium text-slate-800 hover:text-blue-600 transition-colors"
      >
        {currentName} <ChevronDown size={12} className="text-slate-400" />
      </button>
      {noTransitions && (
        <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
          <span>⚠</span> Sem transições permitidas no workflow
        </p>
      )}
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 min-w-52 py-1 max-h-60 overflow-y-auto scrollbar-thin">
            {noTransitions && (
              <p className="px-3 py-2 text-xs text-amber-600 border-b border-slate-100">
                Workflow não permite transições para este tracker/perfil.
              </p>
            )}
            {statuses.map(s => {
              const isAllowed = !hasRestrictions || allowedIds.includes(s.id) || s.id === currentId;
              return (
                <button
                  key={s.id}
                  onClick={() => { if (isAllowed) { onChange(s.id); setOpen(false); } }}
                  title={!isAllowed ? 'Não permitido pelo workflow do Redmine' : undefined}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm transition-colors
                    ${s.id === currentId ? 'font-semibold text-blue-600 bg-blue-50' : ''}
                    ${isAllowed && s.id !== currentId ? 'hover:bg-blue-50 text-slate-700' : ''}
                    ${!isAllowed ? 'text-slate-300 cursor-not-allowed' : ''}
                  `}
                >
                  <span>{s.name}</span>
                  <span className="flex items-center gap-1">
                    {s.id === currentId && <Check size={12} />}
                    {!isAllowed && <span className="text-slate-300 text-xs">🔒</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TextField({ label, value, onSave, multiline, bare }: {
  label: string; value: string; onSave: (v: string) => void; multiline?: boolean; bare?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => { if (draft !== value) onSave(draft); setEditing(false); };

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e: React.ChangeEvent<any>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        if (!multiline && e.key === 'Enter') commit();
      },
      className: 'w-full text-sm text-slate-800 border border-blue-400 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none bg-white',
    };
    return (
      <div>
        {!bare && <FieldLabel>{label}</FieldLabel>}
        {multiline
          ? <textarea {...shared} rows={3} />
          : <input {...shared} />}
      </div>
    );
  }

  return (
    <div>
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className="group flex items-start gap-1 text-left w-full"
      >
        <span className={`text-sm font-medium ${value ? 'text-slate-800' : 'text-slate-300 italic'} group-hover:text-blue-600 transition-colors leading-snug`}>
          {value || '—'}
        </span>
        <Pencil size={11} className="text-slate-300 group-hover:text-blue-400 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    </div>
  );
}

/* ── Campo Branch com copiar / git checkout / sugerir ── */
function slugify(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
}
function makeBranchName(id: number, firstName: string | undefined, subject: string): string {
  const num = String(id).padStart(6, '0');
  const user = (slugify(firstName || '').split('-')[0]) || 'dev';
  return `#${num}-MAS-${user}-${slugify(subject)}`;
}

function BranchField({ value, onSave, issueId, userFirstName, subject, bare }: {
  value: string; onSave: (v: string) => void; issueId: number; userFirstName?: string; subject: string; bare?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [copied, setCopied] = useState<'' | 'branch' | 'cmd'>('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);

  const commit = () => { if (draft !== value) onSave(draft); setEditing(false); };
  const copy = (text: string, which: 'branch' | 'cmd') => {
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(''), 1500);
  };

  if (editing) {
    return (
      <div>
        {!bare && <FieldLabel>Branch</FieldLabel>}
        <input
          ref={ref} value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
            if (e.key === 'Enter') commit();
          }}
          className="w-full text-sm font-mono text-slate-800 border border-blue-400 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
        />
      </div>
    );
  }

  return (
    <div>
      {!bare && <FieldLabel>Branch</FieldLabel>}
      {value ? (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setDraft(value); setEditing(true); }}
            className="group flex items-center gap-1 min-w-0"
            title="Editar"
          >
            <span className="text-sm font-medium font-mono text-slate-800 group-hover:text-blue-600 truncate">{value}</span>
            <Pencil size={11} className="text-slate-300 group-hover:text-blue-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={() => copy(value, 'branch')}
              title="Copiar nome da branch"
              className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
            >
              {copied === 'branch' ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
            </button>
            <button
              onClick={() => copy(`git checkout ${value}`, 'cmd')}
              title="Copiar 'git checkout'"
              className="px-1 py-0.5 rounded text-[10px] font-mono font-semibold text-slate-400 hover:text-blue-600 hover:bg-blue-50"
            >
              {copied === 'cmd' ? <Check size={12} className="text-green-600" /> : 'git'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setDraft(''); setEditing(true); }}
            className="text-sm text-slate-300 italic hover:text-blue-600"
          >
            —
          </button>
          <button
            onClick={() => onSave(makeBranchName(issueId, userFirstName, subject))}
            title={`Sugerir: ${makeBranchName(issueId, userFirstName, subject)}`}
            className="text-[11px] text-blue-600 hover:bg-blue-50 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
          >
            <GitBranch size={11} /> sugerir
          </button>
        </div>
      )}
    </div>
  );
}

function SelectField({ label, value, options, onSave, bare }: {
  label: string; value: string; options: string[]; onSave: (v: string) => void; bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative">
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <button
        onClick={() => { setSearch(''); setOpen(v => !v); }}
        className="flex items-center gap-1 text-sm font-medium text-slate-800 hover:text-blue-600 transition-colors"
      >
        <span className={value ? '' : 'text-slate-300 italic'}>{value || '—'}</span>
        <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-64 flex flex-col" style={{ maxHeight: 240 }}>
            <div className="p-2 border-b border-slate-100">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filtrar..."
                className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="overflow-y-auto scrollbar-thin py-1">
              <button
                onClick={() => { onSave(''); setOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
              >
                — Nenhum
              </button>
              {filtered.map(o => (
                <button
                  key={o}
                  onClick={() => { onSave(o); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${o === value ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                >
                  {o} {o === value && <Check size={12} />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">Nenhum resultado</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HoursField({ label, value, required, onSave, bare }: {
  label: string; value: number | null; required?: boolean; onSave: (v: number | null) => void; bare?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : '');

  const commit = () => {
    const num = parseFloat(draft);
    onSave(isNaN(num) || draft.trim() === '' ? null : num);
    setEditing(false);
  };

  if (editing) {
    return (
      <div>
        {!bare && <FieldLabel>{label}</FieldLabel>}
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            type="number"
            min="0"
            step="0.5"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="w-20 text-sm border border-blue-400 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            placeholder="0"
          />
          <span className="text-xs text-slate-500">horas</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!bare && (
        <FieldLabel>
          {label}
          {required && <span className="text-red-400 ml-1">*</span>}
        </FieldLabel>
      )}
      <button
        onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true); }}
        className={`group flex items-center gap-1.5 text-sm font-medium transition-colors ${
          required ? 'text-red-500 hover:text-red-600' : 'text-slate-800 hover:text-blue-600'
        }`}
      >
        {value != null ? `${value}h` : <span className="italic text-slate-300">Não preenchido</span>}
        <Pencil size={11} className="opacity-0 group-hover:opacity-100 text-slate-400 transition-opacity" />
      </button>
    </div>
  );
}

function DateField({ label, value, onSave, bare }: { label: string; value: string; onSave: (v: string) => void; bare?: boolean }) {
  return (
    <div>
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <input
        type="date"
        key={value}
        defaultValue={value}
        onBlur={e => { if (e.target.value !== value) onSave(e.target.value); }}
        onChange={e => { if (e.target.value.length === 10) onSave(e.target.value); }}
        className="text-sm font-medium text-slate-800 border border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1.5 py-0.5 cursor-pointer transition-colors"
      />
    </div>
  );
}

// Ordem de exibição das equipes no dropdown
const TEAM_ORDER = ['Desenvolvimento', 'Suporte', 'Redes & Infra', 'Implantação', 'Projetos', 'Comercial', 'Customer Success', 'Contratos', 'Outros'];

function UserField({ label, value, users, onSave, fallbackName, bare }: {
  label: string; value: string; users: { id: number; name: string; team?: string }[]; onSave: (id: string) => void; fallbackName?: string; bare?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const currentUser = users.find(u => String(u.id) === String(value));
  const displayName = currentUser?.name ?? fallbackName ?? (value ? `#${value}` : '—');
  const filtered = users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()));

  // Agrupa por equipe
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, u) => {
    const team = u.team || 'Outros';
    (acc[team] ??= []).push(u);
    return acc;
  }, {});
  const teams = Object.keys(grouped).sort((a, b) => {
    const ia = TEAM_ORDER.indexOf(a), ib = TEAM_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <div className="relative">
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <button
        onClick={() => { setSearch(''); setOpen(v => !v); }}
        className="flex items-center gap-1 text-sm font-medium text-slate-800 hover:text-blue-600 transition-colors"
      >
        {displayName} <ChevronDown size={12} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setSearch(''); }} />
          <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 w-60 flex flex-col" style={{ maxHeight: 300 }}>
            <div className="p-2 border-b border-slate-100 flex-shrink-0">
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="overflow-y-auto scrollbar-thin py-1">
              <button
                onClick={() => { onSave(''); setOpen(false); setSearch(''); }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-50"
              >
                — Nenhum
              </button>
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-400">Nenhum resultado</p>
              )}
              {teams.map(team => (
                <div key={team}>
                  <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50/70 sticky top-0">
                    {team} <span className="text-slate-300">({grouped[team].length})</span>
                  </p>
                  {grouped[team].map(u => (
                    <button
                      key={u.id}
                      onClick={() => { onSave(String(u.id)); setOpen(false); setSearch(''); }}
                      className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${String(u.id) === String(value) ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                    >
                      {u.name} {String(u.id) === String(value) && <Check size={12} />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── CTA: Começar Desenvolvimento ── */
function StartDevCTA({ currentBranch, onConfirm }: {
  currentBranch: string;
  onConfirm: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState(currentBranch);

  if (!open) {
    return (
      <button
        onClick={() => { setBranch(currentBranch); setOpen(true); }}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <Play size={14} className="fill-white" />
        Começar Desenvolvimento
      </button>
    );
  }

  return (
    <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-2">
      <p className="text-xs font-semibold text-green-800 flex items-center gap-1.5">
        <GitBranch size={13} /> Branch para desenvolvimento:
      </p>
      <input
        autoFocus
        type="text"
        value={branch}
        onChange={e => setBranch(e.target.value)}
        placeholder="ex: #090604-feature-nome"
        className="w-full text-sm border border-green-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 bg-white"
        onKeyDown={e => {
          if (e.key === 'Enter' && branch.trim()) { onConfirm(branch.trim()); setOpen(false); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancelar</button>
        <button
          onClick={() => { if (branch.trim()) { onConfirm(branch.trim()); setOpen(false); } }}
          disabled={!branch.trim()}
          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded-md font-medium transition-colors"
        >
          Confirmar → Em Andamento
        </button>
      </div>
    </div>
  );
}

/* ── CTA: Enviar para Revisão ── */
function SendToReviewCTA({ currentRevisor, currentDate, members, onConfirm }: {
  currentRevisor: string;
  currentDate: string;
  members: { id: number; name: string }[];
  onConfirm: (revisorId: string, date: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revisor, setRevisor] = useState(currentRevisor);
  const [date, setDate] = useState(currentDate || new Date().toISOString().split('T')[0]);

  if (!open) {
    return (
      <button
        onClick={() => { setRevisor(currentRevisor); setOpen(true); }}
        className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg transition-colors"
      >
        <ArrowRight size={14} />
        Enviar para Revisão
      </button>
    );
  }

  return (
    <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-3">
      <p className="text-xs font-semibold text-purple-800">Confirme antes de enviar:</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-purple-700 font-medium block mb-1">Revisor *</label>
          <select
            value={revisor}
            onChange={e => setRevisor(e.target.value)}
            className="w-full text-sm border border-purple-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
          >
            <option value="">Selecionar...</option>
            {members.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-purple-700 font-medium block mb-1">Previsão de Envio *</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full text-sm border border-purple-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancelar</button>
        <button
          onClick={() => { if (revisor && date) { onConfirm(revisor, date); setOpen(false); } }}
          disabled={!revisor || !date}
          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1 rounded-md font-medium transition-colors"
        >
          Confirmar → Pendente Revisão
        </button>
      </div>
    </div>
  );
}

/* ── CTA: Decisão de revisão (Aprovar / Reprovar) ── */
function ReviewDecisionCTA({ developerId, integratorName, members, canApprove, canReject, onApprove, onReject }: {
  developerId: string;
  integratorName?: string;
  members: { id: number; name: string }[];
  canApprove: boolean;
  canReject: boolean;
  onApprove: (note: string) => void;
  onReject: (assigneeId: string, note: string) => void;
}) {
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  const [assignee, setAssignee] = useState(developerId);
  const [note, setNote] = useState('');

  if (mode === 'approve') {
    return (
      <div className="border border-green-200 bg-green-50 rounded-lg p-3 space-y-3">
        <p className="text-xs font-semibold text-green-800">
          Aprovar e enviar para integração{integratorName ? ` · ${integratorName}` : ''}:
        </p>
        <div>
          <label className="text-xs text-green-700 font-medium block mb-1">Mensagem para o integrador *</label>
          <textarea
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="Ex: Revisado, pode integrar."
            className="w-full text-sm border border-green-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-400 bg-white resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setMode(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancelar</button>
          <button
            onClick={() => { if (note.trim()) onApprove(note.trim()); }}
            disabled={!note.trim()}
            className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded-md font-medium transition-colors"
          >
            Confirmar → Pendente Integração
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'reject') {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 space-y-3">
        <p className="text-xs font-semibold text-amber-800">Reprovar e devolver para correção:</p>
        <div>
          <label className="text-xs text-amber-700 font-medium block mb-1">Devolver para *</label>
          <select
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            className="w-full text-sm border border-amber-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          >
            <option value="">Selecionar...</option>
            {members.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-amber-700 font-medium block mb-1">Motivo (vira comentário)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={2}
            placeholder="O que precisa ser corrigido?"
            className="w-full text-sm border border-amber-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white resize-none"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setMode(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1">Cancelar</button>
          <button
            onClick={() => { if (assignee) onReject(assignee, note); }}
            disabled={!assignee}
            className="text-xs bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-3 py-1 rounded-md font-medium transition-colors"
          >
            Confirmar → Pendente Correção
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {canApprove && (
        <button
          onClick={() => { setNote('Revisado'); setMode('approve'); }}
          className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          <Check size={14} />
          Aprovar → Pendente Integração
        </button>
      )}
      {canReject && (
        <button
          onClick={() => { setAssignee(developerId); setNote(''); setMode('reject'); }}
          className="flex-1 flex items-center justify-center gap-2 py-2 px-4 bg-white border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-semibold rounded-lg transition-colors"
        >
          <RotateCcw size={14} />
          Reprovar
        </button>
      )}
    </div>
  );
}

/* ── Checklist de revisão (template fixo, marcação local por tarefa) ── */
const REVIEW_ITEMS = [
  'Branch confere com a tarefa',
  'Testado localmente',
  'Nota de versão preenchida',
  'Sem código de debug / comentado',
  'Impacto correto',
];
function ReviewChecklist({ issueId }: { issueId: number }) {
  const key = `rk_reviewcheck_${issueId}`;
  const [checked, setChecked] = useState<number[]>(() => {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(checked)); } catch { /* quota */ } }, [key, checked]);
  const toggle = (i: number) => setChecked(c => (c.includes(i) ? c.filter(x => x !== i) : [...c, i]));

  return (
    <div className="border border-slate-200 rounded-lg p-3 mb-2 bg-white">
      <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
        <CheckSquare size={13} /> Checklist de revisão
        <span className="text-slate-400 font-normal">{checked.length}/{REVIEW_ITEMS.length}</span>
        <span className="ml-auto text-[10px] text-slate-300">local</span>
      </p>
      <div className="space-y-1">
        {REVIEW_ITEMS.map((item, i) => (
          <button key={i} type="button" onClick={() => toggle(i)} className="w-full flex items-center gap-2 text-sm text-left">
            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked.includes(i) ? 'bg-blue-600 border-blue-600' : 'border-slate-300'}`}>
              {checked.includes(i) && <Check size={11} className="text-white" />}
            </span>
            <span className={checked.includes(i) ? 'text-slate-400 line-through' : 'text-slate-700'}>{item}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Checklist local por tarefa ── */
function ChecklistSection({ issueId }: { issueId: number }) {
  const items = useChecklist(issueId);
  const [text, setText] = useState('');
  const done = items.filter(i => i.done).length;

  const add = () => { localChecklists.add(issueId, text); setText(''); };

  return (
    <div className="px-5 py-3 border-b border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <CheckSquare size={13} /> Checklist
          {items.length > 0 && <span className="text-slate-400">{done}/{items.length}</span>}
        </span>
        <span className="text-[10px] text-slate-300" title="Salvo só neste navegador, não vai para o Redmine">local</span>
      </div>

      {items.length > 0 && (
        <div className="space-y-1 mb-2">
          {items.map(item => (
            <div key={item.id} className="group flex items-center gap-2">
              <button
                onClick={() => localChecklists.toggle(issueId, item.id)}
                className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                  item.done ? 'bg-blue-600 border-blue-600' : 'border-slate-300 hover:border-blue-400'
                }`}
              >
                {item.done && <Check size={11} className="text-white" />}
              </button>
              <span className={`text-sm flex-1 ${item.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.text}</span>
              <button
                onClick={() => localChecklists.remove(issueId, item.id)}
                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                title="Remover"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
          placeholder="Adicionar item…"
          className="flex-1 text-sm border border-slate-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <button
          onClick={add}
          disabled={!text.trim()}
          className="p-1.5 rounded-md bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-600 disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── Tarefas relacionadas e subtarefas ── */
const RELATION_LABELS: Record<string, string> = {
  relates: 'Relacionada a',
  duplicates: 'Duplica',
  duplicated: 'Duplicada por',
  blocks: 'Bloqueia',
  blocked: 'Bloqueada por',
  precedes: 'Precede',
  follows: 'Sucede',
  copied_to: 'Copiada para',
  copied_from: 'Copiada de',
};

function RelatedIssues({ issue, onNavigate }: {
  issue: { id: number; parent?: { id: number }; children?: { id: number; subject: string }[]; relations?: { issue_id: number; issue_to_id: number; relation_type: string }[] };
  onNavigate?: (id: number) => void;
}) {
  const hasParent = !!issue.parent;
  const children = issue.children ?? [];
  const relations = issue.relations ?? [];

  if (!hasParent && children.length === 0 && relations.length === 0) return null;

  const Row = ({ id, label, text }: { id: number; label: string; text?: string }) => (
    <button
      onClick={() => onNavigate?.(id)}
      disabled={!onNavigate}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-blue-50 transition-colors text-left group disabled:cursor-default"
    >
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wide w-24 flex-shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-400 flex-shrink-0">#{id}</span>
      {text && <span className="text-xs text-slate-700 group-hover:text-blue-600 truncate flex-1">{text}</span>}
    </button>
  );

  return (
    <div className="px-5 py-3 border-b border-slate-100">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <Link2 size={12} /> Relacionadas
      </p>
      <div className="space-y-0.5">
        {hasParent && <Row id={issue.parent!.id} label="Tarefa pai" />}
        {children.map(c => (
          <div key={c.id} className="flex items-center gap-1">
            <GitMerge size={11} className="text-slate-300 ml-1 flex-shrink-0" />
            <Row id={c.id} label="Subtarefa" text={c.subject} />
          </div>
        ))}
        {relations.map((r, idx) => {
          const otherId = r.issue_to_id === issue.id ? r.issue_id : r.issue_to_id;
          return <Row key={idx} id={otherId} label={RELATION_LABELS[r.relation_type] ?? r.relation_type} />;
        })}
      </div>
    </div>
  );
}

/* ── Seção de links da Wiki ── */

function WikiLinksSection({ issueId }: { issueId: number }) {
  const [links, setLinks] = useState<WikiLink[]>(() => wikiLinks.get(issueId));
  const [showSearch, setShowSearch] = useState(false);

  function handleSelect(id: string, title: string, namespace: string) {
    wikiLinks.add(issueId, { id, title, namespace });
    setLinks(wikiLinks.get(issueId));
    setShowSearch(false);
  }

  function handleRemove(linkId: string) {
    wikiLinks.remove(issueId, linkId);
    setLinks(wikiLinks.get(issueId));
  }

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
          <BookOpen size={12} />
          Wiki
        </p>
        <button
          onClick={() => setShowSearch(true)}
          className="text-xs text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-0.5 transition-colors"
        >
          <Plus size={11} /> Vincular
        </button>
      </div>

      {links.length === 0 && (
        <p className="text-xs text-slate-400 italic">Nenhuma página vinculada.</p>
      )}

      <div className="space-y-1">
        {links.map(link => (
          <div key={link.id} className="flex items-center gap-2 group">
            <FileText size={11} className="text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-600 dark:text-slate-300 flex-1 truncate">
              {link.title || link.id}
              {link.namespace && (
                <span className="text-slate-400 ml-1">({link.namespace.replace(/:/g, ' / ')})</span>
              )}
            </span>
            <a
              href={`https://wiki.redesoft.com.br/doku.php?id=${encodeURIComponent(link.id)}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 hover:text-blue-500 flex-shrink-0 transition-colors"
              title="Abrir no DokuWiki"
            >
              <ExternalLink size={11} />
            </a>
            <button
              onClick={() => handleRemove(link.id)}
              className="text-slate-300 hover:text-red-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
              title="Desvincular"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      {showSearch && (
        <WikiLinkSearch
          onSelect={handleSelect}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

/* ── Modal principal ── */

export function IssueModal({ issueId, onClose, onNavigate, onNewNote, onViewNotes }: Props) {
  const { data: issue, isLoading } = useIssueDetail(issueId);
  const { data: statuses } = useStatuses();
  const { data: members } = useProjectMembers(issue?.project.id);
  const { data: currentUser } = useCurrentUser();
  const { data: allNotes = [] } = useNotes();
  const linkedNotesCount = allNotes.filter(n => n.linkedIssueId === issueId).length;
  const addNote = useAddNote();
  const updateJournal = useUpdateJournal(issueId);
  const [editingJournal, setEditingJournal] = useState<{ id: number; text: string } | null>(null);
  const [editingDescription, setEditingDescription] = useState<string | null>(null);
  const updateIssue = useUpdateIssue();
  const watchedIds = useLocalWatches();
  const [pendingNotes, setPendingNotes] = useState<PendingNote[]>([]);
  const [savingFields, setSavingFields] = useState<SavingField[]>([]);
  const [showDescription, setShowDescription] = useState(false);
  const [phaseView, setPhaseView] = useState(() => localStorage.getItem('rk_phase_view') === '1');
  const [aiDraftNote, setAiDraftNote] = useState<string | undefined>(undefined);
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null);

  // Clique em qualquer imagem do modal abre o lightbox (navegando entre todas)
  const onModalClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      const imgs = Array.from(e.currentTarget.querySelectorAll('img'))
        .map(im => (im as HTMLImageElement).src)
        .filter(Boolean);
      const idx = imgs.indexOf((target as HTMLImageElement).src);
      setLightbox({ images: imgs, index: idx < 0 ? 0 : idx });
    }
  };

  // Esc fecha o modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const sendNote = async (text: string, files: File[] = []) => {
    const id = Date.now().toString();
    setPendingNotes(prev => [...prev, { id, text, status: 'pending', files }]);
    try {
      const uploads = [];
      for (const f of files) uploads.push(await redmineApi.uploadFile(f));
      const notes = markdownToTextile(text);
      await addNote.mutateAsync({ id: issueId, notes, uploads });
      setPendingNotes(prev => prev.filter(n => n.id !== id));
      // Compartilha arquivos na sala Talk ativa (se houver)
      if (files.length > 0 && talkBridge.hasReceiver()) {
        for (const f of files) talkBridge.shareFile(f).catch(() => {});
      }
    } catch {
      setPendingNotes(prev => prev.map(n => n.id === id ? { ...n, status: 'error' } : n));
    }
  };

  const retryNote = (pending: PendingNote) => {
    setPendingNotes(prev => prev.filter(n => n.id !== pending.id));
    sendNote(pending.text, pending.files);
  };

  const dismissNote = (id: string) =>
    setPendingNotes(prev => prev.filter(n => n.id !== id));

  const trackField = (key: string, label: string, fields: Record<string, unknown>) => {
    setSavingFields(prev => [...prev.filter(f => f.key !== key), { key, label, status: 'saving' }]);
    updateIssue.mutate({ id: issueId, fields }, {
      onSuccess: () => setSavingFields(prev => prev.filter(f => f.key !== key)),
      onError: () => {
        setSavingFields(prev => prev.map(f => f.key === key ? { ...f, status: 'error' } : f));
        setTimeout(() => setSavingFields(prev => prev.filter(f => f.key !== key)), 4000);
      }
    });
  };

  const updateField = (fields: Record<string, unknown>) => {
    const label = fields.status_id ? 'Status' : Object.keys(fields)[0];
    trackField(label, label, fields);
  };

  const updateCustomField = (cfId: number, value: string) => {
    const labels: Record<number, string> = { 140: 'Branch', 229: 'Impacto', 213: 'Nota de Versão', 228: 'Previsão Revisão', 210: 'Revisor' };
    const label = labels[cfId] ?? `cf_${cfId}`;
    trackField(`cf_${cfId}`, label, { custom_fields: [{ id: cfId, value }] });
  };

  const cf = (id: number) =>
    issue?.custom_fields?.find(f => f.id === id)?.value ?? '';

  const cfStr = (id: number) => {
    const v = cf(id);
    return Array.isArray(v) ? v.join(', ') : (v ?? '');
  };

  // Mapeia status para cor de fase (com suporte a dark mode)
  const phaseStyle = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('andamento'))                               return { bg: 'bg-blue-50   dark:bg-blue-900/20',   border: 'border-blue-200   dark:border-blue-800',   text: 'text-blue-700   dark:text-blue-300',   dot: 'bg-blue-500'   };
    if (n.includes('revisão') || n.includes('revisao'))       return { bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-200 dark:border-violet-800', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' };
    if (n.includes('teste'))                                   return { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' };
    if (n.includes('correção') || n.includes('correcao'))     return { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' };
    if (n.includes('integração') || n.includes('integracao')) return { bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-800', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' };
    if (n.includes('fechamento'))                              return { bg: 'bg-green-50  dark:bg-green-900/20',  border: 'border-green-200  dark:border-green-800',  text: 'text-green-700  dark:text-green-300',  dot: 'bg-green-500'  };
    if (n.includes('impedido'))                                return { bg: 'bg-red-50    dark:bg-red-900/20',    border: 'border-red-200    dark:border-red-800',    text: 'text-red-700    dark:text-red-300',    dot: 'bg-red-500'    };
    if (n.includes('fechad') || n.includes('cancelad'))       return { bg: 'bg-slate-100 dark:bg-slate-800/40',  border: 'border-slate-200  dark:border-slate-700',  text: 'text-slate-600  dark:text-slate-400',  dot: 'bg-slate-400'  };
    if (n.includes('desenvolvimento'))                         return { bg: 'bg-cyan-50   dark:bg-cyan-900/20',   border: 'border-cyan-200   dark:border-cyan-800',   text: 'text-cyan-700   dark:text-cyan-300',   dot: 'bg-cyan-500'   };
    if (n.includes('análise') || n.includes('analise'))       return { bg: 'bg-amber-50  dark:bg-amber-900/20',  border: 'border-amber-200  dark:border-amber-800',  text: 'text-amber-700  dark:text-amber-300',  dot: 'bg-amber-500'  };
    return { bg: 'bg-slate-50 dark:bg-slate-800/40', border: 'border-slate-200 dark:border-slate-700', text: 'text-slate-600 dark:text-slate-400', dot: 'bg-slate-400' };
  };

  const notesOnly = issue?.journals?.filter(j => j.notes?.trim()) ?? [];

  // Agrupa comentários em fases por mudança de status (atribuições ignoradas)
  const phases = useMemo(() => {
    if (!issue?.journals) return [];
    const result: { id: string; statusName: string; journals: typeof issue.journals }[] = [];
    let current: typeof result[0] = { id: 'initial', statusName: '', journals: [] };

    for (const j of issue.journals) {
      const statusChange = j.details?.find(d => d.property === 'attr' && d.name === 'status_id');
      if (statusChange?.new_value) {
        if (current.journals.length) result.push(current);
        const name = statuses?.find(s => s.id === Number(statusChange.new_value))?.name ?? '';
        current = { id: `phase-${j.id}`, statusName: name, journals: [] };
      }
      if (j.notes?.trim()) current.journals.push(j);
    }
    if (current.journals.length) result.push(current);
    return result;
  }, [issue?.journals, statuses]);

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col" onClick={onModalClick}>

        {/* Header */}
        <div className="flex items-start justify-between p-5 pb-3 border-b border-slate-200">
          <div className="flex-1 min-w-0 pr-4">
            {isLoading ? (
              <div className="h-5 bg-slate-200 animate-pulse rounded w-3/4" />
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    #{issue?.id} · {issue?.tracker.name}
                  </span>
                  <span className="text-xs text-slate-400">{issue?.project.name}</span>
                  <a
                    href={`https://redmine.b2click.com/issues/${issue?.id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-600"
                    onClick={e => e.stopPropagation()}
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
                <h2 className="text-base font-semibold text-slate-900 leading-snug">{issue?.subject}</h2>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Ver notas vinculadas a esta tarefa */}
            {issue && onViewNotes && linkedNotesCount > 0 && (
              <button
                onClick={() => onViewNotes(issue.id)}
                title={`Ver ${linkedNotesCount} nota(s) vinculada(s) a esta tarefa`}
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 transition-colors"
              >
                <StickyNote size={13} /> Notas
                <span className="min-w-[16px] h-4 px-1 inline-flex items-center justify-center text-[10px] font-bold rounded-full bg-blue-600 text-white">
                  {linkedNotesCount}
                </span>
              </button>
            )}

            {/* Nova nota sobre esta tarefa (módulo de Notas) */}
            {issue && onNewNote && (
              <button
                onClick={() => onNewNote({ title: `#${issue.id} ${issue.subject}`, linkedIssueId: issue.id, linkedProjectId: issue.project.id })}
                title="Criar nota sobre esta tarefa"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <NotebookPen size={13} /> Nota
              </button>
            )}

            {/* Observar (lista local, independente da API do Redmine) */}
            {issue && (() => {
              const isWatching = watchedIds.includes(issue.id);
              return (
                <button
                  onClick={() => localWatches.toggle(issue.id)}
                  title={isWatching ? 'Deixar de observar' : 'Observar esta tarefa'}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isWatching ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  <Star size={13} className={isWatching ? 'fill-amber-500 text-amber-500' : ''} />
                  {isWatching ? 'Observando' : 'Observar'}
                </button>
              );
            })()}

            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={18} className="text-slate-500" />
            </button>
          </div>
        </div>

        {/* Body: dois painéis (detalhe | chat) */}
        {isLoading || !issue ? (
          <div className="flex-1 p-5 space-y-3 min-h-0">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-4 bg-slate-200 animate-pulse rounded" style={{ width: `${80 - i * 8}%` }} />
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
            {/* ── ESQUERDA: detalhe da tarefa ── */}
            <div className="w-full md:w-[44%] md:border-r border-slate-100 md:overflow-y-auto scrollbar-thin bg-slate-50/40 flex flex-col pb-6">
                {/* Indicador de campos salvando/erro */}
                {savingFields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-5 pt-3">
                    {savingFields.map(f => (
                      <span key={f.key} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                        f.status === 'saving' ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-600'
                      }`}>
                        {f.status === 'saving'
                          ? <Loader2 size={10} className="animate-spin" />
                          : <AlertCircle size={10} />}
                        {f.label}
                        {f.status === 'saving' ? ' salvando…' : ' falhou'}
                      </span>
                    ))}
                  </div>
                )}

                {/* Campos editáveis — agrupados, 1 coluna com ícones */}
                <div className="border-b border-slate-100 bg-slate-50/70 pb-2 divide-y divide-slate-100/80">
                  {/* GERAL */}
                  <div>
                    <SectionHeader>Geral</SectionHeader>
                    {statuses && (
                      <FieldRow icon={<CircleDot size={14} />} label="Situação">
                        <div>
                          <StatusField
                            bare
                            currentId={issue.status.id}
                            currentName={issue.status.name}
                            statuses={statuses}
                            allowedIds={issue.allowed_statuses?.map(s => s.id)}
                            onChange={id => updateField({ status_id: id })}
                          />
                          {!isClosedName(issue.status.name) && (() => {
                            const since = statusEnteredAt(issue);
                            if (!since) return null;
                            const days = (Date.now() - since.getTime()) / 86400000;
                            return (
                              <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${days > 5 ? 'text-amber-600' : 'text-slate-400'}`}>
                                <Clock size={10} /> há {formatDistanceToNow(since, { locale: ptBR })} nesta etapa
                              </p>
                            );
                          })()}
                          {(() => {
                            const rej = countRejections(issue);
                            if (rej === 0) return null;
                            return (
                              <p className="text-[11px] mt-0.5 flex items-center gap-1 text-red-500" title="Vezes que voltou para Pendente Correção">
                                <RotateCcw size={10} /> reprovada {rej}×
                              </p>
                            );
                          })()}
                        </div>
                      </FieldRow>
                    )}
                    <FieldRow icon={<User size={14} />} label="Atribuído para">
                      <UserField
                        bare
                        label="Atribuído para"
                        value={issue.assigned_to ? String(issue.assigned_to.id) : ''}
                        users={members ?? []}
                        fallbackName={issue.assigned_to?.name}
                        onSave={v => trackField('assigned_to', 'Atribuído para', { assigned_to_id: v ? parseInt(v) : '' })}
                      />
                    </FieldRow>
                    <FieldRow icon={<Clock size={14} />} label="Tempo estimado">
                      <HoursField
                        bare
                        label="Tempo Estimado"
                        value={issue.estimated_hours ?? null}
                        required={!issue.estimated_hours}
                        onSave={v => updateField({ estimated_hours: v })}
                      />
                    </FieldRow>
                    <FieldRow icon={<Calendar size={14} />} label="Prazo">
                      <DateField
                        bare
                        label="Prazo"
                        value={issue.due_date ?? ''}
                        onSave={v => updateField({ due_date: v || null })}
                      />
                    </FieldRow>
                    <FieldRow icon={<CheckSquare size={14} />} label="Conclusão %">
                      <TextField
                        bare
                        label="Conclusão"
                        value={String(issue.done_ratio)}
                        onSave={v => { const n = parseInt(v); if (!isNaN(n)) updateField({ done_ratio: Math.min(100, Math.max(0, n)) }); }}
                      />
                    </FieldRow>
                  </div>

                  {/* HORAS */}
                  <div>
                    <SectionHeader>Horas</SectionHeader>
                    <TimeTracker issueId={issue.id} spentHours={issue.spent_hours} />
                  </div>

                  {/* DESENVOLVIMENTO */}
                  <div>
                    <SectionHeader>Desenvolvimento</SectionHeader>
                    <FieldRow icon={<GitBranch size={14} />} label="Branch">
                      <BranchField
                        bare
                        value={cfStr(CF.BRANCH)}
                        onSave={v => updateCustomField(CF.BRANCH, v)}
                        issueId={issue.id}
                        userFirstName={currentUser?.firstname}
                        subject={issue.subject}
                      />
                    </FieldRow>
                    <FieldRow icon={<Tag size={14} />} label="Impacto">
                      <SelectField
                        bare
                        label="DEV Impacto"
                        value={cfStr(CF.IMPACTO)}
                        options={IMPACTO_OPTIONS}
                        onSave={v => updateCustomField(CF.IMPACTO, v)}
                      />
                    </FieldRow>
                    <FieldRow icon={<FileText size={14} />} label="Nota de versão">
                      <TextField
                        bare
                        label="DEV Nota de Versão"
                        value={cfStr(CF.NOTA_VERSAO)}
                        onSave={v => updateCustomField(CF.NOTA_VERSAO, v)}
                        multiline
                      />
                    </FieldRow>
                    <FieldRow icon={<Calendar size={14} />} label="Previsão revisão">
                      <DateField
                        bare
                        label="Previsão Envio Revisão"
                        value={cfStr(CF.PREVISAO_REVISAO)}
                        onSave={v => updateCustomField(CF.PREVISAO_REVISAO, v)}
                      />
                    </FieldRow>
                    <FieldRow icon={<Search size={14} />} label="Revisor">
                      <UserField
                        bare
                        label="DEV Revisor"
                        value={cfStr(CF.REVISOR)}
                        users={members ?? []}
                        onSave={v => updateCustomField(CF.REVISOR, v)}
                      />
                    </FieldRow>
                  </div>
                </div>

                {/* Próxima ação sugerida — campos obrigatórios faltando */}
                {(() => {
                  const missing = getMissingFields(issue);
                  if (missing.length === 0) return null;
                  return (
                    <div className="px-4 pt-3">
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                        <span>Antes de avançar, preencha: <strong>{missing.join(', ')}</strong></span>
                      </div>
                    </div>
                  );
                })()}

                {/* CTAs de workflow contextual */}
                {issue.status.id === 32 && (
                  <div className="px-4 pt-3">
                    <StartDevCTA
                      currentBranch={cfStr(CF.BRANCH)}
                      onConfirm={branch => updateField({
                        status_id: 8,
                        custom_fields: [{ id: CF.BRANCH, value: branch }]
                      })}
                    />
                  </div>
                )}
                {(issue.status.id === 8 || issue.status.id === 34) && (
                  <div className="px-4 pt-3">
                    <SendToReviewCTA
                      currentRevisor={cfStr(CF.REVISOR)}
                      currentDate={cfStr(CF.PREVISAO_REVISAO)}
                      members={members ?? []}
                      onConfirm={(revisorId, date) => updateField({
                        status_id: 71,
                        assigned_to_id: revisorId ? parseInt(revisorId) : '',
                        custom_fields: [
                          { id: CF.REVISOR, value: revisorId },
                          { id: CF.PREVISAO_REVISAO, value: date },
                        ]
                      })}
                    />
                  </div>
                )}
                {issue.status.id === 71 && (() => {
                  const allowed = issue.allowed_statuses?.map(s => s.id);
                  const canApprove = !allowed || allowed.includes(35); // Pendente Integração
                  const canReject = !allowed || allowed.includes(34);  // Pendente Correção
                  if (!canApprove && !canReject) return null;
                  // Integrador: atribui ao Robson (resolvido pelo nome na lista de membros)
                  const integrador = (members ?? []).find(m => m.name.toLowerCase().includes('robson'));
                  return (
                    <div className="px-4 pt-3">
                      <ReviewChecklist key={issue.id} issueId={issue.id} />
                      <ReviewDecisionCTA
                        developerId={cfStr(CF.DEV_DEVELOPER)}
                        integratorName={integrador?.name}
                        members={members ?? []}
                        canApprove={canApprove}
                        canReject={canReject}
                        onApprove={note => updateField({
                          status_id: 35,
                          ...(integrador ? { assigned_to_id: integrador.id } : {}),
                          ...(note.trim() ? { notes: note.trim() } : {}),
                        })}
                        onReject={(assigneeId, note) => updateField({
                          status_id: 34,
                          assigned_to_id: assigneeId ? parseInt(assigneeId) : '',
                          ...(note.trim() ? { notes: note.trim() } : {}),
                        })}
                      />
                    </div>
                  );
                })()}

                {/* Avançar — etapas sem CTA dedicado (Teste, Integração, Atualização, Fechamento…) */}
                {![32, 8, 34, 71].includes(issue.status.id)
                  && !isClosedName(issue.status.name)
                  && (issue.allowed_statuses?.filter(s => s.id !== issue.status.id).length ?? 0) > 0 && (
                  <div className="px-4 pt-3">
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Avançar para:</p>
                    <div className="flex flex-wrap gap-2">
                      {issue.allowed_statuses!.filter(s => s.id !== issue.status.id).map(s => (
                        <button
                          key={s.id}
                          onClick={() => updateField({ status_id: s.id })}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 hover:border-blue-400 hover:text-blue-600 text-sm font-medium rounded-lg transition-colors"
                        >
                          <ArrowRight size={13} /> {s.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Checklist local */}
                <ChecklistSection issueId={issue.id} />

                {/* Tarefas relacionadas e subtarefas */}
                <RelatedIssues issue={issue} onNavigate={onNavigate} />

                {/* Páginas da Wiki vinculadas */}
                <WikiLinksSection issueId={issue.id} />
            </div>

            {/* ── DIREITA: descrição + chat ── */}
            <div className="flex-1 flex flex-col md:min-h-0">
              <div className="md:flex-1 md:overflow-y-auto scrollbar-thin">
                {/* Descrição colapsável + anexos da tarefa */}
                <DescriptionPanel
                  description={issue.description}
                  attachments={issue.attachments ?? []}
                  open={showDescription}
                  onToggle={() => setShowDescription(v => !v)}
                  onEdit={() => { setEditingDescription(textileToMarkdown(issue.description ?? '')); setShowDescription(true); }}
                />
                {editingDescription !== null && (
                  <div className="px-4 py-3 border-b border-slate-100 bg-blue-50/30 space-y-2">
                    <MarkdownEditor
                      value={editingDescription}
                      onChange={setEditingDescription}
                      attachments={issue.attachments ?? []}
                      autoFocus
                      placeholder="Escreva em Markdown… (convertido para o Redmine ao salvar)"
                      onSubmit={() => {
                        trackField('description', 'Descrição', { description: markdownToTextile(editingDescription) });
                        setEditingDescription(null);
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          trackField('description', 'Descrição', { description: markdownToTextile(editingDescription) });
                          setEditingDescription(null);
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg"
                      >
                        <Check size={12} /> Salvar
                      </button>
                      <button
                        onClick={() => setEditingDescription(null)}
                        className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
                      >
                        Cancelar
                      </button>
                      <span className="text-[10px] text-slate-400">Markdown · Ctrl+Enter salva</span>
                    </div>
                  </div>
                )}

                {/* Painel de IA — gera prompt, resumo de histórico e rascunho de nota */}
                <div className="px-4 pt-3">
                  <IssueAIPanel
                    issue={issue}
                    onInsertNote={text => {
                      setAiDraftNote(text);
                      // Limpa após injetar para permitir novo inject depois
                      setTimeout(() => setAiDraftNote(undefined), 100);
                    }}
                  />
                </div>

                {/* Toggle de visualização por fase */}
                <div className="flex items-center justify-end px-4 pt-3 pb-0">
                  <button
                    onClick={() => setPhaseView(v => {
                      const next = !v;
                      localStorage.setItem('rk_phase_view', next ? '1' : '0');
                      return next;
                    })}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors ${
                      phaseView
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                    }`}
                    title="Agrupar comentários por status"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${phaseView ? 'bg-blue-500' : 'bg-slate-300'}`} />
                    Fases
                  </button>
                </div>

                {/* Chat */}
                <div className="p-4 space-y-3">
                  {/* ── Vista por fases ── */}
                  {phaseView && phases.length === 0 && (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-slate-400">Nenhum comentário ainda.</p>
                    </div>
                  )}
                  {phaseView && phases.map(phase => {
                    const s = phaseStyle(phase.statusName);
                    return (
                      <div key={phase.id} className={`rounded-xl border ${s.bg} ${s.border} overflow-hidden`}>
                        {phase.statusName && (
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 border-b ${s.border}`}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                            <span className={`text-[11px] font-semibold ${s.text}`}>{phase.statusName}</span>
                          </div>
                        )}
                        <div className="p-3 space-y-3">
                          {phase.journals.map(journal => {
                            const isEditing = editingJournal?.id === journal.id;
                            const isMine = journal.user.id === currentUser?.id;
                            return (
                              <div key={journal.id} className="flex gap-3 group">
                                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                                  {journal.user.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold text-slate-700">{journal.user.name}</span>
                                    <span className="text-xs text-slate-400">
                                      {formatDistanceToNow(new Date(journal.created_on), { addSuffix: true, locale: ptBR })}
                                    </span>
                                    {isMine && !isEditing && (
                                      <button
                                        onClick={() => setEditingJournal({ id: journal.id, text: journal.notes })}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                        title="Editar comentário"
                                      >
                                        <Pencil size={12} />
                                      </button>
                                    )}
                                  </div>
                                  {isEditing ? (
                                    <div className="space-y-1.5">
                                      <textarea
                                        autoFocus
                                        value={editingJournal.text}
                                        onChange={e => setEditingJournal(prev => prev ? { ...prev, text: e.target.value } : null)}
                                        rows={4}
                                        className="w-full text-sm px-3 py-2 border border-blue-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y bg-white"
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          onClick={() => {
                                            updateJournal.mutate({ id: journal.id, notes: editingJournal.text });
                                            setEditingJournal(null);
                                          }}
                                          disabled={updateJournal.isPending}
                                          className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                                        >
                                          <Check size={12} /> Salvar
                                        </button>
                                        <button
                                          onClick={() => setEditingJournal(null)}
                                          className="px-3 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
                                        >
                                          Cancelar
                                        </button>
                                        <span className="text-[10px] text-slate-400">Textile/Markdown</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl rounded-tl-sm px-3 py-2">
                                      <Markdown text={journal.notes} attachments={issue.attachments} textile />
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* ── Vista normal (padrão) ── */}
                  {!phaseView && notesOnly.length === 0 && (
                    <div className="flex items-center justify-center py-8">
                      <p className="text-sm text-slate-400">Nenhum comentário ainda.</p>
                    </div>
                  )}
                  {!phaseView && notesOnly.map(journal => {
                    const isEditing = editingJournal?.id === journal.id;
                    const isMine = journal.user.id === currentUser?.id;
                    return (
                      <div key={journal.id} className="flex gap-3 group">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
                          {journal.user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold text-slate-700">{journal.user.name}</span>
                            <span className="text-xs text-slate-400">
                              {formatDistanceToNow(new Date(journal.created_on), { addSuffix: true, locale: ptBR })}
                            </span>
                            {isMine && !isEditing && (
                              <button
                                onClick={() => setEditingJournal({ id: journal.id, text: journal.notes })}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                                title="Editar comentário"
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="space-y-1.5">
                              <textarea
                                autoFocus
                                value={editingJournal.text}
                                onChange={e => setEditingJournal(prev => prev ? { ...prev, text: e.target.value } : null)}
                                rows={4}
                                className="w-full text-sm px-3 py-2 border border-blue-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y bg-white"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    updateJournal.mutate({ id: journal.id, notes: editingJournal.text });
                                    setEditingJournal(null);
                                  }}
                                  disabled={updateJournal.isPending}
                                  className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                                >
                                  <Check size={12} /> Salvar
                                </button>
                                <button
                                  onClick={() => setEditingJournal(null)}
                                  className="px-3 py-1 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
                                >
                                  Cancelar
                                </button>
                                <span className="text-[10px] text-slate-400">Textile/Markdown</span>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-slate-50 border border-slate-100 rounded-xl rounded-tl-sm px-3 py-2">
                              <Markdown text={journal.notes} attachments={issue.attachments} textile />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Notas pendentes (optimistic) */}
                  {pendingNotes.map(pending => (
                    <div key={pending.id} className="flex gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                        pending.status === 'pending' ? 'bg-slate-200 text-slate-500' : 'bg-red-100 text-red-500'
                      }`}>
                        {currentUser ? `${currentUser.firstname.charAt(0)}${currentUser.lastname.charAt(0)}` : '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-400">
                            {currentUser ? `${currentUser.firstname} ${currentUser.lastname}` : 'Você'}
                          </span>
                          {pending.status === 'pending' && (
                            <span className="flex items-center gap-1 text-xs text-slate-400">
                              <Loader2 size={10} className="animate-spin" />
                              Enviando…
                            </span>
                          )}
                          {pending.status === 'error' && (
                            <span className="flex items-center gap-1 text-xs text-red-500">
                              <AlertCircle size={10} />
                              Falhou ao enviar
                              <button
                                onClick={() => retryNote(pending)}
                                className="flex items-center gap-0.5 underline hover:text-red-700 ml-1"
                              >
                                <RotateCcw size={10} /> Tentar novamente
                              </button>
                              <button onClick={() => dismissNote(pending.id)} className="text-slate-400 hover:text-slate-600 ml-1">
                                <X size={10} />
                              </button>
                            </span>
                          )}
                        </div>
                        <div className={`rounded-xl rounded-tl-sm px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap transition-colors ${
                          pending.status === 'pending'
                            ? 'bg-slate-100 text-slate-500 border border-slate-200'
                            : 'bg-red-50 text-slate-700 border border-red-200'
                        }`}>
                          {pending.text}
                          {pending.files && pending.files.length > 0 && (
                            <span className={`flex items-center gap-1 text-xs text-slate-400 ${pending.text ? 'mt-1' : ''}`}>
                              <Link2 size={11} /> {pending.files.length} anexo(s)
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Composer fixo no rodapé do painel de chat */}
              <div className="p-3 border-t border-slate-200 bg-slate-50">
                <CommentComposer
                  onSubmit={sendNote}
                  sending={addNote.isPending}
                  draftKey={String(issueId)}
                  members={members ?? []}
                  injectText={aiDraftNote}
                  aiContext={{ subject: issue.subject, statusName: issue.status.name }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    {lightbox && (
      <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />
    )}
    </>
  );
}
