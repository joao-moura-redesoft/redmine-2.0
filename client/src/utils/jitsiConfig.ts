// Configuração da integração com Jitsi Meet (War Room).
// O domínio é configurável via localStorage para facilitar testes/ambientes,
// mas o padrão é o servidor da B2Click.

const DOMAIN_KEY = 'rk_jitsi_domain';
const DEFAULT_DOMAIN = 'meet.b2click.com';

// Prefixo usado nas salas para evitar colisão com outras instâncias do Jitsi.
const ROOM_PREFIX = 'B2Click';

export function getJitsiDomain(): string {
  try {
    const v = localStorage.getItem(DOMAIN_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_DOMAIN;
}

export function setJitsiDomain(domain: string) {
  localStorage.setItem(DOMAIN_KEY, domain.trim());
}

// Sala dinâmica de uma tarefa: B2Click-Issue-90688
export function makeTaskRoom(issueId: number): string {
  return `${ROOM_PREFIX}-Issue-${issueId}`;
}

// Sala fixa da daily / standup
export const DAILY_ROOM = `${ROOM_PREFIX}-Daily-Standup`;

// Sala de uma conversa do Talk: B2Click-Talk-<token sanitizado>
export function makeTalkRoom(token: string): string {
  return `${ROOM_PREFIX}-Talk-${sanitizeRoom(token)}`;
}

// URL completa de uma sala (para enviar no chat como link de entrada).
export function jitsiRoomUrl(room: string): string {
  return `https://${getJitsiDomain()}/${room}`;
}

// Extrai o nome da sala de uma URL/texto de chamada do Talk (ou null).
export function callRoomFromText(text: string): string | null {
  const m = /(?:https?:\/\/[^\s/]+\/)?(B2Click-Talk-[A-Za-z0-9_-]+)/.exec(text);
  return m ? m[1] : null;
}

// Extrai o id da tarefa a partir do nome de uma sala de tarefa (ou null).
export function issueIdFromRoom(room: string): number | null {
  const m = /^B2Click-Issue-(\d+)$/.exec(room);
  return m ? Number(m[1]) : null;
}

// Sanitiza um nome livre para um nome de sala Jitsi válido (sem espaços/acentos).
export function sanitizeRoom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-zA-Z0-9-_]/g, '-') // demais caracteres viram hífen
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Sala avulsa (não vinculada a tarefa): B2Click-Sala-<slug | aleatório>
export function makeAdHocRoom(name?: string): string {
  const slug = name ? sanitizeRoom(name) : '';
  return slug
    ? `${ROOM_PREFIX}-Sala-${slug}`
    : `${ROOM_PREFIX}-Sala-${Math.random().toString(36).slice(2, 8)}`;
}
