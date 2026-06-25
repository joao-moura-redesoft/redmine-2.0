// Preferências de notificação do Talk (locais, por dispositivo).
// Alimentam o filtro de ruído (cliente + servidor) e o modo tempo real (servidor).
const KEY = 'rk_talk_prefs';

export interface TalkPrefs {
  // Em salas de grupo, notificar só quando há menção (DMs sempre notificam).
  groupMentionsOnly: boolean;
  // Polling agressivo no servidor (~3s) para notificação quase instantânea com a aba fechada.
  // Custa mais rede/bateria; por isso é opt-in.
  realtime: boolean;
}

export const DEFAULT_TALK_PREFS: TalkPrefs = {
  groupMentionsOnly: true,
  realtime: false,
};

export function getTalkPrefs(): TalkPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_TALK_PREFS };
    const p = JSON.parse(raw);
    return {
      groupMentionsOnly: typeof p?.groupMentionsOnly === 'boolean' ? p.groupMentionsOnly : DEFAULT_TALK_PREFS.groupMentionsOnly,
      realtime: typeof p?.realtime === 'boolean' ? p.realtime : DEFAULT_TALK_PREFS.realtime,
    };
  } catch {
    return { ...DEFAULT_TALK_PREFS };
  }
}

// Disparado ao salvar prefs, para que o usePushNotifications re-inscreva no servidor.
export const TALK_PREFS_EVENT = 'rk-talk-prefs-changed';

export function saveTalkPrefs(prefs: TalkPrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent(TALK_PREFS_EVENT));
}
