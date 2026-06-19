import axios from 'axios';
import { authHeaders } from './redmine';

export interface LiveRoom {
  room: string;
  issueId: number | null;
  count: number;
  participants: string[];
}

// API de presença das salas de vídeo (War Room). Usa axios direto + authHeaders
// porque o instance interceptado fica privado em api/redmine.ts.
export const jitsiApi = {
  heartbeat: (room: string, displayName: string) =>
    axios.post('/api/jitsi/presence/heartbeat', { room, displayName }, { headers: authHeaders() }),

  leave: (room: string, displayName: string) =>
    axios.post('/api/jitsi/presence/leave', { room, displayName }, { headers: authHeaders() }),

  getPresence: async (): Promise<LiveRoom[]> => {
    const { data } = await axios.get('/api/jitsi/presence', { headers: authHeaders() });
    return data.rooms ?? [];
  },
};
