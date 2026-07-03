import { useEffect, useState } from 'react';
import { Download, RefreshCw, X, Loader2 } from 'lucide-react';
import { redmineApi, type UpdateStatus } from '../api/redmine';

// Intervalo do check periódico (o app fica aberto por dias). 6h por padrão.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Aviso de nova versão do app. Só aparece quando o auto-update está habilitado no
// servidor (GitHub Releases ou manifesto) e há versão mais nova. Reverifica
// periodicamente e reaparece se uma versão AINDA MAIS nova surgir após dispensar.
// Fluxo: Baixar → (verifica SHA no servidor) → Reiniciar para aplicar.
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<'idle' | 'downloading' | 'ready' | 'applying' | 'error'>(
    'idle',
  );
  const [error, setError] = useState('');
  // Versão que o usuário dispensou; se chegar uma diferente, o banner volta.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = () =>
      redmineApi
        .getUpdateStatus()
        .then((s) => {
          if (!active) return;
          setStatus(s);
          if (s.staged) setPhase((p) => (p === 'idle' ? 'ready' : p));
        })
        .catch(() => active && setStatus(null));
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const visible =
    !!status?.enabled && !!status.updateAvailable && status.latest !== dismissedVersion;
  if (!visible) return null;

  const download = async () => {
    setPhase('downloading');
    setError('');
    try {
      await redmineApi.downloadUpdate();
      setPhase('ready');
    } catch (e) {
      setError(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Falha ao baixar a atualização.',
      );
      setPhase('error');
    }
  };

  const apply = async () => {
    if (!confirm('O app será fechado e reaberto na nova versão. Continuar?')) return;
    setPhase('applying');
    try {
      await redmineApi.applyUpdate();
      // O servidor encerra; mostra aviso enquanto reinicia.
    } catch {
      /* o processo pode cair no meio da resposta — esperado */
    }
  };

  return (
    <div className="fixed bottom-4 left-4 z-[200] w-80 rounded-xl border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-900 shadow-xl p-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Nova versão {status.latest}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Você está na {status.current}.
          </p>
          {status.notes && (
            <p className="mt-1 text-[11px] text-slate-400 line-clamp-3 whitespace-pre-wrap">
              {status.notes}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
        <button
          onClick={() => setDismissedVersion(status.latest ?? null)}
          className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          title="Dispensar"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        {phase === 'ready' || phase === 'applying' ? (
          <button
            onClick={apply}
            disabled={phase === 'applying'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {phase === 'applying' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <RefreshCw size={13} />
            )}
            Reiniciar para aplicar
          </button>
        ) : (
          <button
            onClick={download}
            disabled={phase === 'downloading'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg"
          >
            {phase === 'downloading' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Download size={13} />
            )}
            {phase === 'downloading' ? 'Baixando…' : 'Baixar atualização'}
          </button>
        )}
      </div>
    </div>
  );
}
