import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, Loader2, Wrench, Sparkles, Trash2 } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { redmineApi } from '../api/redmine';
import { getAIKey } from '../utils/aiConfig';
import { aiErrorMessage } from '../utils/aiError';

marked.setOptions({ breaks: true, gfm: true });

interface ToolCall { tool: string; args: unknown; }
interface Msg { role: 'user' | 'assistant'; content: string; trace?: ToolCall[]; }

const TOOL_LABELS: Record<string, string> = {
  buscar_tarefas: 'Buscou tarefas',
  listar_minhas_tarefas: 'Listou suas tarefas',
  detalhes_tarefa: 'Abriu detalhes da tarefa',
  listar_projetos: 'Listou projetos',
  listar_horas: 'Consultou horas',
  usuario_atual: 'Identificou você',
  buscar_wiki: 'Buscou na wiki',
  ler_pagina_wiki: 'Leu página da wiki',
  listar_emails: 'Listou e-mails',
  buscar_emails: 'Buscou e-mails',
  ler_email: 'Leu um e-mail',
  listar_notas: 'Listou suas notas',
  criar_nota: 'Criou uma nota',
  lancar_horas: 'Lançou horas',
};

const SUGGESTIONS = [
  'Quais são minhas tarefas abertas?',
  'Procure na wiki como fazer backup',
  'Tenho e-mails não lidos importantes?',
  'Crie uma nota com minhas pendências de hoje',
];

// Renderiza markdown (negrito, listas, títulos…) mantendo #1234 clicável.
// Os IDs de tarefa viram links internos (#rk-issue-N) e o clique é capturado
// por delegação no container, abrindo o modal da issue.
function MarkdownMessage({ text, onIssueClick }: { text: string; onIssueClick?: (id: number) => void }) {
  const html = useMemo(() => {
    // #1234 → [#1234](#rk-issue-1234), sem casar cabeçalhos "# texto" (têm espaço).
    const linked = text.replace(/(^|[^\w&#])#(\d+)\b/g, (_m, pre, id) => `${pre}[#${id}](#rk-issue-${id})`);
    const raw = marked.parse(linked, { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  }, [text]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const m = /^#rk-issue-(\d+)$/.exec(anchor.getAttribute('href') || '');
    if (m) { e.preventDefault(); onIssueClick?.(Number(m[1])); }
  };

  return (
    <div className="prose-redmine" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function AssistantView({ onIssueClick }: { onIssueClick?: (id: number) => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasKey = !!getAIKey();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setError('');
    setLoading(true);
    try {
      const { reply, trace } = await redmineApi.aiChat(next.map(m => ({ role: m.role, content: m.content })));
      setMessages(m => [...m, { role: 'assistant', content: reply || '(sem resposta)', trace }]);
    } catch (e: unknown) {
      setError(aiErrorMessage(e, 'Erro ao falar com o assistente. Tente novamente.'));
      setMessages(m => m.slice(0, -1)); // remove a pergunta que falhou
      setInput(q);
    } finally {
      setLoading(false);
    }
  };

  if (!hasKey) {
    return (
      <div className="max-w-3xl mx-auto flex flex-col items-center justify-center h-[calc(100vh-200px)] text-center text-slate-400">
        <Bot size={40} className="mb-3 opacity-40" />
        <p className="text-sm">Configure uma chave de IA em <strong className="text-slate-600 dark:text-slate-300">Configurações</strong> para usar o assistente.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-170px)] max-w-3xl mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-700">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
          <Bot size={15} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Assistente</p>
          <p className="text-[11px] text-slate-400">Tarefas, wiki, e-mail e notas · cria nota e lança horas</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => setMessages([])} title="Limpar conversa"
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Sparkles size={28} className="text-purple-400 mb-2" />
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Pergunte sobre tarefas, wiki, e-mails ou notas.</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-md">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-purple-300 hover:text-purple-600 dark:hover:text-purple-400 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${m.role === 'user' ? '' : 'w-full'}`}>
              {/* Trace de ferramentas usadas */}
              {m.role === 'assistant' && m.trace && m.trace.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {m.trace.map((t, ti) => (
                    <span key={ti} className="inline-flex items-center gap-1 text-[10px] text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-full px-2 py-0.5">
                      <Wrench size={9} /> {TOOL_LABELS[t.tool] ?? t.tool}
                    </span>
                  ))}
                </div>
              )}
              <div className={`text-sm leading-relaxed rounded-2xl px-3.5 py-2 ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm'
              }`}>
                {m.role === 'assistant'
                  ? <MarkdownMessage text={m.content} onIssueClick={onIssueClick} />
                  : m.content}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-bl-sm px-3.5 py-2.5">
              <Loader2 size={13} className="animate-spin" /> Pensando…
            </div>
          </div>
        )}
      </div>

      {/* Erro */}
      {error && <p className="px-4 pb-1 text-xs text-red-500 dark:text-red-400">{error}</p>}

      {/* Input */}
      <div className="flex items-end gap-2 p-3 border-t border-slate-100 dark:border-slate-700">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Pergunte sobre tarefas, wiki, e-mail, notas…  (Enter envia)"
          rows={1}
          className="flex-1 resize-none text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-400 max-h-32 text-slate-800 dark:text-slate-100 placeholder-slate-400"
        />
        <button onClick={() => send(input)} disabled={!input.trim() || loading}
          className="p-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-xl transition-colors flex-shrink-0">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}
