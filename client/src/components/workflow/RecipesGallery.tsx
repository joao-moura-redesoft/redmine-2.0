// Galeria de receitas: escolher uma automação pronta (ou começar em branco).
// Abre do estado vazio e do botão "Nova automação".
import { X, FilePlus, ArrowRight } from 'lucide-react';
import { RECIPES, type Recipe } from './recipes';

export function RecipesGallery({
  onPick,
  onBlank,
  onClose,
  busy,
}: {
  onPick: (recipe: Recipe) => void;
  onBlank: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto scrollbar-thin rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              Nova automação
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Comece de uma receita pronta ou monte do zero.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={17} />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {RECIPES.map((r) => (
            <button
              key={r.id}
              disabled={busy}
              onClick={() => onPick(r)}
              className="w-full flex items-start gap-3 text-left rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50 group"
            >
              <span className="flex-shrink-0 rounded-lg p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <r.icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm text-slate-800 dark:text-slate-100">{r.name}</div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {r.description}
                </p>
                {r.todo && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                    Para completar: {r.todo}
                  </p>
                )}
              </div>
              <ArrowRight
                size={15}
                className="flex-shrink-0 mt-1 text-slate-300 group-hover:text-blue-500 transition-colors"
              />
            </button>
          ))}

          <button
            disabled={busy}
            onClick={onBlank}
            className="w-full flex items-center gap-3 text-left rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-3 hover:border-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors disabled:opacity-50"
          >
            <span className="flex-shrink-0 rounded-lg p-2 bg-slate-500/10 text-slate-500">
              <FilePlus size={18} />
            </span>
            <div>
              <div className="font-medium text-sm text-slate-800 dark:text-slate-100">Em branco</div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Canvas vazio — você escolhe o gatilho.
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
