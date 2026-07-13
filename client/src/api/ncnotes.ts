import axios from 'axios';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { Note } from './notes';

// Notas do Nextcloud (app QuickNotes) — sempre com source:'nextcloud'. Reutiliza o
// shape de Note para poder mesclar na mesma lista/UI das notas locais (ver useNcNotes).
// `ncColor` guarda a cor real (hex) do QuickNotes; `body` é markdown (convertido do HTML).
export type NcNote = Note & {
  source: 'nextcloud';
  ncId: number | null;
  ncColor?: string | null;
};

// Client próprio (como em api/talk.ts e api/drive.ts): NÃO usa createAuthedClient,
// cujo interceptor dispara logout global em qualquer 401. Aqui o 401 é esperado para
// quem não vinculou o Nextcloud — não deve deslogar do Redmine. Cookies de sessão
// viajam por serem mesma-origem.
const api = axios.create({ baseURL: '/api', withCredentials: true });

// ─── Conversão HTML ↔ Markdown ──────────────────────────────────────────────────
// O QuickNotes guarda `content` como HTML; nosso editor (tiptap) trabalha com
// markdown. Convertemos na fronteira: HTML→markdown ao ler, markdown→HTML ao salvar.

// markdown → HTML (mesmo padrão de AssistantView/Markdown.tsx: marked + sanitização).
function markdownToHtml(md: string): string {
  const raw = marked.parse(md || '', { async: false }) as string;
  return DOMPurify.sanitize(raw);
}

// HTML → markdown percorrendo o DOM. Cobre o que o QuickNotes gera e mais: negrito,
// itálico, tachado, código, links, imagens, títulos, listas (aninhadas), citação,
// regra horizontal e tabelas (GFM). Limitação conhecida: cor de texto/realce inline
// (span com style) não tem equivalente em markdown e é descartada (o texto é mantido).
function htmlToMarkdown(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const INDENT = '  ';

  function kidsOf(el: Element): string {
    return Array.from(el.childNodes).map(walk).join('');
  }

  // Lista (recursiva) com indentação para sublistas.
  function listToMd(el: Element, ordered: boolean, depth: number): string {
    const items = Array.from(el.children).filter((c) => c.tagName === 'LI');
    return items
      .map((li, i) => {
        let inline = '';
        let sub = '';
        li.childNodes.forEach((ch) => {
          if (ch.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((ch as Element).tagName)) {
            sub += `\n${listToMd(ch as Element, (ch as Element).tagName === 'OL', depth + 1)}`;
          } else {
            inline += walk(ch);
          }
        });
        const marker = ordered ? `${i + 1}.` : '-';
        return `${INDENT.repeat(depth)}${marker} ${inline.trim()}${sub}`;
      })
      .join('\n');
  }

  // Tabela → GFM. Sem <thead>, a 1ª linha vira o cabeçalho.
  function tableToMd(table: Element): string {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const cells = (tr: Element) =>
      Array.from(tr.children).map((td) => walk(td).trim().replace(/\n+/g, ' '));
    const header = cells(rows[0]);
    const line = (c: string[]) => `| ${c.join(' | ')} |`;
    const sep = line(header.map(() => '---'));
    const body = rows.slice(1).map((r) => line(cells(r)));
    return [line(header), sep, ...body].join('\n');
  }

  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    switch (el.tagName) {
      case 'BR':
        return '\n';
      case 'HR':
        return '\n---\n\n';
      case 'P':
      case 'DIV':
        return `${kidsOf(el)}\n\n`;
      case 'STRONG':
      case 'B':
        return `**${kidsOf(el)}**`;
      case 'EM':
      case 'I':
        return `*${kidsOf(el)}*`;
      case 'S':
      case 'DEL':
      case 'STRIKE':
        return `~~${kidsOf(el)}~~`;
      case 'CODE':
        return `\`${kidsOf(el)}\``;
      case 'PRE':
        return `\n\`\`\`\n${el.textContent || ''}\n\`\`\`\n\n`;
      case 'A': {
        const href = el.getAttribute('href') || '';
        const text = kidsOf(el);
        return href ? `[${text}](${href})` : text;
      }
      case 'IMG': {
        const src = el.getAttribute('src') || '';
        return src ? `![${el.getAttribute('alt') || ''}](${src})` : '';
      }
      case 'H1':
        return `# ${kidsOf(el)}\n\n`;
      case 'H2':
        return `## ${kidsOf(el)}\n\n`;
      case 'H3':
        return `### ${kidsOf(el)}\n\n`;
      case 'H4':
      case 'H5':
      case 'H6':
        return `#### ${kidsOf(el)}\n\n`;
      case 'BLOCKQUOTE':
        return `${kidsOf(el)
          .trim()
          .split('\n')
          .map((l) => (l ? `> ${l}` : '>'))
          .join('\n')}\n\n`;
      case 'UL':
      case 'OL':
        return `${listToMd(el, el.tagName === 'OL', 0)}\n\n`;
      case 'LI':
        return kidsOf(el);
      case 'TABLE':
        return `${tableToMd(el)}\n\n`;
      default:
        return kidsOf(el);
    }
  }

  return walk(doc.body)
    .replace(/\n{3,}/g, '\n\n') // colapsa linhas em branco excessivas
    .trim();
}

// ─── API ─────────────────────────────────────────────────────────────────────────
export async function fetchNcNotes(): Promise<NcNote[]> {
  const { data } = await api.get<NcNote[]>('/ncnotes');
  // Converte o HTML do QuickNotes para markdown (o backend entrega `body` em HTML).
  return data.map((n) => ({ ...n, body: htmlToMarkdown(n.body) }));
}

// Campos editáveis de uma nota do QuickNotes pela nossa UI.
export type NcPatch = {
  title?: string;
  body?: string; // markdown — convertido para HTML antes de enviar
  pinned?: boolean;
  ncColor?: string; // cor hex do QuickNotes
  tags?: string[]; // nomes; o servidor cria/associa por nome
};

// Atualiza título/corpo/pino/cor/tags. O corpo (markdown) vira HTML antes de ir.
export async function updateNcNote(ncId: number, patch: NcPatch): Promise<NcNote> {
  const payload: {
    title?: string;
    content?: string;
    pinned?: boolean;
    color?: string;
    tags?: string[];
  } = {};
  if (patch.title !== undefined) payload.title = patch.title;
  if (patch.body !== undefined) payload.content = markdownToHtml(patch.body);
  if (patch.pinned !== undefined) payload.pinned = patch.pinned;
  if (patch.ncColor !== undefined) payload.color = patch.ncColor;
  if (patch.tags !== undefined) payload.tags = patch.tags;
  const { data } = await api.put<NcNote>(`/ncnotes/${ncId}`, payload);
  return { ...data, body: htmlToMarkdown(data.body) };
}

export async function deleteNcNote(ncId: number): Promise<void> {
  await api.delete(`/ncnotes/${ncId}`);
}

// Bridge: cria uma nota no Nextcloud a partir de uma nota local (markdown → HTML).
export async function pushNoteToNc(title: string, body: string): Promise<NcNote> {
  const { data } = await api.post<NcNote>('/ncnotes/from-local', {
    title,
    content: markdownToHtml(body),
  });
  return { ...data, body: htmlToMarkdown(data.body) };
}
