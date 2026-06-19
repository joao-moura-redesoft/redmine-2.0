import { useState } from 'react';
import { Video, Plus, LogIn, Users, Radio, CalendarClock, ExternalLink } from 'lucide-react';
import { useJitsi } from './jitsi/JitsiContext';
import { useJitsiPresence } from '../hooks/useJitsiPresence';
import { DAILY_ROOM, makeAdHocRoom, sanitizeRoom, issueIdFromRoom } from '../utils/jitsiConfig';

// Rótulo amigável para um nome de sala técnico.
function roomLabel(room: string): string {
  const issueId = issueIdFromRoom(room);
  if (issueId) return `Tarefa #${issueId}`;
  if (room === DAILY_ROOM) return 'Reunião Diária';
  const m = /^B2Click-Sala-(.+)$/.exec(room);
  if (m) return m[1].replace(/-/g, ' ');
  return room;
}

export function MeetingsView({ onIssueClick }: { onIssueClick?: (id: number) => void }) {
  const { startCall, activeCall, poppedOut } = useJitsi();
  const { rooms } = useJitsiPresence();

  const [newName, setNewName] = useState('');
  const [joinName, setJoinName] = useState('');

  const createAdHoc = () => {
    const room = makeAdHocRoom(newName);
    startCall({ room, title: newName.trim() || 'Reunião avulsa', kind: 'adhoc' });
    setNewName('');
  };

  const joinByName = () => {
    const room = sanitizeRoom(joinName);
    if (!room) return;
    startCall({ room, title: joinName.trim(), kind: 'adhoc' });
    setJoinName('');
  };

  const enter = (room: string, title: string) => {
    const issueId = issueIdFromRoom(room);
    startCall({ room, title, kind: issueId ? 'task' : room === DAILY_ROOM ? 'daily' : 'adhoc', issueId: issueId ?? undefined });
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-slate-50 dark:bg-slate-950 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Video size={22} className="text-blue-600" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Reuniões</h1>
        </div>

        {/* Ações rápidas */}
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Daily */}
          <button
            onClick={() => startCall({ room: DAILY_ROOM, title: 'Reunião Diária', kind: 'daily' })}
            className="flex flex-col items-start gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-blue-300 hover:shadow-sm transition-all text-left"
          >
            <CalendarClock size={18} className="text-blue-600" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Reunião Diária</span>
            <span className="text-xs text-slate-400">Sala fixa da daily/standup</span>
          </button>

          {/* Nova avulsa */}
          <div className="flex flex-col gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <Plus size={18} className="text-emerald-600" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Nova reunião</span>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createAdHoc()}
              placeholder="Nome (opcional)"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
            <button
              onClick={createAdHoc}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            >
              Criar e entrar
            </button>
          </div>

          {/* Entrar por nome */}
          <div className="flex flex-col gap-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <LogIn size={18} className="text-violet-600" />
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Entrar por nome</span>
            <input
              value={joinName}
              onChange={e => setJoinName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinByName()}
              placeholder="Nome exato da sala"
              className="w-full text-sm border border-slate-200 dark:border-slate-700 dark:bg-slate-800 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <button
              onClick={joinByName}
              disabled={!sanitizeRoom(joinName)}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white transition-colors"
            >
              Entrar
            </button>
          </div>
        </div>

        {/* Salas ativas */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Radio size={15} className="text-red-500" />
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Salas ativas agora</h2>
            <span className="text-xs text-slate-400">{rooms.length}</span>
          </div>

          {rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
              <Video size={28} className="mb-2 opacity-30" />
              <p className="text-sm">Nenhuma reunião acontecendo agora.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rooms.map(r => {
                const here = activeCall?.room === r.room || poppedOut?.room === r.room;
                const label = roomLabel(r.room);
                const issueId = r.issueId;
                return (
                  <div
                    key={r.room}
                    className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{label}</span>
                        {issueId != null && onIssueClick && (
                          <button
                            onClick={() => onIssueClick(issueId)}
                            title="Abrir tarefa"
                            className="text-blue-400 hover:text-blue-600"
                          >
                            <ExternalLink size={12} />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                        <Users size={11} />
                        <span className="truncate">{r.participants.join(', ')}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => enter(r.room, label)}
                      disabled={here}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
                        here
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-default'
                          : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'
                      }`}
                    >
                      <Video size={13} /> {here ? 'Você está aqui' : 'Entrar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
