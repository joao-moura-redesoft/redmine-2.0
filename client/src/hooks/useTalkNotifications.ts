import { useEffect, useRef } from 'react';
import { useTalkRooms, useTalkCurrentUser } from './useTalk';
import { resolveMessageText } from '../api/talk';
import { useBrowserNotifications } from './useBrowserNotifications';
import { getTalkPrefs } from '../utils/talkPrefs';
import { talkMute } from '../utils/talkMute';
import { playNotificationBeep } from '../utils/talkSound';

// Notificação do navegador (OS) para novas mensagens do Talk enquanto a aba está
// aberta mas SEM foco. O caso "aba fechada/minimizada" é coberto pelo Web Push do
// servidor; por isso só disparamos aqui com o documento sem foco, evitando notificar
// enquanto o usuário já está olhando.
export function useTalkNotifications() {
  const { data: rooms } = useTalkRooms();
  const { data: me } = useTalkCurrentUser();
  const { notify } = useBrowserNotifications();
  const prevRoomsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!rooms) return;
    const myId = me?.id;

    const prevRooms = prevRoomsRef.current;
    const newPrevRooms = new Map<string, number>();
    const { groupMentionsOnly } = getTalkPrefs();

    rooms.forEach(room => {
      const lastMsg = room.lastMessage;
      const currentLastId = lastMsg?.id ?? 0;
      newPrevRooms.set(room.token, currentLastId);

      const prevLastId = prevRooms.get(room.token);
      // Sem registro anterior = primeiro load: só memoriza, não notifica retroativo.
      if (prevLastId === undefined) return;

      const isDM = room.type === 1;
      // Filtro de ruído: em grupo, com groupMentionsOnly, só notifica quando há menção.
      if (!isDM && groupMentionsOnly && !room.unreadMention) return;

      const isNew =
        !!lastMsg &&
        currentLastId > prevLastId &&
        room.unreadMessages > 0 &&
        lastMsg.actorId !== myId &&          // não notifica as próprias mensagens
        lastMsg.messageType === 'comment' &&  // ignora mensagens de sistema
        !talkMute.isMuted(room.token) &&      // respeita salas silenciadas
        !document.hasFocus();                 // aba aberta mas sem foco

      if (isNew) {
        const sender = lastMsg.actorDisplayName || 'Nova mensagem';
        const title = isDM ? sender : `${sender} em ${room.displayName}`;
        notify(title, { body: resolveMessageText(lastMsg), tag: `talk-${room.token}` });
        playNotificationBeep(); // única fonte de alerta sonoro (o badge/título fica no TalkChat)
      }
    });

    prevRoomsRef.current = newPrevRooms;
  }, [rooms, me?.id, notify]);
}
