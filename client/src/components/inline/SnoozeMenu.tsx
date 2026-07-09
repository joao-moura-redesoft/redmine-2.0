import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock } from 'lucide-react';
import { SNOOZE_PRESETS } from '../../utils/snooze';

const W = 200;
const H = 190;

// Menu de "adiar até…" ancorado numa linha, navegável por teclado (↑/↓ + Enter,
// Esc fecha). onPick recebe o timestamp de retorno.
export function SnoozeMenu({
  anchorRect,
  onPick,
  onClose,
}: {
  anchorRect: DOMRect;
  onPick: (until: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const r = anchorRect;
    const flipUp = r.bottom + 6 + H > window.innerHeight;
    setPos({
      top: flipUp ? Math.max(8, r.top - H - 6) : r.bottom + 6,
      left: Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8)),
    });
  }, [anchorRect]);

  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      const stop = () => {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      const n = SNOOZE_PRESETS.length;
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          stop();
          return setActive((a) => (a + 1) % n);
        case 'ArrowUp':
        case 'k':
          stop();
          return setActive((a) => (a - 1 + n) % n);
        case 'Enter':
          stop();
          return onPick(SNOOZE_PRESETS[activeRef.current].at());
        case 'Escape':
          stop();
          return onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose, onPick]);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: W }}
      className="z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-slate-400">
        <Clock size={12} /> Adiar até…
      </div>
      {SNOOZE_PRESETS.map((p, i) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPick(p.at())}
          onMouseEnter={() => setActive(i)}
          className={`w-full text-left text-sm text-slate-700 dark:text-slate-200 px-2.5 py-1.5 rounded-md transition-colors ${
            i === active ? 'bg-blue-50 dark:bg-slate-800' : 'hover:bg-blue-50 dark:hover:bg-slate-800'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
