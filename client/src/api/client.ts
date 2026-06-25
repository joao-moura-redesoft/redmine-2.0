import axios, { type AxiosInstance } from 'axios';
import { getStoredAuth } from './redmine';

// Cliente axios com baseURL /api e injeção do header de auth do Redmine
// (chave ou usuário/senha). Centraliza o interceptor antes duplicado em cada
// módulo de API (notes, sprints, boards…).
export function createAuthedClient(): AxiosInstance {
  const api = axios.create({ baseURL: '/api' });
  api.interceptors.request.use(config => {
    const auth = getStoredAuth();
    if (auth) {
      config.headers['X-Redmine-Url'] = auth.url;
      if (auth.apiKey) {
        config.headers['X-Redmine-Key'] = auth.apiKey;
      } else if (auth.username && auth.password) {
        config.headers['X-Redmine-User'] = auth.username;
        config.headers['X-Redmine-Pass'] = auth.password;
      }
    }
    return config;
  });
  return api;
}
