import { useState, useRef, useEffect } from 'react';
import {
  Bold,
  Italic,
  Heading2,
  List,
  Code,
  Link2,
  Paperclip,
  Send,
  X,
  Eye,
  Pencil,
  AtSign,
  Sparkles,
  Loader2,
  FileText,
} from 'lucide-react';
import { Markdown } from './Markdown';
import { redmineApi } from '../api/redmine';
import { getAIKey } from '../utils/aiConfig';
import { useTemplates } from '../utils/templates';

interface Member {
  id: number;
  name: string;
}

interface Props {
  onSubmit: (text: string, files: File[]) => void;
  sending?: boolean;
  draftKey?: string;
  members?: Member[];
  injectText?: string;
  /** Contexto da issue para o "Revisar com IA" */
  aiContext?: { subject: string; statusName: string };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Nome decente pra screenshot colada (o clipboard entrega "image.png" genérico).
function screenshotName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `screenshot-${stamp}-${Math.random().toString(36).slice(2, 5)}.${ext}`;
}

// Renomeia imagens sem nome real (coladas) pra algo identificável; mantém o resto.
function normalizeFile(f: File): File {
  if (f.type.startsWith('image/') && (!f.name || /^image\.(png|jpe?g|webp|gif)$/i.test(f.name))) {
    const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return new File([f], screenshotName(ext), { type: f.type });
  }
  return f;
}

// Detecta uma menção sendo digitada (@parcial) imediatamente antes do cursor
function detectMention(value: string, caret: number): { query: string; start: number } | null {
  const upto = value.slice(0, caret);
  const m = upto.match(/(^|\s)@([\p{L}0-9._-]*)$/u);
  if (!m) return null;
  return { query: m[2], start: caret - m[2].length - 1 };
}

