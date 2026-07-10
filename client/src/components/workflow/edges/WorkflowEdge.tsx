// Aresta customizada do canvas: além de desenhar a conexão, renderiza um botão
// "×" no ponto médio para REMOVER a conexão (antes só dava para apagar o nó de
// destino). Para nós branch (Se/senão), mostra também o rótulo V (verdadeiro,
// verde) ou F (falso, rosa) — a distinção vem do handle de origem.
//
// A ação de excluir chega por CONTEXT (não por `data`) para não injetar função
// em cada aresta nem causar re-render à toa.
import { createContext, useContext, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';

export const EdgeActionsContext = createContext<{ onDelete: (id: string) => void }>({
  onDelete: () => {},
});

export function WorkflowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  markerEnd,
  selected,
}: EdgeProps) {
  const { onDelete } = useContext(EdgeActionsContext);
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const branch = sourceHandleId === 'true' ? 'V' : sourceHandleId === 'false' ? 'F' : null;
  const stroke =
    sourceHandleId === 'true' ? '#10b981' : sourceHandleId === 'false' ? '#f43f5e' : undefined;
  // O × aparece no hover da linha (ou quando a aresta está selecionada). O rótulo
  // V/F é informativo, então fica sempre visível.
  const show = hover || selected;
  const on = () => setHover(true);
  const off = () => setHover(false);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...(stroke ? { stroke } : {}), strokeWidth: show ? 2.5 : 1.5 }}
      />
      {/* Faixa larga e invisível sobre a linha: alvo de hover generoso (a linha
          visível é fina demais). pointerEvents:stroke capta só a área da faixa. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onMouseEnter={on}
        onMouseLeave={off}
      />
      <EdgeLabelRenderer>
        <div
          // nodrag/nopan: interagir aqui não deve arrastar o canvas. O mesmo hover
          // vale para o botão — sair da linha para o × não pode escondê-lo.
          className="nodrag nopan absolute flex items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onMouseEnter={on}
          onMouseLeave={off}
        >
          {branch && (
            <span
              className={`text-[10px] font-bold px-1 rounded bg-white/80 dark:bg-slate-900/80 ${
                branch === 'V' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {branch}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            title="Remover conexão"
            className={`flex items-center justify-center w-4 h-4 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-400 shadow-sm transition-opacity hover:bg-rose-500 hover:text-white hover:border-rose-500 ${
              show ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <X size={9} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
