import { useEffect, useRef } from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

export interface Opt {
  id: number;
  name: string;
}

// Campo de escolha compacto pro popover de edição rápida. Controlado: quem usa
// decide se está aberto, e (no modo teclado) qual opção está ativa e se o campo
// está focado.
export function InlineSelect({
  label,
  current,
  options,
  loading,
  isOpen,
  onToggle,
  onPick,
  emptyLabel = '—',
  activeIndex,
  focused,
}: {
  label: string;
  current: Opt | null;
  options: Opt[] | undefined;
  loading?: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onPick: (opt: Opt) => void;
  emptyLabel?: string;
  activeIndex?: number;
  focused?: boolean;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (isOpen) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, activeIndex]);

  return (
    <div className="flex items-center gap-2 relative">
      <span className="text-xs text-slate-500 dark:text-slate-400 w-20 flex-shrink-0">{label}</span>
      <button
        type="button"
        onClick={onToggle}
        title={current?.name ?? emptyLabel}
        className={`flex-1 min-w-0 flex items-center justify-between gap-1 text-sm text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md px-2 py-1 transition-colors ${
          focused ? 'ring-2 ring-blue-500' : ''
        }`}
      >
        <span className="truncate min-w-0">{current?.name ?? emptyLabel}</span>
        <ChevronDown size={13} className="text-slate-400 flex-shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 scrollbar-thin">
          {loading ? (
            <div className="flex items-center justify-center py-3 text-slate-400">
              <Loader2 size={15} className="animate-spin" />
            </div>
          ) : !options || options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Sem opções disponíveis</div>
          ) : (
            options.map((o, i) => {
              const isActive = i === activeIndex;
              const isCurrent = current?.id === o.id;
              return (
                <button
                  key={o.id}
                  ref={isActive ? activeRef : undefined}
                  type="button"
                  onClick={() => onPick(o)}
                  title={o.name}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                    isActive ? 'bg-blue-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                  } ${
                    isCurrent
                      ? 'text-blue-600 dark:text-blue-400 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="flex-1 truncate min-w-0">{o.name}</span>
                  {isCurrent && <Check size={13} className="flex-shrink-0" />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// Prazo (data) — input nativo, sem dropdown.
export function InlineDate({
  label,
  value,
  onChange,
  focused,
  inputRef,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  focused?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 w-20 flex-shrink-0">{label}</span>
      <input
        ref={inputRef}
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`flex-1 text-sm text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md px-2 py-1 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          focused ? 'ring-2 ring-blue-500' : ''
        }`}
      />
    </div>
  );
}
