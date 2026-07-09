import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Video, MapPin, Users, Loader2, Check, Calendar, Plus } from 'lucide-react';
import { useCreateEvent } from '../hooks/useZimbraEvents';
import { useCreateLocalEvent } from '../hooks/useLocalEvents';
import { isMailAvailable } from '../utils/mailConfig';
import { makeAdHocRoom, jitsiRoomUrl } from '../utils/jitsiConfig';
import type { NewEventAttendee } from '../api/mail';

type MeetingKind = 'video' | 'presencial' | 'informal';

interface Props {
  onClose: () => void;
  // Data inicial sugerida (ex.: dia clicado na agenda). Default: próxima hora cheia.
  initialDate?: Date;
}

// datetime-local <-> epoch ms (horário local; o app roda como exe local por usuário).
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nextRoundHour(base?: Date): Date {
  const d = base ? new Date(base) : new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewEventModal({ onClose, initialDate }: Props) {
  const createEvent = useCreateEvent();
  const createLocal = useCreateLocalEvent();
  const mailOn = isMailAvailable();

  const [kind, setKind] = useState<MeetingKind>(mailOn ? 'video' : 'informal');
  const [subject, setSubject] = useState('');
  const start0 = useMemo(() => nextRoundHour(initialDate), [initialDate]);
  const end0 = useMemo(() => new Date(start0.getTime() + 60 * 60 * 1000), [start0]);
  const [startStr, setStartStr] = useState(toLocalInput(start0));
  const [endStr, setEndStr] = useState(toLocalInput(end0));
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [attendees, setAttendees] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const startMs = new Date(startStr).getTime();
  const endMs = new Date(endStr).getTime();
  const rangeOk = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const pending = createEvent.isPending || createLocal.isPending;
  const canSubmit = subject.trim().length > 0 && rangeOk && !pending;
  // Zimbra só para reuniões formais (vídeo/presencial) quando há e-mail;
  // informal e o modo "sem e-mail" caem no store local por-usuário.
  const useZimbra = mailOn && kind !== 'informal';

  const addEmail = (raw: string) => {
    const v = raw.trim().replace(/[,;]$/, '').trim();
    if (!v) return;
    if (!EMAIL_RE.test(v)) {
      setError(`E-mail inválido: ${v}`);
      return;
    }
    setError(null);
    setAttendees((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setEmailDraft('');
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);

    // Reunião de vídeo: gera uma sala Jitsi e a embute no local + descrição.
    let finalLocation = location.trim();
    let finalDescription = description.trim();
    if (kind === 'video') {
      const room = makeAdHocRoom(subject.trim() || undefined);
      const url = jitsiRoomUrl(room);
      finalLocation = url;
      finalDescription = `Sala de vídeo (Jitsi): ${url}${finalDescription ? `\n\n${finalDescription}` : ''}`;
    }

    try {
      if (useZimbra) {
        const atList: NewEventAttendee[] = attendees.map((address) => ({ address, role: 'REQ' }));
        await createEvent.mutateAsync({
          subject: subject.trim(),
          start: startMs,
          end: endMs,
          location: finalLocation,
          description: finalDescription,
          attendees: atList,
          allDay: false,
        });
      } else {
        // Sem Zimbra (ou informal): grava no calendário local por-usuário.
        await createLocal.mutateAsync({
          subject: subject.trim(),
          start: startMs,
          end: endMs,
          location: finalLocation,
          description: finalDescription,
          kind,
          allDay: false,
        });
      }
      // Fecha ao concluir; a agenda se revalida pelo hook.
      onClose();
    } catch (e) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Não foi possível criar a reunião.';
      setError(msg);
    }
  };

  const kinds: { id: MeetingKind; label: string; icon: typeof Video; hint: string }[] = [
    { id: 'video', label: 'Vídeo', icon: Video, hint: 'Gera sala Jitsi e envia convites' },
    { id: 'presencial', label: 'Presencial', icon: MapPin, hint: 'Local físico + convites' },
    { id: 'informal', label: 'Informal', icon: Calendar, hint: 'Bloco pessoal, sem convidados' },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Calendar size={16} className="text-teal-500" /> Nova reunião
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tipo */}
          <div className="grid grid-cols-3 gap-2">
            {kinds.map((k) => {
              const Icon = k.icon;
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKind(k.id)}
                  className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
                    active
                      ? 'border-teal-300 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                  title={k.hint}
                >
                  <Icon size={16} />
                  {k.label}
                </button>
              );
            })}
          </div>

          {/* Assunto */}
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Assunto
            </label>
            <input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex.: Alinhamento do sprint"
              className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          {/* Início / Fim */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Início
              </label>
              <input
                type="datetime-local"
                value={startStr}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartStr(v);
                  // Mantém 1h de duração ao mover o início, se o fim ficar inválido.
                  const ms = new Date(v).getTime();
                  if (Number.isFinite(ms) && new Date(endStr).getTime() <= ms) {
                    setEndStr(toLocalInput(new Date(ms + 60 * 60 * 1000)));
                  }
                }}
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Fim
              </label>
              <input
                type="datetime-local"
                value={endStr}
                onChange={(e) => setEndStr(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          </div>
          {!rangeOk && (startStr || endStr) && (
            <p className="text-xs text-amber-600">O fim precisa ser depois do início.</p>
          )}

          {/* Local (presencial) */}
          {kind === 'presencial' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                Local
              </label>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex.: Sala de reunião 2 / Recepção"
                className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
              />
            </div>
          )}

          {kind === 'video' && (
            <p className="text-xs text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
              <Video size={13} /> Uma sala Jitsi será criada e incluída{' '}
              {useZimbra ? 'no convite' : 'no evento'}.
            </p>
          )}

          {/* Onde será salvo */}
          <p className="text-[11px] text-slate-400">
            {useZimbra
              ? 'Será criado no seu calendário do e-mail (Zimbra); convidados recebem convite.'
              : mailOn
                ? 'Bloco pessoal — salvo só no seu calendário local (sem convite).'
                : 'Sem e-mail configurado — salvo no seu calendário local.'}
          </p>

          {/* Convidados (só quando há Zimbra para enviar convites) */}
          {useZimbra && (
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1.5">
                <Users size={13} /> Convidados (e-mail)
              </label>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {attendees.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs px-2 py-1 rounded-lg"
                  >
                    {a}
                    <button
                      onClick={() => setAttendees((prev) => prev.filter((x) => x !== a))}
                      className="text-slate-400 hover:text-red-500"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                      e.preventDefault();
                      addEmail(emailDraft);
                    }
                  }}
                  onBlur={() => emailDraft.trim() && addEmail(emailDraft)}
                  placeholder="nome@redesoft.org  (Enter para adicionar)"
                  className="flex-1 text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                <button
                  type="button"
                  onClick={() => addEmail(emailDraft)}
                  className="px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
                  title="Adicionar convidado"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Descrição */}
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
              Descrição <span className="text-slate-400">(opcional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Pauta, links, observações…"
              className="w-full text-sm px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-y"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg"
          >
            {pending ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Criando…
              </>
            ) : (
              <>
                <Check size={13} /> Criar reunião
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
