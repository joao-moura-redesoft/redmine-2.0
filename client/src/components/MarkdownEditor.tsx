import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Heading2, List, Code, Link2, Eye, Pencil } from 'lucide-react';
import { Markdown } from './Markdown';
import type { Attachment } from '../types/redmine';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Ctrl+Enter dispara este callback (ex: salvar) */
  onSubmit?: () => void;
  attachments?: Attachment[];
  placeholder?: string;
  autoFocus?: boolean;
  minHeight?: number;
}

/**
 * Editor de Markdown reutilizável: barra de formatação + textarea + prévia.
 * É controlado (value/onChange). O texto é Markdown; quem usa decide se converte
 * de/para Textile nas bordas (ex: markdownToTextile ao salvar no Redmine).
 */
export function MarkdownEditor({
  value,
  onChange,
  onSubmit,
  attachments,
  placeholder = 'Escreva em Markdown…',
  autoFocus,
  minHeight = 140,
}: Props) {
  const [preview, setPreview] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && !preview) taRef.current?.focus();
  }, [autoFocus, preview]);

  // Insere markdown ao redor da seleção
  const surround = (pre: string, post: string, ph: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart,
      e = ta.selectionEnd;
    const sel = value.slice(s, e) || ph;
    const next = value.slice(0, s) + pre + sel + post + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + pre.length;
      ta.selectionEnd = s + pre.length + sel.length;
    });
  };

  // Adiciona prefixo no início da linha do cursor
  const prefixLine = (prefix: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
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
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-slate-700">
        {tools.map((t) => (
          <button
            key={t.title}
            type="button"
            onClick={t.action}
            title={t.title}
            className="p-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700"
          >
            <t.icon size={14} />
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          title={preview ? 'Editar' : 'Pré-visualizar'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${preview ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
        >
          {preview ? <Pencil size={12} /> : <Eye size={12} />}
          {preview ? 'Editar' : 'Prévia'}
        </button>
      </div>

      {/* Corpo: editor ou prévia */}
      {preview ? (
        <div
          className="px-3 py-2 overflow-y-auto scrollbar-thin"
          style={{ minHeight, maxHeight: 360 }}
        >
          {value.trim() ? (
            <Markdown text={value} attachments={attachments} className="text-sm" />
          ) : (
            <p className="text-sm text-slate-300 italic">Nada para pré-visualizar.</p>
          )}
        </div>
      ) : (
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (onSubmit && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          style={{ minHeight }}
          className="w-full text-sm px-3 py-2 resize-y focus:outline-none bg-transparent text-slate-800 dark:text-slate-100 placeholder-slate-400"
        />
      )}
    </div>
  );
}
