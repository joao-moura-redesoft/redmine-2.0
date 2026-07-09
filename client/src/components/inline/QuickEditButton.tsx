import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { Issue } from '../../types/redmine';
import { QuickEditPanel } from './QuickEditPanel';

// Botão de edição rápida (aparece no hover) + popover. Só o gatilho; o conteúdo
// vive em QuickEditPanel (reutilizado também pela triagem por teclado).
export function QuickEditButton({ issue }: { issue: Issue }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation();
          setRect((r) => (r ? null : btnRef.current!.getBoundingClientRect()));
        }}
        title="Edição rápida"
        className={`p-1 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors ${
          rect ? 'opacity-100 text-blue-600 border-blue-300' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        <Pencil size={14} />
      </button>
      {rect && <QuickEditPanel issue={issue} anchorRect={rect} onClose={() => setRect(null)} />}
    </>
  );
}
