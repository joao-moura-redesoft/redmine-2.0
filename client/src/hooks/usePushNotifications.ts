import { useEffect } from 'react';
import { useBrowserNotifications } from './useBrowserNotifications';
import { redmineApi } from '../api/redmine';

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
export function usePushNotifications() {
  const { permission } = useBrowserNotifications();

  useEffect(() => {
    if (permission !== 'granted') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    let cancelled = false;
    (async () => {
      try {
        console.log('[push] iniciando inscrição...');
        const reg = await navigator.serviceWorker.ready;
        console.log('[push] SW pronto:', reg.active?.state);
        const publicKey = await redmineApi.getVapidPublicKey();
        if (!publicKey || cancelled) return;

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
        if (cancelled) return;

        await redmineApi.subscribePush(sub.toJSON());
        console.log('[push] inscrição enviada ao servidor com sucesso');
      } catch (err) {
        console.error('[push] falha ao inscrever:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [permission]);
}
