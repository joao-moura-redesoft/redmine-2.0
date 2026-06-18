import { useState, useEffect } from 'react';
import { Sparkles, X, Copy, Check, Loader2, Download, FileText, NotebookPen, ClipboardCheck, Clock, AlertTriangle, Tag, RotateCcw, MessageSquare } from 'lucide-react';
import { redmineApi } from '../api/redmine';
import { getAIKey } from '../utils/aiConfig';
import { aiErrorMessage } from '../utils/aiError';
import type { Issue } from '../types/redmine';

type Mode = 'prompt' | 'history' | 'draft' | 'reply' | 'checklist' | 'estimate' | 'ambiguities' | 'versionnote';

interface ComplexityResult {
  level: string;
  reasoning: string;
  risks: string[];
  roughHours: string;
}

interface AmbiguityItem { trecho: string; problema: string; pergunta: string; }
interface AmbiguitiesResult { hasIssues: boolean; ambiguities: AmbiguityItem[]; }
interface VersionNoteResult { notes: string[]; reasoning: string; }

// Sinaliza que o modal desta issue deve auto-gerar o prompt ao montar.
let pendingAIIssueId: number | null = null;
function triggerAIOnOpen(issueId: number) { pendingAIIssueId = issueId; }

interface ResultState {
  mode: Mode;
  text: string;
  copied: boolean;
  complexity?: ComplexityResult;
  ambiguities?: AmbiguitiesResult;
  versionNote?: VersionNoteResult;
}

interface Props {
  issue: Issue;
  compact?: boolean;
  /** Abre o modal da issue (usado no modo compacto do card) */
  onOpen?: () => void;
  /** Chamado quando usuário clica em "Inserir na nota" no rascunho */
  onInsertNote?: (text: string) => void;
}

