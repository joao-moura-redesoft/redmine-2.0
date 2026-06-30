import { useEffect } from 'react';
import { useBrowserNotifications } from './useBrowserNotifications';
import { redmineApi } from '../api/redmine';
import { getTalkPrefs, TALK_PREFS_EVENT } from '../utils/talkPrefs';

/** Converte a chave pública VAPID (base64url) no formato exigido pelo PushManager. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Inscreve o navegador para receber Web Push do servidor — isso é o que permite
 * notificações chegarem com a aba fechada. Roda quando a permissão de notificação
 * já foi concedida; é idempotente (faz upsert da inscrição no servidor, que
 * recebe também as credenciais do Redmine via headers do axios para poder pollar).
 */
async function subscribeNow(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  console.log('[push] iniciando inscrição...');
  const reg = await navigator.serviceWorker.ready;
  console.log('[push] SW pronto:', reg.active?.state);
  const publicKey = await redmineApi.getVapidPublicKey();
  if (!publicKey) return;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    console.log('[push] criando nova subscription no PushManager...');
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } else {
    console.log('[push] subscription existente reutilizada');
  }

  await redmineApi.subscribePush(sub.toJSON(), getTalkPrefs());
  console.log('[push] inscrição enviada ao servidor com sucesso');
}

export function usePushNotifications() {
  const { permission } = useBrowserNotifications();

  useEffect(() => {
    if (permission !== 'granted') return;

    subscribeNow().catch((err) => console.error('[push] falha ao inscrever:', err));

    // Re-inscreve quando o usuário muda as preferências do Talk, para o servidor
    // passar a respeitar o filtro de ruído / tempo real sem precisar recarregar.
    const onPrefsChange = () =>
      subscribeNow().catch((err) => console.error('[push] re-inscrição falhou:', err));
    window.addEventListener(TALK_PREFS_EVENT, onPrefsChange);
    return () => window.removeEventListener(TALK_PREFS_EVENT, onPrefsChange);
  }, [permission]);
}
