import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Attachment } from '../types/redmine';

marked.setOptions({ breaks: true, gfm: true });

interface Props {
  text: string;
  attachments?: Attachment[];
  className?: string;
}

// Sintaxe de imagem do Redmine (Textile): !arquivo.png!, !>img.png!, !{width:300px}img.png!, !http://.../x.png!
const IMG_RE = /!(?:\{[^}]*\}|[<>=])*([^!\s]+?\.(?:png|jpe?g|gif|webp|svg|bmp))!/gi;

function preprocess(text: string, attachments?: Attachment[]): string {
  if (!text) return '';
  const byName = new Map<string, Attachment>();
  (attachments ?? []).forEach(a => { if (!byName.has(a.filename)) byName.set(a.filename, a); });

  return text.replace(IMG_RE, (match, file: string) => {
    // URL externa → usa direto
    if (/^https?:\/\//i.test(file)) return `![imagem](${file})`;
    // O texto pode vir URL-encodado (ex: %20 = espaço). Tenta casar pelo nome
    // decodificado e pelo cru, contra os nomes reais dos anexos.
    let decoded = file;
    try { decoded = decodeURIComponent(file); } catch { /* mantém */ }
    const att = byName.get(decoded) || byName.get(file);
    if (att) return `![${att.filename}](/api/attachments/${att.id}/${encodeURIComponent(att.filename)})`;
    return match; // não encontrou anexo: deixa como está
  });
}

export function Markdown({ text, attachments, className = '' }: Props) {
  const html = useMemo(() => {
    const pre = preprocess(text, attachments);
    const raw = marked.parse(pre, { async: false }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
  }, [text, attachments]);

  return (
    <div
      className={`prose-redmine ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
