import axios from 'axios';

// Eventos/reuniões locais (persistidos por usuário no servidor, não vão ao
// Zimbra). Complementam a agenda corporativa para blocos pessoais/informais ou
// quando não há e-mail configurado.
export type LocalEventKind = 'video' | 'presencial' | 'informal';

export interface LocalEvent {
  id: string;
  subject: string;
  start: number; // epoch ms
  end: number; // epoch ms
  location: string;
  description: string;
  kind: LocalEventKind;
  allDay: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateLocalEventPayload {
  subject: string;
  start: number;
  end: number;
  location?: string;
  description?: string;
  kind?: LocalEventKind;
  allDay?: boolean;
}

const api = axios.create({ baseURL: '/api' });

export const eventsApi = {
  list: async (start: number, end: number): Promise<LocalEvent[]> => {
    const { data } = await api.get('/events', { params: { start, end } });
    return data.events;
  },

  create: async (payload: CreateLocalEventPayload): Promise<LocalEvent> => {
    const { data } = await api.post('/events', payload);
    return data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/events/${id}`);
  },
};
