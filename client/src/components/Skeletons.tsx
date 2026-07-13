/*
 * Skeleton loaders — silhuetas cinza no lugar de spinners/tela em branco.
 * Reduzem a percepção de espera e evitam layout shift (os cards não "pulam"
 * quando os dados chegam, porque o esqueleto já ocupa o mesmo espaço).
 */

// Bloco base animado. `className` define tamanho/formato.
export function SkeletonBox({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-slate-200 dark:bg-slate-700/50 rounded animate-pulse ${className}`}
      aria-hidden="true"
    />
  );
}

// Silhueta de um card do Kanban (mesma altura aproximada do IssueCard cheio).
function CardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <SkeletonBox className="h-4 w-16" />
        <SkeletonBox className="h-4 w-14" />
      </div>
      <SkeletonBox className="h-4 w-full" />
      <SkeletonBox className="h-3 w-1/2" />
      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
        <SkeletonBox className="h-4 w-20" />
        <SkeletonBox className="h-3 w-10" />
      </div>
    </div>
  );
}

// Silhueta de uma coluna: header + N cards. `cards` varia a altura por coluna
// para o esqueleto não parecer um grid perfeitamente uniforme.
function ColumnSkeleton({ cards }: { cards: number }) {
  return (
    <div className="flex flex-col w-72 flex-shrink-0">
      <div className="px-4 py-3 bg-white dark:bg-slate-800 border-x border-b border-t-4 border-slate-200 dark:border-slate-700 rounded-t-xl">
        <div className="flex items-center gap-2">
          <SkeletonBox className="h-4 w-28" />
          <SkeletonBox className="h-4 w-6 rounded-full" />
        </div>
      </div>
      <div className="flex-1 min-h-[200px] p-2 rounded-b-xl border border-t-0 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2">
        {Array.from({ length: cards }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// Board inteiro em esqueleto (usado enquanto as issues carregam).
export function KanbanBoardSkeleton() {
  const columns = [4, 3, 2, 3, 1];
  return (
    <div className="flex gap-4 overflow-hidden pb-4 flex-1 items-start" aria-hidden="true">
      {columns.map((cards, i) => (
        <ColumnSkeleton key={i} cards={cards} />
      ))}
    </div>
  );
}

// Card de estatística do Dashboard em esqueleto.
function StatCardSkeleton() {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-3">
      <SkeletonBox className="w-10 h-10 rounded-lg" />
      <div className="flex-1 space-y-2">
        <SkeletonBox className="h-6 w-12" />
        <SkeletonBox className="h-3 w-24" />
      </div>
    </div>
  );
}

// Dashboard em esqueleto: linha de KPIs + dois painéis largos.
export function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3"
          >
            <SkeletonBox className="h-5 w-40" />
            {Array.from({ length: 4 }).map((_, j) => (
              <SkeletonBox key={j} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
