// Aba "Automações": lista as automações do usuário e abre o editor visual.
// Cada automação é um grafo gatilho→condição→ação executado pelo motor de
// polling do servidor. Aqui cuidamos de criar/listar/ativar/excluir.
import { useState } from 'react';
import {
  Workflow as WorkflowIcon,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Copy,
  CopyPlus,
  Upload,
  Check,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  useWorkflows,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
} from '../hooks/useWorkflows';
import {
  descriptorFor,
  triggerSummary,
  hasWriteAction,
  activationBlockers,
} from './workflow/nodeCatalog';
import { WorkflowEditor } from './workflow/WorkflowEditor';
import { RecipesGallery } from './workflow/RecipesGallery';
import { ConfirmDialog } from './workflow/ConfirmDialog';
import { exportWorkflow, importWorkflow, cloneWorkflow } from './workflow/share';
import type { Recipe } from './workflow/recipes';
import type { Workflow } from '../api/workflows';

export function WorkflowsView(_props: { onIssueClick?: (id: number) => void } = {}) {
  const { data: workflows, isLoading } = useWorkflows();
  const create = useCreateWorkflow();
  const update = useUpdateWorkflow();
  const del = useDeleteWorkflow();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toDelete, setToDelete] = useState<Workflow | null>(null);

  const editing = workflows?.find((w) => w.id === editingId) ?? null;

  const importFromText = async (text: string) => {
    const { name, nodes } = importWorkflow(text); // lança em entrada inválida
    const wf = await create.mutateAsync({ name, enabled: false, nodes });
    setImporting(false);
    setEditingId(wf.id);
  };

  const duplicate = async (wf: Workflow) => {
    const { name, nodes } = cloneWorkflow(wf);
    const copy = await create.mutateAsync({ name, enabled: false, nodes });
    setEditingId(copy.id);
  };

  const createBlank = async () => {
    const wf = await create.mutateAsync({ name: 'Nova automação', enabled: false, nodes: [] });
    setGallery(false);
    setEditingId(wf.id);
  };

  const createFromRecipe = async (recipe: Recipe) => {
    const wf = await create.mutateAsync({
      name: recipe.name,
      enabled: false,
      nodes: recipe.build(),
    });
    setGallery(false);
    setEditingId(wf.id);
  };

  if (editing) {
    return <WorkflowEditor workflow={editing} onBack={() => setEditingId(null)} />;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-800 dark:text-slate-100">
            <WorkflowIcon size={20} /> Automações
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Quando algo acontecer (gatilho), aplique condições e execute ações — no estilo n8n.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImporting(true)}
            disabled={create.isPending}
            title="Colar uma automação exportada"
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Upload size={15} /> Importar
          </button>
          <button
            onClick={() => setGallery(true)}
            disabled={create.isPending}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={16} /> Nova automação
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : !workflows || workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="rounded-2xl p-4 bg-blue-500/10 text-blue-500 mb-4">
            <Sparkles size={28} />
          </span>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Nenhuma automação ainda
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
            Comece por uma receita pronta — “cutucar tarefas paradas”, “alerta de prazo”, “triagem
            de menções com IA” — e ajuste do seu jeito.
          </p>
          <button
            onClick={() => setGallery(true)}
            className="mt-4 flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            <Plus size={15} /> Ver receitas
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {workflows.map((wf) => (
            <WorkflowRow
              key={wf.id}
              wf={wf}
              onOpen={() => setEditingId(wf.id)}
              onToggle={(enabled) => update.mutate({ id: wf.id, patch: { enabled } })}
              onDuplicate={() => duplicate(wf)}
              onDelete={() => setToDelete(wf)}
            />
          ))}
        </ul>
      )}

      {gallery && (
        <RecipesGallery
          onPick={createFromRecipe}
          onBlank={createBlank}
          onClose={() => setGallery(false)}
          busy={create.isPending}
        />
      )}

      {importing && (
        <ImportModal
          onImport={importFromText}
          onClose={() => setImporting(false)}
          busy={create.isPending}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title="Excluir automação"
          message={
            <>
              Excluir <strong>{toDelete.name}</strong>? Esta ação não pode ser desfeita.
            </>
          }
          confirmLabel="Excluir"
          danger
          onConfirm={() => del.mutate(toDelete.id)}
          onClose={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

function ImportModal({
  onImport,
  onClose,
  busy,
}: {
  onImport: (text: string) => Promise<void>;
  onClose: () => void;
  busy?: boolean;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      await onImport(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Importar automação
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cole o texto exportado (botão de copiar em cada automação). Abre um rascunho inativo
            para você conferir e completar.
          </p>
        </div>
        <div className="p-5 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder='{ "_t": "bluemine.workflow", ... }'
            className="w-full text-xs font-mono rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
          />
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              onClick={submit}
              disabled={busy || !text.trim()}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Upload size={14} /> Importar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkflowRow({
  wf,
  onOpen,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  wf: Workflow;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const actionCount = wf.nodes.filter((n) => n.kind === 'action').length;
  const trigger = wf.nodes.find((n) => n.kind === 'trigger');
  const TriggerIcon = trigger ? descriptorFor(trigger.type)?.icon : undefined;
  const [dialog, setDialog] = useState<'blockers' | 'risky' | null>(null);

  // Ativar daqui também pode disparar uma varredura ampla com escrita — mesmo
  // aviso do editor (é o ato de ativar que causa o estrago, não o de salvar).
  const risky =
    trigger?.type === 'issue.scan' && trigger.config?.scope === 'all' && hasWriteAction(wf.nodes);
  const blockers = activationBlockers(wf.nodes);

  const requestToggle = (checked: boolean) => {
    if (!checked) return onToggle(false);
    if (blockers.length) return setDialog('blockers');
    if (risky) return setDialog('risky');
    onToggle(true);
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 px-4 py-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-800 dark:text-slate-100 truncate">{wf.name}</span>
          {!wf.enabled && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
              inativa
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 flex-shrink-0">
            {TriggerIcon && <TriggerIcon size={11} />}
            {triggerSummary(wf.nodes)}
          </span>
          <span className="flex-shrink-0">
            {actionCount} {actionCount === 1 ? 'ação' : 'ações'}
          </span>
          {wf.lastRunAt && (
            <span className="truncate">
              · rodou {formatDistanceToNow(wf.lastRunAt, { addSuffix: true, locale: ptBR })}
            </span>
          )}
          {typeof wf.runCount === 'number' && wf.runCount > 0 && (
            <span className="flex-shrink-0">· {wf.runCount}×</span>
          )}
        </div>
      </button>

      {/* Toggle ativa/inativa */}
      <label className="flex items-center cursor-pointer" title={wf.enabled ? 'Ativa' : 'Inativa'}>
        <input
          type="checkbox"
          checked={wf.enabled}
          onChange={(e) => requestToggle(e.target.checked)}
          className="sr-only peer"
        />
        <div className="relative w-9 h-5 bg-slate-300 dark:bg-slate-600 rounded-full peer peer-checked:bg-blue-600 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-4" />
      </label>

      <button
        onClick={onDuplicate}
        className="p-1.5 text-slate-400 hover:text-blue-500"
        title="Duplicar automação"
      >
        <CopyPlus size={16} />
      </button>

      <CopyButton wf={wf} />

      <button
        onClick={onDelete}
        className="p-1.5 text-slate-400 hover:text-red-500"
        title="Excluir"
      >
        <Trash2 size={16} />
      </button>

      {dialog === 'blockers' && (
        <ConfirmDialog
          title="Ainda não dá para ativar"
          message={
            <>
              Complete antes de ativar <strong>{wf.name}</strong>:
              <ul className="mt-2 list-disc pl-4 space-y-0.5">
                {blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </>
          }
          confirmLabel="Entendi"
          hideCancel
          onConfirm={() => {}}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'risky' && (
        <ConfirmDialog
          danger
          title="Ativar varredura ampla?"
          message={
            <>
              <strong>{wf.name}</strong> age sobre <strong>todas</strong> as suas tarefas e executa
              ações de escrita — não há desfazer. Abra a automação e use <strong>Prévia</strong>{' '}
              antes.
            </>
          }
          confirmLabel="Ativar mesmo assim"
          onConfirm={() => onToggle(true)}
          onClose={() => setDialog(null)}
        />
      )}
    </li>
  );
}

function CopyButton({ wf }: { wf: Workflow }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportWorkflow(wf));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard bloqueado (contexto inseguro): mostra o JSON para copiar à mão.
      prompt('Copie o texto da automação:', exportWorkflow(wf));
    }
  };
  return (
    <button
      onClick={copy}
      className="p-1.5 text-slate-400 hover:text-blue-500"
      title="Copiar automação (para compartilhar/importar)"
    >
      {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
    </button>
  );
}
