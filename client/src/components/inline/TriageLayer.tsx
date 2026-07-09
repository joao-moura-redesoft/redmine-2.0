import { Keyboard } from 'lucide-react';
import type { Issue } from '../../types/redmine';
import type { Triage } from '../../hooks/useKeyboardTriage';
import { QuickEditPanel } from './QuickEditPanel';
import { SnoozeMenu } from './SnoozeMenu';
import { BulkBar } from './BulkBar';
import { snoozeStore } from '../../utils/snooze';

const SHORTCUTS: [string, string][] = [
  ['j / ↓', 'Próxima'],
  ['k / ↑', 'Anterior'],
  ['enter / o', 'Abrir'],
  ['e', 'Edição rápida'],
  ['s', 'Status'],
  ['a', 'Responsável'],
  ['z', 'Adiar'],
  ['w', 'Aguardando'],
  ['f', 'Foco 25min'],
  ['x', 'Selecionar (lote)'],
  ['esc', 'Limpar / fechar'],
];

// Camada de overlays da triagem por teclado — reutilizada por qualquer lista
// (Inbox, filas de review/teste/monitoramento). Renderiza o popover de edição,
// o menu de adiar, a barra de lote e a ajuda. As linhas (foco/seleção/badges)
// ficam em cada view.
export function TriageLayer({
  triage,
  issueById,
}: {
  triage: Triage;
  issueById: (id: number) => Issue | undefined;
}) {
  return (
    <>
      {triage.quickEdit && (
        <QuickEditPanel
          issue={triage.quickEdit.issue}
          anchorRect={triage.quickEdit.rect}
          initialField={triage.quickEdit.field}
          onClose={triage.closeQuickEdit}
        />
      )}

      {triage.snooze && (
        <SnoozeMenu
          anchorRect={triage.snooze.rect}
          onPick={(until) => {
            snoozeStore.snooze(triage.snooze!.issue.id, until);
            triage.closeSnooze();
          }}
          onClose={triage.closeSnooze}
        />
      )}

      {triage.selected.size > 0 && (
        <BulkBar
          issues={[...triage.selected].map(issueById).filter((i): i is Issue => !!i)}
          onClear={triage.clearSelected}
        />
      )}

      {triage.showHelp && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => triage.setShowHelp(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xs p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Keyboard size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Atalhos da triagem
              </h3>
            </div>
            <dl className="space-y-1.5 text-sm">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <kbd className="text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                    {k}
                  </kbd>
                  <span className="text-slate-600 dark:text-slate-300">{d}</span>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </>
  );
}
