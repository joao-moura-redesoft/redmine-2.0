import axios from 'axios';
import { getEffectiveCreds, hasEffectiveCreds } from '../utils/adConfig';

export interface WikiSearchResult {
  id: string;
  title: string;
  namespace: string;
  snippet: string;
  score: number;
  mtime: number;
}

export interface WikiPageContent {
  id: string;
  html: string;
}

export function isWikiAvailable(): boolean {
  return hasEffectiveCreds();
}

const wikiAxios = axios.create({ baseURL: '/' });

wikiAxios.interceptors.request.use(cfg => {
  const creds = getEffectiveCreds();
  if (creds) {
    cfg.headers['x-redmine-user'] = creds.username;
    cfg.headers['x-redmine-pass'] = creds.password;
  }
  return cfg;
});

export const wikiApi = {
  search: (q: string): Promise<WikiSearchResult[]> =>
    wikiAxios.get('/api/wiki/search', { params: { q } }).then(r => r.data.results),

  getPage: (id: string): Promise<WikiPageContent> =>
    wikiAxios.get('/api/wiki/page', { params: { id } }).then(r => r.data),

  pageUrl: (id: string) =>
    `https://wiki.redesoft.com.br/doku.php?id=${encodeURIComponent(id)}`,
};
