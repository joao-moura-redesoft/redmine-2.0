import axios from 'axios';

export interface DriveEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
  mime: string;
  etag: string;
  fileId?: string;
  hasPreview: boolean;
  favorite?: boolean;
  // Presentes nas visões de compartilhamento:
  sharedWith?: string;
  sharedBy?: string;
  shareUrl?: string;
}

export interface DriveQuota {
  used: number;
  available: number;
}

const api = axios.create({ baseURL: '/api/drive' });

export async function listDir(path: string): Promise<{ path: string; entries: DriveEntry[] }> {
  const { data } = await api.get('/list', { params: { path } });
  return data;
}

export async function fetchQuota(): Promise<DriveQuota> {
  const { data } = await api.get<DriveQuota>('/quota');
  return data;
}

// Busca global recursiva por nome em todo o Drive do usuário.
export async function searchDrive(q: string): Promise<DriveEntry[]> {
  const { data } = await api.get<DriveEntry[]>('/search', { params: { q } });
  return data;
}

// ─── Visões inteligentes ─────────────────────────────────────────────────────
export async function fetchFavorites(): Promise<DriveEntry[]> {
  const { data } = await api.get<DriveEntry[]>('/favorites');
  return data;
}
export async function fetchRecent(): Promise<DriveEntry[]> {
  const { data } = await api.get<DriveEntry[]>('/recent');
  return data;
}
export async function fetchSharedView(type: 'in' | 'out' | 'link'): Promise<DriveEntry[]> {
  const { data } = await api.get<DriveEntry[]>('/shared-view', { params: { type } });
  return data;
}
export async function setFavorite(path: string, favorite: boolean): Promise<void> {
  await api.post('/favorite', { path, favorite });
}

export async function makeFolder(path: string): Promise<void> {
  await api.post('/folder', { path });
}

export async function deleteItem(path: string): Promise<void> {
  await api.delete('/item', { params: { path } });
}

export async function moveItem(from: string, to: string): Promise<void> {
  await api.post('/move', { from, to });
}

export async function uploadToDrive(
  dir: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await api.put('/upload', file, {
    params: { path: dir },
    headers: {
      'x-filename': encodeURIComponent(file.name),
      'x-content-type': file.type || 'application/octet-stream',
      'Content-Type': file.type || 'application/octet-stream',
    },
    onUploadProgress: (e: { loaded: number; total?: number }) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
  });
}

// Busca o conteúdo do arquivo como Blob (para pré-visualização autenticada).
export async function fetchDriveBlob(path: string): Promise<Blob> {
  const r = await fetch(`/api/drive/download?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error('fetch failed');
  return r.blob();
}

// Baixa via fetch (precisa de headers de auth) e dispara o download no navegador.
export async function downloadDriveFile(path: string): Promise<void> {
  const name = path.split('/').pop() || 'arquivo';
  const r = await fetch(`/api/drive/download?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error('download failed');
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function copyItem(from: string, to: string): Promise<void> {
  await api.post('/copy', { from, to });
}

// Anexa um arquivo do Drive diretamente numa tarefa do Redmine (o servidor faz
// a ponte; o arquivo não passa pelo navegador). `comment` opcional vira nota.
export async function attachToIssue(
  path: string,
  issueId: number,
  comment?: string,
): Promise<{ success: boolean; filename: string; issueId: number }> {
  const { data } = await api.post('/attach-to-issue', { path, issueId, comment });
  return data;
}

// ─── Compartilhamento ──────────────────────────────────────────────────────────
export interface DriveShare {
  id: number;
  share_type: number; // 3 = link público, 0 = usuário
  share_with?: string;
  share_with_displayname?: string;
  url?: string;
  token?: string;
}

export async function listShares(path: string): Promise<DriveShare[]> {
  const { data } = await api.get<DriveShare[]>('/shares', { params: { path } });
  return data;
}
export async function createShare(
  path: string,
  shareType: number,
  shareWith?: string,
): Promise<DriveShare> {
  const { data } = await api.post<DriveShare>('/share', { path, shareType, shareWith });
  return data;
}
export async function removeShare(id: number): Promise<void> {
  await api.delete(`/share/${id}`);
}

// ─── Lixeira ────────────────────────────────────────────────────────────────────
export interface TrashItem {
  href: string;
  name: string;
  originalLocation: string;
  deletedAt: number;
  isDir: boolean;
  size: number;
  mime: string;
}
export async function listTrash(): Promise<TrashItem[]> {
  const { data } = await api.get<TrashItem[]>('/trash');
  return data;
}
export async function restoreTrash(href: string): Promise<void> {
  await api.post('/trash/restore', { href });
}
export async function deleteTrashItem(href: string): Promise<void> {
  const id = href.split('/').filter(Boolean).pop();
  await api.delete('/trash/item', { params: { id } });
}
export async function emptyTrash(): Promise<void> {
  await api.delete('/trash');
}

// Busca o thumbnail (com headers de auth) e devolve um object URL.
export async function fetchThumb(entry: DriveEntry, size = 128): Promise<string | null> {
  const params = new URLSearchParams({ size: String(size) });
  if (entry.fileId) params.set('fileId', entry.fileId);
  if (entry.path) params.set('path', entry.path);
  const r = await fetch(`/api/drive/thumb?${params}`);
  if (!r.ok) return null;
  return URL.createObjectURL(await r.blob());
}
