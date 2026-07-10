// Nó customizado do canvas React Flow. Mostra ícone em chip colorido, título,
// um resumo da config (`summarize`) e um aviso âmbar quando falta configuração
// (`validateNode`) — é isso que faz as receitas indicarem o que completar.
// Gatilhos não têm entrada; branch tem DUAS saídas (verdadeiro / falso).
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { descriptorFor, summarize, validateNode } from '../nodeCatalog';
import { describeRule, type Rule } from '../filterFields';
import { useWorkflowMeta } from '../WorkflowMetaContext';
import { useRunTrail } from '../RunTrailContext';
import type { WorkflowNode } from '../../../api/workflows';

// Desfecho de um nó na última execução → cor da borda + selo no canto.
const TRAIL_STYLE: Record<string, { ring: string; Icon: typeof CheckCircle2; color: string }> = {
  ok: { ring: 'ring-emerald-500', Icon: CheckCircle2, color: 'text-emerald-500' },
  passed: { ring: 'ring-emerald-500', Icon: CheckCircle2, color: 'text-emerald-500' },
  true: { ring: 'ring-emerald-500', Icon: CheckCircle2, color: 'text-emerald-500' },
  error: { ring: 'ring-rose-500', Icon: XCircle, color: 'text-rose-500' },
  stopped: { ring: 'ring-slate-400', Icon: MinusCircle, color: 'text-slate-400' },
  false: { ring: 'ring-slate-400', Icon: MinusCircle, color: 'text-slate-400' },
};

export interface WfNodeData extends Record<string, unknown> {
  node: WorkflowNode;
}

const KIND_STYLE: Record<string, { bg: string; chip: string; label: string }> = {
  trigger: {
    bg: 'bg-amber-50/80 dark:bg-amber-950/30',
    chip: 'bg-amber-400/20 text-amber-700 dark:text-amber-300',
    label: 'Gatilho',
  },
  filter: {
    bg: 'bg-violet-50/80 dark:bg-violet-950/30',
    chip: 'bg-violet-400/20 text-violet-700 dark:text-violet-300',
    label: 'Condição',
  },
  branch: {
    bg: 'bg-violet-50/80 dark:bg-violet-950/30',
    chip: 'bg-violet-400/20 text-violet-700 dark:text-violet-300',
    label: 'Ramificação',
  },
  action: {
    bg: 'bg-sky-50/80 dark:bg-sky-950/30',
    chip: 'bg-sky-400/20 text-sky-700 dark:text-sky-300',
    label: 'Ação',
  },
};

const HANDLE = '!w-3 !h-3 !border-2 !border-white dark:!border-slate-900';

// Quantas regras cabem no card antes de virar "+N".
const MAX_RULES_SHOWN = 4;

// Lista as regras de um nó de condição por extenso, direto no canvas — em vez de
// obrigar a clicar no nó para descobrir o que ele faz.
function RuleList({ node }: { node: WorkflowNode }) {
  const meta = useWorkflowMeta();
  const cfg = (node.config || {}) as { op?: string; rules?: Rule[] };
  const rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  if (rules.length === 0) {
    return <div className="mt-1.5 text-[11px] italic text-slate-400">sem regras — sempre passa</div>;
  }
  const connector = cfg.op === 'or' ? 'OU' : 'E';
  const shown = rules.slice(0, MAX_RULES_SHOWN);

  return (
    <div className="mt-1.5 space-y-0.5">
      {shown.map((rule, i) => (
        <div key={i} className="flex items-baseline gap-1">
          {i > 0 && (
            <span className="text-[9px] font-bold uppercase text-violet-500 dark:text-violet-400 flex-shrink-0">
              {connector}
            </span>
          )}
          <span
            className={`text-[11px] text-slate-600 dark:text-slate-300 truncate ${i > 0 ? '' : 'ml-0'}`}
            title={describeRule(rule, meta)}
          >
            {describeRule(rule, meta)}
          </span>
        </div>
      ))}
      {rules.length > shown.length && (
        <div className="text-[10px] text-slate-400">+{rules.length - shown.length} regra(s)</div>
      )}
    </div>
  );
}

export function WorkflowNodeView({ data, selected }: NodeProps) {
  const node = (data as WfNodeData).node;
  const d = descriptorFor(node.type);
  const Icon = d?.icon;
  const style = KIND_STYLE[node.kind] ?? KIND_STYLE.action;
  const isTrigger = node.kind === 'trigger';
  const isBranch = node.kind === 'branch';
  const isCondition = node.kind === 'filter' || isBranch;

  const missing = validateNode(node);
  // Condições mostram as regras em vez do resumo genérico ("2 regras (E)").
  const subtitle = isCondition ? '' : summarize(node);

  // Destaque da última execução (quando ligado no editor): borda colorida + selo.
  const trail = useRunTrail();
  const outcome = trail?.[node.id];
  const ts = outcome ? TRAIL_STYLE[outcome] : undefined;

  return (
    <div
      className={`group relative min-w-[196px] max-w-[240px] rounded-xl border-2 shadow-sm transition-shadow hover:shadow-md px-3 py-2.5 ${
        missing.length ? 'border-amber-400 dark:border-amber-500' : d?.accent ?? 'border-slate-300'
      } ${style.bg} ${
        selected
          ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-900'
          : ts
            ? `ring-2 ${ts.ring} ring-offset-2 dark:ring-offset-slate-900`
            : ''
      } ${trail && !outcome ? 'opacity-50' : ''}`}
    >
      {ts && (
        <span
          className="absolute -top-2 -right-2 rounded-full bg-white dark:bg-slate-900"
          title={`Última execução: ${outcome}`}
        >
          <ts.Icon size={16} className={ts.color} />
        </span>
      )}
      {!isTrigger && (
        <Handle type="target" position={Position.Top} className={`!bg-slate-400 ${HANDLE}`} />
      )}

      <div className="flex items-start gap-2">
        <span className={`flex-shrink-0 rounded-lg p-1.5 ${style.chip}`}>
          {Icon && <Icon size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500">
            {style.label}
          </div>
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
            {d?.label ?? node.type}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {isCondition && <RuleList node={node} />}

      {missing.length > 0 && (
        <div
          className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400"
          title={`Falta configurar: ${missing.join(', ')}`}
        >
          <AlertTriangle size={11} className="flex-shrink-0" />
          <span className="truncate">Falta: {missing.join(', ')}</span>
        </div>
      )}

      {isBranch ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Bottom}
            style={{ left: '28%' }}
            className={`!bg-emerald-500 ${HANDLE}`}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Bottom}
            style={{ left: '72%' }}
            className={`!bg-rose-500 ${HANDLE}`}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} className={`!bg-slate-400 ${HANDLE}`} />
      )}
    </div>
  );
}