// ── Painel de resultado reutilizável ──────────────────────────────────────
function ResultPanel({
  title, text, copied, onCopy, onClose, onDownload, onInsert,
}: {
  title: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
  onDownload?: () => void;
  onInsert?: () => void;
}) {
  return (
    <div className="border border-purple-200 dark:border-purple-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between px-3 py-2 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-100 dark:border-purple-800">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
          <Sparkles size={12} />
          {title}
        </span>
        <div className="flex items-center gap-1">
          {onInsert && (
            <button
              onClick={onInsert}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors"
              title="Inserir no campo de nota"
            >
              <NotebookPen size={11} />
              Inserir na nota
            </button>
          )}
          <button
            onClick={onCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
          {onDownload && (
            <button
              onClick={onDownload}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors"
              title="Baixar como .md"
            >
              <Download size={11} />
              .md
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <pre className="text-xs p-4 whitespace-pre-wrap font-mono text-slate-700 dark:text-slate-300 max-h-80 overflow-y-auto scrollbar-thin leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

// Cache de ambiguidades por sessão — chave inclui assinatura dos anexos para
// invalidar automaticamente quando novos arquivos são adicionados à issue.
function attachSig(issue: { attachments?: { id: number }[] }): string {
  const ids = (issue.attachments ?? []).map(a => a.id).sort((a, b) => a - b);
  return ids.length ? ids.join('-') : '0';
}

const AMBIGUITY_CACHE_KEY = (id: number, sig: string) => `rk_ambig2_${id}_${sig}`;

function getCachedAmbiguities(issue: { id: number; attachments?: { id: number }[] }): AmbiguitiesResult | null {
  try {
    const raw = sessionStorage.getItem(AMBIGUITY_CACHE_KEY(issue.id, attachSig(issue)));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setCachedAmbiguities(issue: { id: number; attachments?: { id: number }[] }, data: AmbiguitiesResult) {
  try { sessionStorage.setItem(AMBIGUITY_CACHE_KEY(issue.id, attachSig(issue)), JSON.stringify(data)); } catch { /* ignore */ }
}

function clearCachedAmbiguities(issue: { id: number; attachments?: { id: number }[] }) {
  try { sessionStorage.removeItem(AMBIGUITY_CACHE_KEY(issue.id, attachSig(issue))); } catch { /* ignore */ }
}

export function IssueAIPanel({ issue, compact = false, onOpen, onInsertNote }: Props) {
  const [loading, setLoading] = useState<Mode | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState('');
  // Alerta automático de ambiguidades — roda em background ao abrir o modal.
  const [autoAmbiguity, setAutoAmbiguity] = useState<AmbiguitiesResult | null>(() =>
    !compact ? getCachedAmbiguities(issue) : null
  );
  const [autoLoading, setAutoLoading] = useState(false);
  const hasKey = !!getAIKey();

  // Deve ficar antes de qualquer return. Consome o pending trigger (auto-gerar ao abrir modal).
  const shouldAutoRun = !compact && pendingAIIssueId === issue.id;
  if (shouldAutoRun) pendingAIIssueId = null;

  useEffect(() => {
    if (shouldAutoRun) runMode('prompt');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-detecção de ambiguidades ao abrir o modal (se AI configurada e descrição substancial).
  useEffect(() => {
    if (compact || !hasKey || autoAmbiguity !== null) return;
    const desc = issue.description || '';
    if (desc.length < 80) return; // descrição trivial — não vale analisar
    const isClosed = ['fechad', 'cancelad'].some(s => issue.status.name.toLowerCase().includes(s));
    if (isClosed) return;

    setAutoLoading(true);
    redmineApi.detectAmbiguities(issue)
      .then(data => {
        setCachedAmbiguities(issue, data);
        setAutoAmbiguity(data);
      })
      .catch(() => { /* falha silenciosa */ })
      .finally(() => setAutoLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!hasKey) return null;

  const runMode = async (mode: Mode) => {
    // Fecha resultado anterior do mesmo tipo; reabre se diferente
    if (result?.mode === mode) { setResult(null); return; } // toggle
    setResult(null);
    setError('');
    setLoading(mode);
    try {
      let text = '';
      if (mode === 'prompt')    text = await redmineApi.generatePrompt(issue);
      if (mode === 'history')   text = await redmineApi.summarizeHistory(issue);
      if (mode === 'draft')     text = await redmineApi.draftNote(issue);
      if (mode === 'reply')     text = await redmineApi.draftReply(issue);
      if (mode === 'checklist') text = await redmineApi.reviewChecklist(issue);
      if (mode === 'estimate') {
        const c = await redmineApi.assessComplexity(issue);
        setResult({ mode, text: c.reasoning, copied: false, complexity: c });
        return;
      }
      if (mode === 'ambiguities') {
        // Usa cache se disponível — evita chamada duplicada quando veio do alerta automático.
        const cached = getCachedAmbiguities(issue);
        const a = cached ?? await redmineApi.detectAmbiguities(issue);
        if (!cached) setCachedAmbiguities(issue, a);
        setAutoAmbiguity(a);
        setResult({ mode, text: a.hasIssues ? `${a.ambiguities.length} pontos ambíguos` : 'Requisitos claros', copied: false, ambiguities: a });
        return;
      }
      if (mode === 'versionnote') {
        const v = await redmineApi.suggestVersionNote(issue);
        setResult({ mode, text: v.notes.join('\n'), copied: false, versionNote: v });
        return;
      }
      setResult({ mode, text, copied: false });
    } catch (err: unknown) {
      setError(aiErrorMessage(err));
    } finally {
      setLoading(null);
    }
  };

  const copy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text);
    setResult(r => r ? { ...r, copied: true } : r);
    setTimeout(() => setResult(r => r ? { ...r, copied: false } : r), 2000);
  };

  const download = () => {
    if (!result) return;
    const slug = issue.subject.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    const blob = new Blob([result.text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-${issue.id}-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resultTitle: Record<Mode, string> = {
    prompt:    'Prompt gerado por IA',
    history:   'Resumo do histórico',
    draft:     'Rascunho de nota',
    reply:     'Resposta ao cliente',
    checklist: 'Checklist de revisão',
    estimate:     'Complexidade',
    ambiguities:  'Requisitos ambíguos',
    versionnote:  'Nota de versão',
  };

  // ── Botão compacto para o card ────────────────────────────────────────
  if (compact) {
    return (
      <button
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); triggerAIOnOpen(issue.id); onOpen?.(); }}
        disabled={!!loading}
        title="Gerar prompt da tarefa com IA"
        className="flex items-center justify-center w-6 h-6 rounded text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-40"
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
      </button>
    );
  }

  // ── Versão completa (modal) ───────────────────────────────────────────
  return (
    <div className="space-y-2">
      {/* Alerta automático de ambiguidades */}
      {autoLoading && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
          <Loader2 size={11} className="animate-spin text-purple-400" />
          Verificando requisitos…
        </div>
      )}
      {!autoLoading && autoAmbiguity?.hasIssues && result?.mode !== 'ambiguities' && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => runMode('ambiguities')}
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left"
          >
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span>
              <span className="font-semibold">{autoAmbiguity.ambiguities.length} ponto{autoAmbiguity.ambiguities.length !== 1 ? 's' : ''} ambíguo{autoAmbiguity.ambiguities.length !== 1 ? 's' : ''}</span>
              {' '}identificado{autoAmbiguity.ambiguities.length !== 1 ? 's' : ''} nos requisitos — clique para ver
            </span>
          </button>
          <button
            onClick={() => { clearCachedAmbiguities(issue); setAutoAmbiguity(null); runMode('ambiguities'); }}
            title="Reanalisar descartando cache"
            className="p-2 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      )}

      {/* Barra de ações */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mr-0.5">
          IA
        </span>

        {([
          { mode: 'prompt'    as Mode, label: 'Gerar prompt',        icon: <Sparkles size={11} />,       always: true },
          { mode: 'history'   as Mode, label: 'Resumir histórico',   icon: <FileText size={11} />,       always: true },
          { mode: 'draft'     as Mode, label: 'Rascunho de nota',    icon: <NotebookPen size={11} />,    always: true },
          { mode: 'reply'     as Mode, label: 'Resposta ao cliente', icon: <MessageSquare size={11} />,  always: true },
          { mode: 'checklist' as Mode, label: 'Checklist de revisão',icon: <ClipboardCheck size={11} />, always: false },
          { mode: 'estimate'    as Mode, label: 'Complexidade',      icon: <Clock size={11} />,         always: true },
          { mode: 'ambiguities' as Mode, label: 'Req. ambíguos',    icon: <AlertTriangle size={11} />, always: true },
          { mode: 'versionnote' as Mode, label: 'Nota de versão',   icon: <Tag size={11} />,           always: true },
        ] as const)
        .filter(({ always }) => always || issue.status.id === 71)
        .map(({ mode, label, icon }) => {
          const active = result?.mode === mode;
          const busy   = loading === mode;
          return (
            <button
              key={mode}
              onClick={() => runMode(mode)}
              disabled={!!loading && !busy}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-40 ${
                active
                  ? 'bg-purple-100 dark:bg-purple-900/50 border-purple-300 dark:border-purple-700 text-purple-700 dark:text-purple-300'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-purple-300 dark:hover:border-purple-700 hover:text-purple-600 dark:hover:text-purple-400'
              }`}
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : icon}
              {label}
            </button>
          );
        })}
      </div>

      {/* Erro */}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}

      {/* Resultado */}
      {result && result.mode === 'estimate' && result.complexity ? (
        /* Renderer de complexidade qualitativa */
        (() => {
          const c = result.complexity;
          const levelStyle: Record<string, string> = {
            'Baixa':      'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
            'Média':      'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800',
            'Alta':       'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
            'Muito Alta': 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
          };
          const cls = levelStyle[c.level] ?? levelStyle['Média'];
          return (
            <div className="border border-purple-200 dark:border-purple-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
              <div className="flex items-center justify-between px-3 py-2 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-100 dark:border-purple-800">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
                  <Clock size={12} /> Complexidade
                </span>
                <button onClick={() => setResult(null)} className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400">
                  <X size={13} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {/* Nível + esforço bruto */}
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full border ${cls}`}>
                    {c.level}
                  </span>
                  {c.roughHours && (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      Esforço aproximado: <span className="font-medium text-slate-600 dark:text-slate-300">{c.roughHours}</span>
                      <span className="ml-1 opacity-60">(estimativa bruta)</span>
                    </span>
                  )}
                </div>
                {/* Raciocínio */}
                {c.reasoning && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{c.reasoning}</p>
                )}
                {/* Fatores de risco */}
                {c.risks?.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-1">
                    <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">Pontos de atenção</p>
                    {c.risks.map((r, i) => (
                      <p key={i} className="text-xs text-slate-500 dark:text-slate-400 flex gap-1.5">
                        <span className="text-orange-400 flex-shrink-0">⚠</span>{r}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : result?.mode === 'ambiguities' && result.ambiguities ? (
        <div className="border border-purple-200 dark:border-purple-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between px-3 py-2 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-100 dark:border-purple-800">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
              <AlertTriangle size={12} /> Requisitos ambíguos
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { clearCachedAmbiguities(issue); setAutoAmbiguity(null); setResult(null); runMode('ambiguities'); }}
                title="Reanalisar descartando cache"
                className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors"
              >
                <RotateCcw size={11} /> Reanalisar
              </button>
              <button onClick={() => setResult(null)} className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400">
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="p-4">
            {!result.ambiguities.hasIssues ? (
              <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                <Check size={14} /> Requisitos claros — nenhum ponto ambíguo identificado.
              </p>
            ) : (
              <div className="space-y-3">
                {result.ambiguities.ambiguities.map((a, i) => (
                  <div key={i} className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 space-y-1.5 bg-amber-50/50 dark:bg-amber-900/10">
                    <p className="text-xs font-mono text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded">
                      "{a.trecho}"
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300"><span className="font-semibold">Problema:</span> {a.problema}</p>
                    <p className="text-xs text-blue-600 dark:text-blue-400 flex gap-1.5">
                      <span className="font-semibold flex-shrink-0">Perguntar:</span> {a.pergunta}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : result?.mode === 'versionnote' && result.versionNote ? (
        <div className="border border-purple-200 dark:border-purple-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900">
          <div className="flex items-center justify-between px-3 py-2 bg-purple-50 dark:bg-purple-900/30 border-b border-purple-100 dark:border-purple-800">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300">
              <Tag size={12} /> Nota de versão sugerida
            </span>
            <div className="flex items-center gap-1">
              <button onClick={copy} className="flex items-center gap-1 px-2 py-1 text-xs bg-white dark:bg-slate-800 border border-purple-200 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/40 text-purple-600 dark:text-purple-400 transition-colors">
                {result.copied ? <Check size={11} /> : <Copy size={11} />}
                {result.copied ? 'Copiado!' : 'Copiar'}
              </button>
              <button onClick={() => setResult(null)} className="p-1 text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400">
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="p-4 space-y-2">
            {result.versionNote.notes.length === 0 ? (
              <p className="text-xs text-slate-400">Não foi possível extrair o padrão da descrição.</p>
            ) : result.versionNote.notes.map((note, i) => (
              <div key={i} className="group flex items-start gap-2">
                <code className="flex-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 font-mono text-slate-700 dark:text-slate-300 leading-relaxed">{note}</code>
                <button
                  onClick={() => { navigator.clipboard.writeText(note); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  title="Copiar esta nota"
                >
                  <Copy size={11} />
                </button>
              </div>
            ))}
            {result.versionNote.reasoning && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
                {result.versionNote.reasoning}
              </p>
            )}
          </div>
        </div>
      ) : result ? (
        <ResultPanel
          title={resultTitle[result.mode]}
          text={result.text}
          copied={result.copied}
          onCopy={copy}
          onClose={() => setResult(null)}
          onDownload={result.mode === 'prompt' ? download : undefined}
          onInsert={(result.mode === 'draft' || result.mode === 'reply') && onInsertNote
            ? () => { onInsertNote(result.text); setResult(null); }
            : undefined
          }
        />
      ) : null}
    </div>
  );
}
