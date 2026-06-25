import { useEffect, useRef, useState } from 'react';

/* Botão destrutivo com confirmação inline em dois toques (substitui o confirm()
   nativo): o 1º clique "arma" e revela um pill vermelho; o 2º confirma. Desarma
   sozinho ao clicar fora ou após alguns segundos. */
export function ConfirmButton({ onConfirm, icon, title, confirmLabel = 'Confirmar', triggerClass }: {
  onConfirm: () => void;
  icon: React.ReactNode;
  title: string;
  confirmLabel?: string;
  triggerClass?: string;
}) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setArmed(false); };
    document.addEventListener('mousedown', onDoc);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDoc); };
  }, [armed]);

  return (
    <span ref={ref} className="flex-shrink-0">
      {armed ? (
        <button
          onClick={() => { setArmed(false); onConfirm(); }}
          className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 whitespace-nowrap"
        >
          {confirmLabel}
        </button>
      ) : (
        <button
          onClick={() => setArmed(true)}
          title={title}
          aria-label={title}
          className={triggerClass ?? 'p-1 rounded text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-700'}
        >
          {icon}
        </button>
      )}
    </span>
  );
}