export function CommentComposer({
  onSubmit,
  sending,
  draftKey,
  members = [],
  injectText,
  aiContext,
}: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [midx, setMidx] = useState(0);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const templates = useTemplates();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Insere um texto no ponto do cursor (usado pelos templates).
  const insertText = (str: string) => {
    const ta = taRef.current;
    if (!ta) {
      setText((t) => t + str);
      return;
    }
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    setText(text.slice(0, s) + str + text.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + str.length;
    });
  };

  const storageKey = draftKey ? `rk_draft_${draftKey}` : null;

  // Carrega rascunho ao abrir (por tarefa)
  useEffect(() => {
    if (!storageKey) return;
    try {
      const d = localStorage.getItem(storageKey);
      setText(d ?? '');
    } catch {
      /* ignore */
    }
    setFiles([]);
    setPreview(false);
    setMention(null);
  }, [storageKey]);

  // Injeta texto externo (ex: rascunho gerado por IA) quando prop muda
  useEffect(() => {
    if (!injectText) return;
    setText(injectText);
    setPreview(false);
    setTimeout(() => taRef.current?.focus(), 50);
  }, [injectText]);

  // Salva rascunho a cada mudança (limpa quando vazio)
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (text.trim()) localStorage.setItem(storageKey, text);
      else localStorage.removeItem(storageKey);
    } catch {
      /* quota */
    }
  }, [text, storageKey]);

  const mentionMatches = mention
    ? members.filter((m) => m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  // Auto-resize do textarea
  useEffect(() => {
    const ta = taRef.current;
    if (ta && !preview) {
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 260)}px`;
    }
  }, [text, preview]);

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list).map(normalizeFile);
    if (arr.length) setFiles((f) => [...f, ...arr]);
  };
  const removeFile = (i: number) => setFiles((f) => f.filter((_, idx) => idx !== i));

  // Miniaturas (object URLs) das imagens anexadas — recria e revoga ao mudar.
  const [imgUrls, setImgUrls] = useState<(string | null)[]>([]);
  useEffect(() => {
    const urls = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null));
    setImgUrls(urls);
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
  }, [files]);

  const submit = () => {
    if ((!text.trim() && files.length === 0) || sending) return;
    onSubmit(text.trim(), files);
    setText('');
    setFiles([]);
    setPreview(false);
    setMention(null);
    if (storageKey) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
  };

  // Insere "@Nome " no lugar da menção em digitação
  const insertMention = (name: string) => {
    const ta = taRef.current;
    if (!mention || !ta) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(ta.selectionStart);
    const insert = `@${name} `;
    const next = before + insert + after;
    setText(next);
    setMention(null);
    const pos = before.length + insert.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  // Insere markdown ao redor da seleção
  const surround = (pre: string, post: string, placeholder: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart,
      e = ta.selectionEnd;
    const sel = text.slice(s, e) || placeholder;
    const next = text.slice(0, s) + pre + sel + post + text.slice(e);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + pre.length;
      ta.selectionEnd = s + pre.length + sel.length;
    });
  };
  // Adiciona prefixo no início da linha
  const prefixLine = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = text.lastIndexOf('\n', s - 1) + 1;
    const next = text.slice(0, lineStart) + prefix + text.slice(lineStart);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
    });
  };

  const tools = [
    { icon: Bold, title: 'Negrito', action: () => surround('**', '**', 'negrito') },
    { icon: Italic, title: 'Itálico', action: () => surround('_', '_', 'itálico') },
    { icon: Heading2, title: 'Título', action: () => prefixLine('## ') },
    { icon: List, title: 'Lista', action: () => prefixLine('- ') },
    { icon: Code, title: 'Código', action: () => surround('`', '`', 'código') },
    { icon: Link2, title: 'Link', action: () => surround('[', '](url)', 'texto') },
  ];

  return (
    <div
      className={`border rounded-lg bg-white transition-colors ${dragOver ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-200'}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100">
        {tools.map((t) => (
          <button
            key={t.title}
            type="button"
            onClick={t.action}
            title={t.title}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <t.icon size={14} />
          </button>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Anexar arquivo"
          className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <Paperclip size={14} />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setTplOpen((v) => !v)}
            title="Templates"
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <FileText size={14} />
          </button>
          {tplOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setTplOpen(false)} />
              <div className="absolute z-20 top-full mt-1 left-0 w-56 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-xl py-1 scrollbar-thin">
                {templates.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Nenhum template ainda.</p>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        insertText(t.body);
                        setTplOpen(false);
                      }}
                      title={t.body}
                      className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50 truncate"
                    >
                      {t.name}
                    </button>
                  ))
                )}
                <div className="border-t border-slate-100 my-1" />
                <button
                  type="button"
                  onClick={() => {
                    setTplOpen(false);
                    window.dispatchEvent(new CustomEvent('bluemine:manage-templates'));
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50"
                >
                  Gerenciar templates…
                </button>
              </div>
            </>
          )}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          title={preview ? 'Editar' : 'Pré-visualizar'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${preview ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}
        >
          {preview ? <Pencil size={12} /> : <Eye size={12} />}
          {preview ? 'Editar' : 'Prévia'}
        </button>
      </div>

      {/* Corpo: editor ou prévia */}
      {preview ? (
        <div className="px-3 py-2 min-h-16 max-h-64 overflow-y-auto">
          {text.trim() ? (
            <Markdown text={text} className="text-sm" />
          ) : (
            <p className="text-sm text-slate-300 italic">Nada para pré-visualizar.</p>
          )}
        </div>
      ) : (
        <div className="relative">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMidx(0);
              setMention(
                members.length ? detectMention(e.target.value, e.target.selectionStart) : null,
              );
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.items)
                .filter((i) => i.type.startsWith('image/'))
                .map((i) => i.getAsFile())
                .filter((f): f is File => !!f);
              if (imgs.length) {
                e.preventDefault();
                addFiles(imgs);
              }
            }}
            onKeyDown={(e) => {
              if (mention && mentionMatches.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMidx((i) => Math.min(i + 1, mentionMatches.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMidx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  insertMention(mentionMatches[midx].name);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Escreva em Markdown… (@ menciona alguém · convertido para o Redmine ao enviar)"
            rows={2}
            className="w-full text-sm px-3 py-2 resize-none focus:outline-none bg-transparent"
          />
          {mention && mentionMatches.length > 0 && (
            <div className="absolute left-2 bottom-1 z-10 w-56 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
              <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400 border-b border-slate-100 flex items-center gap-1">
                <AtSign size={10} /> Mencionar
              </p>
              {mentionMatches.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseEnter={() => setMidx(i)}
                  onClick={() => insertMention(m.name)}
                  className={`w-full text-left px-3 py-1.5 text-sm truncate ${i === midx ? 'bg-blue-50 text-blue-700' : 'text-slate-700'}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Anexos — miniatura pra imagens, chip pro resto */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
          {files.map((f, i) => {
            const url = imgUrls[i];
            if (url) {
              return (
                <div
                  key={i}
                  className="relative group/att w-16 h-16 rounded-lg overflow-hidden border border-slate-200"
                  title={`${f.name} · ${fmtSize(f.size)}`}
                >
                  <img src={url} alt={f.name} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeFile(i)}
                    title="Remover"
                    className="absolute top-0.5 right-0.5 bg-black/50 hover:bg-black/75 text-white rounded p-0.5 opacity-0 group-hover/att:opacity-100 transition-opacity"
                  >
                    <X size={11} />
                  </button>
                  <span className="absolute bottom-0 inset-x-0 bg-black/40 text-white text-[9px] px-1 py-0.5 truncate">
                    {fmtSize(f.size)}
                  </span>
                </div>
              );
            }
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 rounded-md pl-2 pr-1 py-1"
              >
                <Paperclip size={12} />
                <span className="max-w-40 truncate">{f.name}</span>
                <span className="text-slate-400">{fmtSize(f.size)}</span>
                <button
                  onClick={() => removeFile(i)}
                  className="text-slate-400 hover:text-red-500 ml-0.5"
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Feedback de revisão por IA */}
      {aiFeedback && (
        <div className="mx-3 mb-2 flex items-start gap-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg px-3 py-2 text-xs text-purple-700 dark:text-purple-300">
          <Sparkles size={12} className="mt-0.5 flex-shrink-0 text-purple-500" />
          <span className="flex-1 whitespace-pre-wrap">{aiFeedback}</span>
          <button
            onClick={() => setAiFeedback(null)}
            className="text-purple-400 hover:text-purple-600 flex-shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Rodapé */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 dark:border-slate-700 gap-2">
        <span className="text-[11px] text-slate-400 hidden sm:block">
          {dragOver ? 'Solte para anexar' : 'Markdown · Ctrl+Enter envia · cole ou arraste imagens'}
        </span>
        <div className="flex items-center gap-2 ml-auto">
          {/* Revisar com IA — só aparece quando há texto e AI configurada */}
          {aiContext && getAIKey() && text.trim().length > 20 && (
            <button
              type="button"
              onClick={async () => {
                setAiReviewing(true);
                setAiFeedback(null);
                try {
                  const fb = await redmineApi.reviewNote(
                    text,
                    aiContext.subject,
                    aiContext.statusName,
                  );
                  setAiFeedback(fb);
                } catch {
                  setAiFeedback('Não foi possível revisar a nota agora.');
                } finally {
                  setAiReviewing(false);
                }
              }}
              disabled={aiReviewing}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/30 disabled:opacity-40 transition-colors"
            >
              {aiReviewing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} />
              )}
              {aiReviewing ? 'Revisando…' : 'Revisar com IA'}
            </button>
          )}
          <button
            onClick={submit}
            disabled={(!text.trim() && files.length === 0) || sending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Send size={14} />
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
