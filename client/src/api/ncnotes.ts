import axios from 'axios';
import type { Note } from './notes';
import { htmlToMarkdown, markdownToHtml } from '../utils/ncNoteHtml';

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

// Campos editáveis de uma nota do QuickNotes pela nossa UI.
export type NcPatch = {
  title?: string;
  body?: string; // markdown — convertido para HTML antes de enviar
  pinned?: boolean;
  ncColor?: string; // cor hex do QuickNotes
  tags?: string[]; // nomes; o servidor cria/associa por nome
};

// ─── API ─────────────────────────────────────────────────────────────────────────
export async function fetchNcNotes(): Promise<NcNote[]> {
  const { data } = await api.get<NcNote[]>('/ncnotes');
  // Converte o HTML do QuickNotes para markdown (o backend entrega `body` em HTML).
  return data.map((n) => ({ ...n, body: htmlToMarkdown(n.body) }));
}

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
