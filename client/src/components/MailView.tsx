import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Mail, Inbox, Send, Trash2, FileEdit, AlertOctagon, Search, RefreshCw,
  Paperclip, X, Reply, ReplyAll, MailOpen, Loader2, Circle, ArrowLeft, PenSquare, Star,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { mailApi, type MailMessageSummary, type MailMessageFull } from '../api/mail';
import { needsMailConfig } from '../utils/mailConfig';

// Ícone e ordem amigável por pasta do Zimbra.
const FOLDER_META: Record<string, { label: string; icon: React.ReactNode; order: number }> = {
  Inbox:  { label: 'Entrada',    icon: <Inbox size={15} />,        order: 0 },
  Sent:   { label: 'Enviados',   icon: <Send size={15} />,         order: 1 },
  Drafts: { label: 'Rascunhos',  icon: <FileEdit size={15} />,     order: 2 },
  Junk:   { label: 'Spam',       icon: <AlertOctagon size={15} />, order: 3 },
  Trash:  { label: 'Lixeira',    icon: <Trash2 size={15} />,       order: 4 },
};

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  if (now - ms < 20 * 60 * 60 * 1000) return formatDistanceToNow(d, { addSuffix: true, locale: ptBR });
  return format(d, "d 'de' MMM", { locale: ptBR });
}

interface ComposeSeed { to: string; cc?: string; subject: string; body: string; inReplyTo?: string }

