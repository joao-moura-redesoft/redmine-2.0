import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Attachment } from '../types/redmine';
import { attachmentUrl } from '../api/redmine';
import { textileToMarkdown } from '../utils/textileToMarkdown';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  text: string;
  attachments?: Attachment[];
  className?: string;
  /** Converte o texto de Textile (formato do Redmine) para Markdown antes de renderizar */
  textile?: boolean;
}

// Sintaxe de imagem do Redmine (Textile): !arquivo.png!, !>img.png!, !{width:300px}img.png!, !http://.../x.png!
const IMG_RE = /!(?:\{[^}]*\}|[<>=])*([^!\s]+?\.(?:png|jpe?g|gif|webp|svg|bmp))!/gi;

// Nomes de arquivos que o Markdown renderiza inline (sintaxe Textile de imagem).
// Usado para evitar duplicar previews de anexos que já aparecem na nota.
export function inlineImageNames(text?: string): Set<string> {
  const names = new Set<string>();
  if (!text) return names;
  for (const m of text.matchAll(IMG_RE)) {
    const file = m[1];
    if (/^https?:\/\//i.test(file)) continue; // URL externa, não é anexo
    names.add(file);
    try {
      names.add(decodeURIComponent(file));
    } catch {
      /* mantém */
    }
  }
  return names;
}

function preprocess(text: string, attachments?: Attachment[]): string {
  if (!text) return '';
  const byName = new Map<string, Attachment>();
  (attachments ?? []).forEach((a) => {
    if (!byName.has(a.filename)) byName.set(a.filename, a);
  });

  return text.replace(IMG_RE, (match, file: string) => {
    // URL externa → usa direto
    if (/^https?:\/\//i.test(file)) return `![imagem](${file})`;
    // O texto pode vir URL-encodado (ex: %20 = espaço). Tenta casar pelo nome
    // decodificado e pelo cru, contra os nomes reais dos anexos.
    let decoded = file;
    try {
      decoded = decodeURIComponent(file);
    } catch {
      /* mantém */
    }
    const att = byName.get(decoded) || byName.get(file);
    if (att) return `![${att.filename}](${attachmentUrl(att.id, att.filename)})`;
    return match; // não encontrou anexo: deixa como está
  });
}

export function Markdown({ text, attachments, className = '', textile = false }: Props) {
  const html = useMemo(() => {
    const src = textile ? textileToMarkdown(text) : text;
    const pre = preprocess(src, attachments);
    const raw = marked.parse(pre, { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  }, [text, attachments, textile]);

  return (
    <div className={`prose-redmine ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
