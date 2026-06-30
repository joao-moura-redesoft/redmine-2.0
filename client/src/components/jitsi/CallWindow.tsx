import { useRef, useState, useEffect, useCallback } from 'react';
import { JitsiMeeting } from '@jitsi/react-sdk';
import {
  Minus,
  Maximize2,
  Minimize2,
  PhoneOff,
  Video,
  GripHorizontal,
  ExternalLink,
  X,
  Disc,
  Square,
  UserPlus,
} from 'lucide-react';
import { useJitsi } from './JitsiContext';
import { useCurrentUser } from '../../hooks/useRedmine';
import { getJitsiDomain } from '../../utils/jitsiConfig';
import { jitsiApi } from '../../api/jitsi';
import { getTalkAuth } from '../../api/talk';
import { InvitePopover } from './InvitePopover';

// Dimensões padrão da janela flutuante (modo PiP) e limites de redimensionamento.
const DEFAULT_W = 380;
const DEFAULT_H = 300;
const MIN_W = 280;
const MIN_H = 200;
const PILL_W = 220;
const PILL_H = 48;
const MARGIN = 16;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function CallWindow() {
  const {
    activeCall,
    minimized,
    poppedOut,
    endCall,
    popOut,
    closePopout,
    toggleMinimize,
    recorder,
  } = useJitsi();
  const { data: user } = useCurrentUser();

  // Tamanho atual da janela (modo expandido); ajustável por maximizar/arrastar a alça.
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [maximized, setMaximized] = useState(false);
  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - DEFAULT_W - MARGIN,
    y: window.innerHeight - DEFAULT_H - MARGIN,
  }));
  const restoreRef = useRef<{ size: typeof size; pos: typeof pos } | null>(null);

  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null);

  // Convite via Talk
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCoords, setInviteCoords] = useState({ top: 0, left: 0 });
  const inviteBtnRef = useRef<HTMLButtonElement>(null);
  const talkOn = !!getTalkAuth();
  const toggleInvite = () => {
    if (!inviteOpen && inviteBtnRef.current) {
      const r = inviteBtnRef.current.getBoundingClientRect();
      setInviteCoords({
        top: Math.min(r.bottom + 4, window.innerHeight - 372),
        left: Math.min(r.left, window.innerWidth - 296),
      });
    }
    setInviteOpen((v) => !v);
  };

  const w = minimized ? PILL_W : size.w;
  const h = minimized ? PILL_H : size.h;

  // ── Arrasto da janela (pela barra de título) ──
  const onDragDown = useCallback(
    (e: React.PointerEvent) => {
      if (maximized) return;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    },
    [pos, maximized],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      setPos({
        x: clamp(e.clientX - dragRef.current.dx, 0, window.innerWidth - w),
        y: clamp(e.clientY - dragRef.current.dy, 0, window.innerHeight - h),
      });
    },
    [w, h],
  );

  const onDragUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Redimensionamento (alça inferior direita) ──
  const onResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      resizeRef.current = { sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h };
    },
    [size],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!resizeRef.current) return;
      const r = resizeRef.current;
      setSize({
        w: clamp(r.sw + (e.clientX - r.sx), MIN_W, window.innerWidth - pos.x),
        h: clamp(r.sh + (e.clientY - r.sy), MIN_H, window.innerHeight - pos.y),
      });
      setMaximized(false);
    },
    [pos],
  );

  const onResizeUp = useCallback((e: React.PointerEvent) => {
    resizeRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Maximizar / restaurar ──
  const toggleMaximize = useCallback(() => {
    if (maximized) {
      const r = restoreRef.current;
      if (r) {
        setSize(r.size);
        setPos(r.pos);
      }
      setMaximized(false);
    } else {
      restoreRef.current = { size, pos };
      const bw = Math.min(960, window.innerWidth - 2 * MARGIN);
      const bh = Math.min(640, window.innerHeight - 2 * MARGIN);
      setSize({ w: bw, h: bh });
      setPos({ x: (window.innerWidth - bw) / 2, y: (window.innerHeight - bh) / 2 });
      setMaximized(true);
    }
  }, [maximized, size, pos]);

  // Mantém a janela dentro da viewport quando o navegador é redimensionado.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => ({
        x: clamp(p.x, 0, window.innerWidth - w),
        y: clamp(p.y, 0, window.innerHeight - h),
      }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [w, h]);

  // ── Presença (badge AO VIVO + auto-logging) ──
  // Reporta heartbeat tanto para o iframe embutido quanto para a janela destacada.
  // Como destacar mantém a MESMA sala, a dependência (room) não muda e o heartbeat
  // segue contínuo — sem leave/join intermediário que dispararia o auto-log.
  const presenceName = user ? `${user.firstname} ${user.lastname}`.trim() : '';
  const presenceRoom = activeCall?.room ?? poppedOut?.room;
  useEffect(() => {
    if (!presenceRoom || !presenceName) return;
    const beat = () => {
      jitsiApi.heartbeat(presenceRoom, presenceName).catch(() => {});
    };
    beat();
    const id = setInterval(beat, 25000);
    return () => {
      clearInterval(id);
      jitsiApi.leave(presenceRoom, presenceName).catch(() => {});
    };
  }, [presenceRoom, presenceName]);

  // Detecta o fechamento da janela destacada para encerrar a presença.
  useEffect(() => {
    const win = poppedOut?.win;
    if (!win) return;
    const id = setInterval(() => {
      if (win.closed) closePopout();
    }, 1500);
    return () => clearInterval(id);
  }, [poppedOut, closePopout]);

  const displayName = presenceName || undefined;
  const domain = getJitsiDomain();

  // Abre a sala atual numa janela separada (página nativa do Jitsi) e encerra o iframe.
  const handlePopOut = () => {
    if (!activeCall) return;
    const hash = [
      `userInfo.displayName=${encodeURIComponent(`"${presenceName}"`)}`,
      'config.prejoinPageEnabled=false',
      'config.prejoinConfig.enabled=false',
      activeCall.kind === 'daily' ? 'config.startWithAudioMuted=true' : '',
    ]
      .filter(Boolean)
      .join('&');
    const url = `https://${domain}/${activeCall.room}#${hash}`;
    const win = window.open(url, `jitsi-${activeCall.room}`, 'width=960,height=680');
    if (!win) {
      alert('O navegador bloqueou a janela popup. Permita popups para destacar a reunião.');
      return;
    }
    win.focus();
    popOut({ ...activeCall, win });
  };

  const handleRecordToggle = () => {
    if (recorder.status === 'recording') recorder.stop();
    else recorder.start();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs.toString().padStart(2, '0')}`;
  };

  // Toast de erro da gravação (ex.: "compartilhe o áudio da aba"), reutilizado
  // tanto no PiP quanto na pílula.
  const recError = recorder.error ? (
    <div className="fixed bottom-20 right-4 z-[95] max-w-xs px-3 py-2 rounded-lg bg-red-600 text-white text-xs shadow-lg">
      {recorder.error}
    </div>
  ) : null;

  // Botão gravar/parar reutilizado.
  const recordButton = (
    <button
      onClick={handleRecordToggle}
      title={
        recorder.status === 'recording' ? 'Parar gravação' : 'Gravar reunião para resumo com IA'
      }
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors flex-shrink-0 ${
        recorder.status === 'recording'
          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
          : 'hover:bg-slate-700 text-slate-300'
      }`}
    >
      {recorder.status === 'recording' ? (
        <>
          <Square size={12} className="fill-current" />
          <span>{formatTime(recorder.seconds)}</span>
        </>
      ) : (
        <Disc size={13} />
      )}
    </button>
  );

  // Botão de convidar (só quando o Talk está configurado).
  const inviteButton = talkOn ? (
    <button
      ref={inviteBtnRef}
      onClick={toggleInvite}
      title="Convidar alguém pelo Talk"
      className={`p-1 rounded flex-shrink-0 ${inviteOpen ? 'bg-slate-700 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
    >
      <UserPlus size={13} />
    </button>
  ) : null;

  const currentRoom = activeCall?.room ?? poppedOut?.room;
  const currentTitle = activeCall?.title ?? poppedOut?.title ?? 'Reunião';
  const invitePopover =
    inviteOpen && currentRoom ? (
      <InvitePopover
        room={currentRoom}
        title={currentTitle}
        coords={inviteCoords}
        onClose={() => setInviteOpen(false)}
      />
    ) : null;

  // Pílula compacta quando a reunião está numa janela separada.
  if (!activeCall && poppedOut) {
    return (
      <div className="fixed bottom-4 right-4 z-[90] flex items-center gap-2 px-3 h-11 rounded-xl shadow-2xl border border-slate-700 bg-slate-900 text-slate-100">
        {recError}
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        <ExternalLink size={13} className="text-slate-300 flex-shrink-0" />
        <span className="text-xs font-medium truncate max-w-[120px]" title={poppedOut.title}>
          {poppedOut.title}
        </span>
        {recordButton}
        {inviteButton}
        <button
          onClick={() => {
            try {
              poppedOut.win?.focus();
            } catch {
              /* ignore */
            }
          }}
          title="Focar janela da reunião"
          className="p-1 rounded hover:bg-slate-700 text-slate-300 flex-shrink-0"
        >
          <Maximize2 size={13} />
        </button>
        <button
          onClick={closePopout}
          title="Encerrar reunião"
          className="p-1 rounded hover:bg-red-600 text-red-400 hover:text-white flex-shrink-0"
        >
          <X size={14} />
        </button>
        {invitePopover}
      </div>
    );
  }

  if (!activeCall) return null;

  return (
    <>
      {recError}
      {invitePopover}
      <div
        className="fixed z-[90] rounded-xl shadow-2xl border border-slate-700 bg-slate-900 overflow-hidden flex flex-col"
        style={{ left: pos.x, top: pos.y, width: w, height: h }}
      >
        {/* Barra de título (área de arrasto) */}
        <div
          onPointerDown={onDragDown}
          onPointerMove={onDragMove}
          onPointerUp={onDragUp}
          className={`flex items-center gap-1.5 px-2.5 h-12 flex-shrink-0 bg-slate-800 text-slate-100 select-none touch-none ${maximized ? '' : 'cursor-move'}`}
        >
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <Video size={14} className="text-slate-300 flex-shrink-0" />
          <span className="text-xs font-medium truncate flex-1" title={activeCall.title}>
            {activeCall.title}
          </span>
          <GripHorizontal size={14} className="text-slate-500 flex-shrink-0" />

          {/* Botão de Gravar */}
          {!minimized && recordButton}
          {!minimized && inviteButton}

          <button
            onClick={handlePopOut}
            title="Abrir em janela separada"
            className="p-1 rounded hover:bg-slate-700 text-slate-300 flex-shrink-0"
          >
            <ExternalLink size={13} />
          </button>
          {!minimized && (
            <button
              onClick={toggleMaximize}
              title={maximized ? 'Restaurar tamanho' : 'Maximizar'}
              className="p-1 rounded hover:bg-slate-700 text-slate-300 flex-shrink-0"
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button
            onClick={toggleMinimize}
            title={minimized ? 'Expandir' : 'Minimizar'}
            className="p-1 rounded hover:bg-slate-700 text-slate-300 flex-shrink-0"
          >
            {minimized ? <Maximize2 size={13} /> : <Minus size={13} />}
          </button>
          <button
            onClick={endCall}
            title="Sair da chamada"
            className="p-1 rounded hover:bg-red-600 text-red-400 hover:text-white flex-shrink-0"
          >
            <PhoneOff size={13} />
          </button>
        </div>

        {/* Corpo: iframe do Jitsi. Permanece montado mesmo minimizado (mantém a chamada viva). */}
        <div className={minimized ? 'hidden' : 'flex-1 min-h-0 bg-black'}>
          <JitsiMeeting
            key={activeCall.room}
            domain={domain}
            roomName={activeCall.room}
            userInfo={displayName ? { displayName, email: user?.mail ?? '' } : undefined}
            configOverwrite={{
              prejoinPageEnabled: false, // Jitsi antigo
              prejoinConfig: { enabled: false }, // Jitsi novo (renomeado)
              startWithAudioMuted: activeCall.kind === 'daily',
              disableDeepLinking: true,
              disableInviteFunctions: false,
            }}
            interfaceConfigOverwrite={{
              MOBILE_APP_PROMO: false,
              SHOW_JITSI_WATERMARK: false,
              DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
            }}
            getIFrameRef={(node) => {
              node.style.height = '100%';
              node.style.width = '100%';
            }}
            onReadyToClose={endCall}
          />
        </div>

        {/* Alça de redimensionamento (canto inferior direito) */}
        {!minimized && (
          <div
            onPointerDown={onResizeDown}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            title="Arraste para redimensionar"
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none z-10"
            style={{
              background: 'linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.6) 50%)',
            }}
          />
        )}
      </div>
    </>
  );
}
