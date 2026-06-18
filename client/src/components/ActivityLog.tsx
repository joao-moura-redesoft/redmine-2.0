import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowRight, Paperclip } from 'lucide-react';
import type { Journal, JournalDetail, IssueStatus, Issue, Attachment } from '../types/redmine';
import { Markdown, inlineImageNames } from './Markdown';
import { attachmentUrl } from '../api/redmine';

// Anexos adicionados num journal: imagens como miniatura (clicável → lightbox do
// modal), demais como link de download. Mostra mesmo sem referência inline na nota.
export function JournalAttachments({ journal, attachments }: {
  journal: Journal; attachments?: Attachment[];
}) {
  const addedIds = (journal.details ?? [])
    .filter(d => d.property === 'attachment' && d.new_value)
    .map(d => Number(d.name));
  // Pula anexos já renderizados inline na nota (mesma lógica do componente
  // Markdown), evitando preview duplicado.
  const inline = inlineImageNames(journal.notes);
  const atts = (attachments ?? [])
    .filter(a => addedIds.includes(a.id) && !inline.has(a.filename));
  if (atts.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {atts.map(a => a.content_type?.startsWith('image/') ? (
        <img
          key={a.id}
          src={attachmentUrl(a.id, a.filename)}
          alt={a.filename}
          title={a.filename}
          className="max-h-40 max-w-[200px] rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer object-cover"
        />
      ) : (
        <a
          key={a.id}
          href={attachmentUrl(a.id, a.filename)}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Paperclip size={12} /> {a.filename}
        </a>
      ))}
    </div>
  );
}

// Rótulos amigáveis para os atributos padrão do Redmine.
const ATTR_LABELS: Record<string, string> = {
  status_id: 'Situação', assigned_to_id: 'Responsável', priority_id: 'Prioridade',
  done_ratio: '% concluído', fixed_version_id: 'Versão', tracker_id: 'Tipo',
  subject: 'Título', description: 'Descrição', category_id: 'Categoria',
  start_date: 'Início', due_date: 'Data prevista', estimated_hours: 'Tempo estimado',
  is_private: 'Privado', parent_id: 'Tarefa pai', project_id: 'Projeto',
};

interface LookupCtx {
  statuses?: IssueStatus[];
  members?: { id: number; name: string }[];
  issue: Issue;
}

function labelFor(d: JournalDetail, ctx: LookupCtx): string {
  if (d.property === 'cf') {
    return ctx.issue.custom_fields?.find(c => String(c.id) === d.name)?.name ?? 'Campo personalizado';
  }
  if (d.property === 'attachment') return 'Anexo';
  if (d.property === 'relation') return 'Relação';
  return ATTR_LABELS[d.name] ?? d.name;
}

function valueFor(d: JournalDetail, raw: string | null, ctx: LookupCtx): string {
  if (raw == null || raw === '') return '—';
  if (d.property === 'attr') {
    if (d.name === 'status_id') return ctx.statuses?.find(s => s.id === Number(raw))?.name ?? raw;
    if (d.name === 'assigned_to_id') return ctx.members?.find(m => m.id === Number(raw))?.name ?? `#${raw}`;
    if (d.name === 'done_ratio') return `${raw}%`;
    if (d.name === 'is_private') return raw === '1' ? 'Sim' : 'Não';
  }
  if (d.property === 'attachment') return raw; // nome do arquivo
  return raw;
}

// Descreve uma mudança de campo de forma legível.
function DetailLine({ d, ctx }: { d: JournalDetail; ctx: LookupCtx }) {
  const label = labelFor(d, ctx);

  if (d.property === 'attachment') {
    const added = !!d.new_value;
    return (
      <li className="text-xs text-slate-600 dark:text-slate-300">
        <span className="font-medium">{label}</span> {added ? 'adicionado' : 'removido'}:{' '}
        <span className="text-slate-500">{added ? d.new_value : d.old_value}</span>
      </li>
    );
  }

  const from = valueFor(d, d.old_value, ctx);
  const to = valueFor(d, d.new_value, ctx);
  const hasOld = d.old_value != null && d.old_value !== '';

  return (
    <li className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
      <span className="font-medium">{label}:</span>
      {hasOld && <span className="text-slate-400 line-through">{from}</span>}
      {hasOld && <ArrowRight size={11} className="text-slate-300 flex-shrink-0" />}
      <span className="text-slate-700 dark:text-slate-200 font-medium">{to}</span>
    </li>
  );
}

// Histórico completo: todos os journals (mudanças de campo + notas), em ordem.
export function ActivityLog({ journals, statuses, members, issue }: {
  journals?: Journal[];
  statuses?: IssueStatus[];
  members?: { id: number; name: string }[];
  issue: Issue;
}) {
  const entries = (journals ?? []).filter(j => (j.details?.length ?? 0) > 0 || j.notes?.trim());
  const ctx: LookupCtx = { statuses, members, issue };

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-slate-400">Nenhuma atividade registrada.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(j => {
        const details = j.details ?? [];
        return (
          <div key={j.id} className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5">
              {j.user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{j.user.name}</span>
                <span
                  className="text-xs text-slate-400"
                  title={format(new Date(j.created_on), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                >
                  {formatDistanceToNow(new Date(j.created_on), { addSuffix: true, locale: ptBR })}
                </span>
              </div>
              {details.length > 0 && (
                <ul className="space-y-0.5 mb-1.5 border-l-2 border-slate-100 dark:border-slate-700 pl-2">
                  {details.map((d, i) => <DetailLine key={i} d={d} ctx={ctx} />)}
                </ul>
              )}
              {j.notes?.trim() && (
                <div className="bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl rounded-tl-sm px-3 py-2">
                  <Markdown text={j.notes} attachments={issue.attachments} textile />
                </div>
              )}
              <JournalAttachments journal={j} attachments={issue.attachments} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