// Remove tags e decodifica entidades básicas, para citar um corpo HTML em texto.
function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/tr|\/li)\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Monta o "seed" do compositor a partir de uma mensagem, para responder.
function buildReply(msg: MailMessageFull, all: boolean, me?: string): ComposeSeed {
  const original = (msg.text || htmlToText(msg.html || '')).slice(0, 5000);
  const when = format(new Date(msg.date), "d/MM/yyyy 'às' HH:mm", { locale: ptBR });
  const quoted = original.split('\n').map(l => `> ${l}`).join('\n');
  const ccList = all
    ? [...msg.to, ...msg.cc].map(a => a.address).filter(a => a && a !== me && a !== msg.from.address)
    : [];
  return {
    to: msg.from.address,
    cc: [...new Set(ccList)].join(', '),
    subject: /^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`,
    body: `\n\n----- Em ${when}, ${msg.from.name || msg.from.address} escreveu: -----\n${quoted}`,
    inReplyTo: msg.id,
  };
}

export function MailView() {
  // Sem credenciais utilizáveis (entrou por chave de API): orienta a configurar,
  // evitando disparar as queries de e-mail sem auth.
  if (needsMailConfig()) return <MailConfigNeeded />;
  return <MailViewInner />;
}

function MailViewInner() {
  const qc = useQueryClient();
  const [folder, setFolder] = useState('inbox');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [limit, setLimit] = useState(40);
  const [compose, setCompose] = useState<ComposeSeed | null>(null);

  const foldersQuery = useQuery({ queryKey: ['mail', 'folders'], queryFn: mailApi.getFolders, staleTime: 60_000 });

  const listQuery = useQuery({
    queryKey: ['mail', 'list', activeSearch ? `search:${activeSearch}` : folder, limit],
    queryFn: () => activeSearch ? mailApi.search(activeSearch, limit) : mailApi.getMessages(folder, limit),
    staleTime: 30_000,
  });

  const messages = listQuery.data?.messages ?? [];

  const folders = useMemo(() => {
    const list = foldersQuery.data ?? [];
    return [...list].sort((a, b) =>
      (FOLDER_META[a.name]?.order ?? 99) - (FOLDER_META[b.name]?.order ?? 99) || a.name.localeCompare(b.name));
  }, [foldersQuery.data]);

  const runSearch = () => {
    setActiveSearch(searchTerm.trim());
    setSelectedId(null); setLimit(40);
  };
  const clearSearch = () => { setSearchTerm(''); setActiveSearch(''); setLimit(40); };

  const selectFolder = (f: string) => { setFolder(f); setActiveSearch(''); setSearchTerm(''); setSelectedId(null); setLimit(40); };

  return (
    <div className="h-full flex flex-col max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Mail size={20} className="text-blue-500" />
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">E-mail</h2>
        </div>
        <div className="flex-1 relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); if (e.key === 'Escape') clearSearch(); }}
            placeholder="Buscar e-mails…"
            className="w-full text-sm pl-9 pr-8 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          {(searchTerm || activeSearch) && (
            <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setCompose({ to: '', subject: '', body: '' })}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <PenSquare size={14} /> Escrever
        </button>
        <button
          onClick={() => { qc.invalidateQueries({ queryKey: ['mail'] }); }}
          title="Atualizar"
          className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <RefreshCw size={15} className={listQuery.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Corpo: pastas | lista | leitura */}
      <div className="flex-1 min-h-0 flex gap-3">
        {/* Pastas */}
        <div className="w-44 flex-shrink-0 space-y-0.5">
          {foldersQuery.isLoading && <p className="text-xs text-slate-400 px-3 py-2">Carregando…</p>}
          {folders.map(f => {
            const meta = FOLDER_META[f.name];
            const isActive = !activeSearch && (folder === f.name || folder === f.name.toLowerCase());
            return (
              <button
                key={f.id}
                onClick={() => selectFolder(f.name)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <span className="flex-shrink-0">{meta?.icon ?? <Mail size={15} />}</span>
                <span className="flex-1 truncate">{meta?.label ?? f.name}</span>
                {f.unread > 0 && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white">{f.unread}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Lista de mensagens */}
        <div className={`${selectedId ? 'hidden lg:block lg:w-80' : 'flex-1'} flex-shrink-0 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900`}>
          <div className="h-full overflow-y-auto scrollbar-thin">
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center h-40 text-slate-400"><Loader2 className="animate-spin" size={20} /></div>
            ) : listQuery.isError ? (
              <div className="p-6 text-center text-sm text-red-500">
                Não foi possível carregar os e-mails.<br />
                <span className="text-xs text-slate-400">Verifique suas credenciais do Zimbra.</span>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                <Inbox size={28} className="mb-2 opacity-40" />
                <p className="text-sm">{activeSearch ? 'Nada encontrado.' : 'Pasta vazia.'}</p>
              </div>
            ) : (
              <>
                {messages.map(m => (
                  <MessageRow key={m.id} m={m} selected={selectedId === m.id} onClick={() => setSelectedId(m.id)} />
                ))}
                {listQuery.data?.more && (
                  <button
                    onClick={() => setLimit(l => l + 40)}
                    disabled={listQuery.isFetching}
                    className="w-full py-3 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {listQuery.isFetching ? <Loader2 size={13} className="animate-spin" /> : null}
                    Carregar mais
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Leitura */}
        {selectedId && (
          <div className="flex-1 min-w-0 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
            <MessageReader
              id={selectedId}
              onClose={() => setSelectedId(null)}
              onReply={(full, all) => setCompose(buildReply(full, all))}
              onChanged={() => { qc.invalidateQueries({ queryKey: ['mail', 'list'] }); qc.invalidateQueries({ queryKey: ['mail', 'folders'] }); }}
              onActed={(closeAfter) => {
                qc.invalidateQueries({ queryKey: ['mail', 'list'] });
                qc.invalidateQueries({ queryKey: ['mail', 'folders'] });
                if (closeAfter) setSelectedId(null);
              }}
            />
          </div>
        )}
      </div>

      {compose && (
        <ComposeModal
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => { setCompose(null); qc.invalidateQueries({ queryKey: ['mail'] }); }}
        />
      )}
    </div>
  );
}

function MessageRow({ m, selected, onClick }: { m: MailMessageSummary; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors ${
        selected ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      <div className="flex items-center gap-2">
        {m.unread
          ? <Circle size={8} className="text-blue-500 fill-blue-500 flex-shrink-0" />
          : <span className="w-2 flex-shrink-0" />}
        <span className={`flex-1 truncate text-sm ${m.unread ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
          {m.from.name || m.from.address}
        </span>
        {m.flagged && <Star size={12} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
        {m.hasAttachment && <Paperclip size={12} className="text-slate-400 flex-shrink-0" />}
        <span className="text-[11px] text-slate-400 flex-shrink-0">{fmtDate(m.date)}</span>
      </div>
      <p className={`text-sm truncate mt-0.5 ${m.unread ? 'font-medium text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
        {m.subject}
      </p>
      <p className="text-xs text-slate-400 truncate mt-0.5">{m.snippet}</p>
    </button>
  );
}

function MessageReader({ id, onClose, onReply, onChanged, onActed }: {
  id: string;
  onClose: () => void;
  onReply: (m: MailMessageFull, all: boolean) => void;
  onChanged: () => void;
  onActed: (closeAfter: boolean) => void;
}) {
  const { data: msg, isLoading } = useQuery({
    queryKey: ['mail', 'message', id],
    queryFn: () => mailApi.getMessage(id, true),
    staleTime: 0,
  });

  const actMut = useMutation({
    mutationFn: ({ op }: { op: string; close: boolean }) => mailApi.action(id, op),
    onSuccess: (_d, v) => onActed(v.close),
  });

  // Ao abrir (marcado como lido no servidor), atualiza contadores/lista uma vez.
  const loaded = msg && !isLoading;
  useEffect(() => {
    if (loaded) onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loaded]);

  if (isLoading || !msg) {
    return <div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="animate-spin" size={22} /></div>;
  }

  const act = (op: string, close: boolean) => actMut.mutate({ op, close });

  const srcDoc = msg.html
    ? `<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/" target="_blank"><style>body{font-family:system-ui,sans-serif;color:#0f172a;margin:16px;overflow-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${msg.html}</body></html>`
    : `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;color:#0f172a;white-space:pre-wrap;margin:16px}</style></head><body>${escapeHtml(msg.text || '(sem conteúdo)')}</body></html>`;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <button onClick={onClose} className="lg:hidden p-1 text-slate-400 hover:text-slate-600 mr-1"><ArrowLeft size={16} /></button>
        <button onClick={() => onReply(msg, false)} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors">
          <Reply size={13} /> Responder
        </button>
        {(msg.to.length + msg.cc.length) > 1 && (
          <button onClick={() => onReply(msg, true)} className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
            <ReplyAll size={13} /> Todos
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => act('flag', false)} title="Sinalizar" className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"><Star size={15} /></button>
        <button onClick={() => act('!read', true)} title="Marcar como não lida" className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"><MailOpen size={15} /></button>
        <button onClick={() => act('trash', true)} title="Mover para lixeira" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"><Trash2 size={15} /></button>
        <button onClick={onClose} className="hidden lg:block p-1 ml-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>

      {/* Cabeçalho */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex-shrink-0">
        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{msg.subject}</h3>
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
          <p><span className="font-medium text-slate-700 dark:text-slate-300">{msg.from.name || msg.from.address}</span> &lt;{msg.from.address}&gt;</p>
          <p>para {msg.to.map(t => t.name || t.address).join(', ')}</p>
          <p>{format(new Date(msg.date), "d 'de' MMMM 'de' yyyy 'às' HH:mm", { locale: ptBR })}</p>
        </div>
        {msg.attachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {msg.attachments.map(a => (
              <a
                key={a.part}
                href={mailApi.attachmentUrl(msg.id, a.part)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-600 dark:text-slate-300 transition-colors"
              >
                <Paperclip size={12} />
                <span className="truncate max-w-[160px]">{a.filename}</span>
                <span className="text-slate-400">{Math.round(a.size / 1024)}KB</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Corpo (iframe sandbox: isola CSS e neutraliza scripts do e-mail) */}
      <iframe
        title="conteúdo do e-mail"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}

function ComposeModal({ initial, onClose, onSent }: {
  initial: ComposeSeed;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(initial.to);
  const [cc, setCc] = useState(initial.cc || '');
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [error, setError] = useState('');
  const split = (s: string) => s.split(/[,;]/).map(x => x.trim()).filter(Boolean);

  const sendMut = useMutation({
    mutationFn: () => mailApi.send({
      to: split(to),
      cc: split(cc),
      subject,
      text: body,
      inReplyTo: initial.inReplyTo,
    }),
    onSuccess: onSent,
    onError: (e: any) => setError(e?.response?.data?.error || 'Falha ao enviar.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{initial.inReplyTo ? 'Responder' : 'Nova mensagem'}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input
            value={to} onChange={e => setTo(e.target.value)}
            placeholder="Para (separe por vírgula)"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <input
            value={cc} onChange={e => setCc(e.target.value)}
            placeholder="Cc (opcional)"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <input
            value={subject} onChange={e => setSubject(e.target.value)}
            placeholder="Assunto"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <textarea
            value={body} onChange={e => setBody(e.target.value)}
            placeholder="Escreva sua mensagem…"
            rows={10}
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-slate-800">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">Cancelar</button>
          <button
            onClick={() => { setError(''); sendMut.mutate(); }}
            disabled={!to.trim() || sendMut.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {sendMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function MailConfigNeeded() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto">
      <Mail size={36} className="text-slate-300 dark:text-slate-600 mb-3" />
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">Configure seu e-mail</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
        Como você entrou com chave de API, precisamos da sua conta do Zimbra.
        Abra <strong>Configurações</strong> e preencha a seção <strong>E-mail</strong>.
      </p>
      <p className="text-xs text-slate-400 mt-3">
        Dica: se entrar com usuário e senha do Redmine, o e-mail funciona automaticamente.
      </p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}
