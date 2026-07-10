// Editor visual de uma automação (canvas React Flow, estilo n8n). Fonte de
// verdade da config/arestas vive nos próprios nós/edges do React Flow; ao salvar,
// serializamos de volta para o shape Workflow (position + nextIds/elseIds).
// Um workflow tem no máximo 1 gatilho.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  Play,
  Loader2,
  History,
  Settings2,
  Search,
  LayoutGrid,
  CheckCircle2,
  XCircle,
  Eye,
  AlertTriangle,
  Route,
} from 'lucide-react';
import { WorkflowNodeView, type WfNodeData } from './nodes/WorkflowNodeView';
import { NodeConfigPanel } from './NodeConfigPanel';
import { RunLogPanel } from './RunLogPanel';
import { PreviewModal } from './PreviewModal';
import { WorkflowMetaProvider } from './WorkflowMetaContext';
import { WorkflowEdge, EdgeActionsContext } from './edges/WorkflowEdge';
import { RunTrailProvider } from './RunTrailContext';
import {
  TRIGGERS,
  FILTERS,
  ACTIONS,
  makeNode,
  hasWriteAction,
  activationBlockers,
  type NodeDescriptor,
} from './nodeCatalog';
import { useUpdateWorkflow, useWorkflowRuns } from '../../hooks/useWorkflows';
import { runWorkflow, previewWorkflow, type PreviewResult } from '../../api/workflows';
import type { Workflow, WorkflowNode } from '../../api/workflows';

type WfNode = Node<WfNodeData, 'wf'>;

const DND_MIME = 'application/bluemine-node';

const toRfNodes = (wf: Workflow): WfNode[] =>
  wf.nodes.map((n) => ({ id: n.id, type: 'wf', position: n.position, data: { node: n } }));

// Toda aresta usa o tipo customizado 'wf' (WorkflowEdge), que desenha a curva,
// o botão de excluir e o rótulo V/F do branch (derivado do sourceHandle).
const decorateEdge = (e: Edge): Edge => ({
  ...e,
  type: 'wf',
  markerEnd: { type: MarkerType.ArrowClosed },
});

const toRfEdges = (wf: Workflow): Edge[] =>
  wf.nodes.flatMap((n) => {
    const isBranch = n.kind === 'branch';
    const trueEdges: Edge[] = (n.nextIds || []).map((t) =>
      decorateEdge({
        id: `${n.id}-t-${t}`,
        source: n.id,
        target: t,
        ...(isBranch ? { sourceHandle: 'true' } : {}),
      }),
    );
    const falseEdges: Edge[] = isBranch
      ? (n.elseIds || []).map((t) =>
          decorateEdge({ id: `${n.id}-f-${t}`, source: n.id, target: t, sourceHandle: 'false' }),
        )
      : [];
    return [...trueEdges, ...falseEdges];
  });

export function WorkflowEditor(props: { workflow: Workflow; onBack: () => void }) {
  // useReactFlow (screenToFlowPosition, fitView) exige o ReactFlowProvider.
  // WorkflowMetaProvider dá aos nós customizados as listas do Redmine/Talk — eles
  // só recebem `data`, então não dá para passar props até lá.
  return (
    <ReactFlowProvider>
      <WorkflowMetaProvider>
        <EditorInner {...props} />
      </WorkflowMetaProvider>
    </ReactFlowProvider>
  );
}

function EditorInner({ workflow, onBack }: { workflow: Workflow; onBack: () => void }) {
  const update = useUpdateWorkflow();
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState(workflow.name);
  const [enabled, setEnabled] = useState(workflow.enabled);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tab, setTab] = useState<'config' | 'runs'>('config');
  const [showLastRun, setShowLastRun] = useState(false);
  const [query, setQuery] = useState('');
  const [flash, setFlash] = useState<{ ok: boolean; msg: string } | null>(null);
  const [preview, setPreview] = useState<{
    open: boolean;
    loading: boolean;
    result: PreviewResult | null;
    error: string | null;
  } | null>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<WfNode>(toRfNodes(workflow));
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(toRfEdges(workflow));

  const nodeTypes = useMemo(() => ({ wf: WorkflowNodeView }), []);
  const edgeTypes = useMemo(() => ({ wf: WorkflowEdge }), []);

  // Rastro da última execução (item 2): pinta no canvas quais nós/ramo rodaram.
  const runs = useWorkflowRuns(workflow.id, showLastRun);
  const trail = showLastRun ? runs.data?.[0]?.nodes ?? null : null;
  const markDirty = useCallback(() => setDirty(true), []);

  // Remove uma aresta (botão × na conexão). A ação chega ao WorkflowEdge por
  // context; estável via useCallback para não recriar edgeTypes/contexto à toa.
  const deleteEdge = useCallback(
    (id: string) => {
      setRfEdges((prev) => prev.filter((e) => e.id !== id));
      markDirty();
    },
    [setRfEdges, markDirty],
  );
  const edgeActions = useMemo(() => ({ onDelete: deleteEdge }), [deleteEdge]);

  // Arestas animadas só quando a automação está ativa — dá a sensação de "viva".
  const shownEdges = useMemo(() => rfEdges.map((e) => ({ ...e, animated: enabled })), [rfEdges, enabled]);

  // Feedback inline (some sozinho) — evita alert() no meio do canvas.
  const showFlash = (ok: boolean, msg: string) => {
    setFlash({ ok, msg });
    setTimeout(() => setFlash(null), 4000);
  };

  // Só posição/remoção sujam o workflow; seleção não.
  const handleNodesChange = useCallback(
    (changes: NodeChange<WfNode>[]) => {
      onNodesChange(changes);
      if (changes.some((c) => (c.type === 'position' && c.dragging === false) || c.type === 'remove'))
        markDirty();
    },
    [onNodesChange, markDirty],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      setRfEdges((eds) => addEdge(decorateEdge(conn as Edge), eds));
      markDirty();
    },
    [setRfEdges, markDirty],
  );

  const hasTrigger = rfNodes.some((n) => n.data.node.kind === 'trigger');

  const addNodeAt = (d: NodeDescriptor, pos: { x: number; y: number }) => {
    if (d.kind === 'trigger' && hasTrigger) return;
    const wfNode = makeNode(d, pos);
    setRfNodes((prev) => [...prev, { id: wfNode.id, type: 'wf', position: pos, data: { node: wfNode } }]);
    setSelectedId(wfNode.id);
    setTab('config');
    markDirty();
  };

  // Clique na paleta: insere no CENTRO do viewport (não numa posição aleatória).
  const addNodeCentered = (d: NodeDescriptor) => {
    const box = canvasRef.current?.getBoundingClientRect();
    const pos = box
      ? screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 3 })
      : { x: 200, y: 100 };
    addNodeAt(d, pos);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DND_MIME);
    const d = PALETTE.flatMap((g) => g.items).find((x) => x.type === type);
    if (!d) return;
    addNodeAt(d, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const selected = rfNodes.find((n) => n.id === selectedId) ?? null;
  const triggerType = rfNodes.find((n) => n.data.node.kind === 'trigger')?.data.node.type;

  // Tipos dos nós ANCESTRAIS do selecionado — definem quais saídas ({{ai.label}},
  // {{webhook.status}}, {{created.id}}) existem ali. Mesma ideia do getPreviousSteps
  // do Twenty: sobe pelos pais, à prova de ciclo.
  const { upstreamTypes, aiLabels } = useMemo(() => {
    const empty = { upstreamTypes: new Set<string>(), aiLabels: [] as string[] };
    if (!selectedId) return empty;
    const parents = new Map<string, string[]>();
    for (const e of rfEdges) {
      if (!parents.has(e.target)) parents.set(e.target, []);
      parents.get(e.target)!.push(e.source);
    }
    const seen = new Set<string>([selectedId]);
    const queue = [selectedId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const p of parents.get(cur) ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        queue.push(p);
      }
    }
    seen.delete(selectedId);
    const ancestors = rfNodes.filter((n) => seen.has(n.id)).map((n) => n.data.node);
    const labels = ancestors
      .filter((n) => n.type === 'ai.classify')
      .flatMap((n) => (Array.isArray(n.config?.labels) ? (n.config.labels as string[]) : []));
    return { upstreamTypes: new Set(ancestors.map((n) => n.type)), aiLabels: labels };
  }, [selectedId, rfEdges, rfNodes]);

  const updateSelectedConfig = (config: Record<string, unknown>) => {
    setRfNodes((prev) =>
      prev.map((n) => (n.id === selectedId ? { ...n, data: { node: { ...n.data.node, config } } } : n)),
    );
    markDirty();
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setRfNodes((prev) => prev.filter((n) => n.id !== selectedId));
    setRfEdges((prev) => prev.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
    markDirty();
  }, [selectedId, setRfNodes, setRfEdges, markDirty]);

  const save = useCallback(async () => {
    const nodes: WorkflowNode[] = rfNodes.map((rn) => {
      const base = rn.data.node;
      const out = rfEdges.filter((e) => e.source === rn.id);
      if (base.kind === 'branch') {
        return {
          ...base,
          position: rn.position,
          nextIds: out.filter((e) => e.sourceHandle !== 'false').map((e) => e.target),
          elseIds: out.filter((e) => e.sourceHandle === 'false').map((e) => e.target),
        };
      }
      const node: WorkflowNode = { ...base, position: rn.position, nextIds: out.map((e) => e.target) };
      delete node.elseIds; // ramo "falso" só existe em nós branch
      return node;
    });
    await update.mutateAsync({ id: workflow.id, patch: { name, enabled, nodes } });
    setDirty(false);
  }, [rfNodes, rfEdges, name, enabled, update, workflow.id]);

  const test = async () => {
    setTesting(true);
    try {
      await save();
      await runWorkflow(workflow.id);
      showFlash(true, 'Teste disparado — veja o Histórico');
      setTab('runs');
    } catch (e) {
      showFlash(false, e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  // Prévia: salva (para o servidor avaliar o grafo atual) e consulta as condições.
  const runPreview = async () => {
    setPreview({ open: true, loading: true, result: null, error: null });
    try {
      await save();
      const result = await previewWorkflow(workflow.id);
      setPreview({ open: true, loading: false, result, error: null });
    } catch (e) {
      setPreview({
        open: true,
        loading: false,
        result: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const isScan = triggerType === 'issue.scan';
  const scanScope = rfNodes.find((n) => n.data.node.kind === 'trigger')?.data.node.config?.scope;
  const nodeList = rfNodes.map((n) => n.data.node);
  // O estrago irreversível mora aqui: varredura de escopo amplo + ação de escrita.
  const riskyScan = isScan && scanScope === 'all' && hasWriteAction(nodeList);
  // Pendências que impedem ATIVAR (config incompleta / sem gatilho / sem ação).
  const blockers = activationBlockers(nodeList);

  // Auto-layout hierárquico simples (BFS a partir do gatilho). Sem dagre.
  const autoLayout = () => {
    const trigger = rfNodes.find((n) => n.data.node.kind === 'trigger');
    if (!trigger) return;
    const children = new Map<string, string[]>();
    for (const e of rfEdges) {
      if (!children.has(e.source)) children.set(e.source, []);
      children.get(e.source)!.push(e.target);
    }
    const level = new Map<string, number>([[trigger.id, 0]]);
    const queue = [trigger.id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const t of children.get(cur) ?? []) {
        if (level.has(t)) continue;
        level.set(t, (level.get(cur) ?? 0) + 1);
        queue.push(t);
      }
    }
    // Nós soltos (sem caminho a partir do gatilho) vão para a última fileira.
    const maxLvl = Math.max(0, ...level.values());
    for (const n of rfNodes) if (!level.has(n.id)) level.set(n.id, maxLvl + 1);

    const byLevel = new Map<number, string[]>();
    for (const n of rfNodes) {
      const l = level.get(n.id)!;
      if (!byLevel.has(l)) byLevel.set(l, []);
      byLevel.get(l)!.push(n.id);
    }
    const COL = 280;
    const ROW = 150;
    setRfNodes((prev) =>
      prev.map((n) => {
        const l = level.get(n.id)!;
        const row = byLevel.get(l)!;
        const i = row.indexOf(n.id);
        return { ...n, position: { x: (i - (row.length - 1) / 2) * COL, y: l * ROW } };
      }),
    );
    markDirty();
    setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 20);
  };

  // Atalhos: Delete/Backspace remove o nó OU as arestas selecionadas; Ctrl+S salva.
  // Nunca quando o foco está num campo (senão apagaria ao editar a config).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          e.preventDefault();
          deleteSelected();
        } else if (rfEdges.some((ed) => ed.selected)) {
          e.preventDefault();
          setRfEdges((prev) => prev.filter((ed) => !ed.selected));
          markDirty();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save().then(() => showFlash(true, 'Salvo')).catch(() => showFlash(false, 'Falha ao salvar'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, deleteSelected, save, rfEdges, setRfEdges, markDirty]);

  const paletteFiltered = PALETTE.map((g) => ({
    ...g,
    items: g.items.filter(
      (d) =>
        !query ||
        d.label.toLowerCase().includes(query.toLowerCase()) ||
        d.description.toLowerCase().includes(query.toLowerCase()),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
          title="Voltar"
        >
          <ArrowLeft size={17} />
        </button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
          className="flex-1 min-w-0 text-base font-semibold bg-transparent text-slate-800 dark:text-slate-100 focus:outline-none"
          placeholder="Nome da automação"
        />

        {flash && (
          <span
            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md ${
              flash.ok
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
            }`}
          >
            {flash.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            <span className="max-w-[220px] truncate">{flash.msg}</span>
          </span>
        )}

        <button
          onClick={() => setShowLastRun((v) => !v)}
          title="Destacar o caminho da última execução no canvas"
          className={`p-1.5 rounded-md border ${
            showLastRun
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300'
          } hover:bg-slate-100 dark:hover:bg-slate-800`}
        >
          <Route size={15} />
        </button>
        <button
          onClick={autoLayout}
          title="Organizar os nós"
          className="p-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <LayoutGrid size={15} />
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer px-1">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              if (e.target.checked) {
                // Não deixa ativar com config incompleta — o erro estouraria só na
                // hora de rodar, indo parar no log em vez de na sua frente.
                if (blockers.length) {
                  showFlash(false, `Complete antes de ativar: ${blockers[0]}`);
                  return;
                }
                // Ativar é o momento do estrago (varredura ampla + escrita), não salvar.
                if (
                  riskyScan &&
                  !confirm(
                    'Esta varredura age sobre TODAS as suas tarefas e executa ações de escrita ' +
                      '(comentar/atualizar/enviar). Não há desfazer.\n\n' +
                      'Recomendado: use "Prévia" antes. Ativar mesmo assim?',
                  )
                ) {
                  return;
                }
              }
              setEnabled(e.target.checked);
              markDirty();
            }}
            className="rounded text-blue-600 focus:ring-blue-500"
          />
          Ativa
        </label>
        {/* Sempre visível: um botão que simplesmente não existe não ensina que a
            prévia depende do gatilho de varredura. Desabilitado explica o porquê. */}
        <button
          onClick={runPreview}
          disabled={!isScan || update.isPending}
          title={
            isScan
              ? 'Ver quais tarefas casam agora, sem executar nada'
              : 'Disponível apenas no gatilho “Varredura de tarefas (agendada)” — é ele que percorre suas tarefas'
          }
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <Eye size={15} />
          Prévia
        </button>
        <button
          onClick={test}
          disabled={testing || update.isPending}
          title="Salva e executa com dados de exemplo"
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {testing ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          Testar
        </button>
        <button
          onClick={() => save().then(() => showFlash(true, 'Salvo'))}
          disabled={update.isPending || !dirty}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={15} />
          {dirty ? 'Salvar' : 'Salvo'}
        </button>
      </div>

      {riskyScan && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            Esta varredura age sobre <strong>todas</strong> as suas tarefas e executa ações de
            escrita, sem desfazer. Use <strong>Prévia</strong> antes de ativar, e mantenha um teto
            baixo de tarefas por execução.
          </span>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Paleta */}
        <div className="w-56 flex-shrink-0 border-r border-slate-200 dark:border-slate-700 flex flex-col">
          <div className="p-2 border-b border-slate-200 dark:border-slate-700">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nó…"
                className="w-full text-xs pl-7 pr-2 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-3 scrollbar-thin">
            {paletteFiltered.map((grp) => (
              <div key={grp.label}>
                <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 px-1 mb-1">
                  {grp.label}
                </div>
                <div className="space-y-1">
                  {grp.items.map((d) => {
                    const disabled = d.kind === 'trigger' && hasTrigger;
                    return (
                      <button
                        key={d.type}
                        draggable={!disabled}
                        onDragStart={(e) => e.dataTransfer.setData(DND_MIME, d.type)}
                        onClick={() => addNodeCentered(d)}
                        disabled={disabled}
                        title={disabled ? 'Já existe um gatilho nesta automação' : d.description}
                        className="w-full flex items-center gap-2 text-left text-sm px-2 py-1.5 rounded-md text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed cursor-grab active:cursor-grabbing"
                      >
                        <d.icon size={15} className="flex-shrink-0 text-slate-500" />
                        <span className="truncate">{d.label}</span>
                        <Plus size={13} className="ml-auto flex-shrink-0 text-slate-400" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {paletteFiltered.length === 0 && (
              <p className="text-xs text-slate-400 px-1">Nenhum nó encontrado.</p>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 min-w-0"
          onDrop={onDrop}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
          }}
        >
          <RunTrailProvider value={trail}>
          <EdgeActionsContext.Provider value={edgeActions}>
            <ReactFlow
              nodes={rfNodes}
              edges={shownEdges}
              onNodesChange={handleNodesChange}
              onEdgesChange={(c) => {
                onEdgesChange(c);
                if (c.some((x) => x.type === 'remove')) markDirty();
              }}
              onConnect={onConnect}
              onNodeClick={(_, n) => {
                setSelectedId(n.id);
                setTab('config');
              }}
              onPaneClick={() => setSelectedId(null)}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              deleteKeyCode={null} /* tratamos Delete manualmente (não apagar ao digitar) */
              fitView
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable className="!bg-slate-100 dark:!bg-slate-800" />
            </ReactFlow>
          </EdgeActionsContext.Provider>
          </RunTrailProvider>
        </div>

        {/* Painel direito com abas */}
        <div className="w-72 flex-shrink-0 border-l border-slate-200 dark:border-slate-700 flex flex-col">
          <div className="flex border-b border-slate-200 dark:border-slate-700">
            {(
              [
                ['config', 'Config', Settings2],
                ['runs', 'Histórico', History],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 border-b-2 -mb-px transition-colors ${
                  tab === id
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
            {tab === 'runs' ? (
              <RunLogPanel workflowId={workflow.id} />
            ) : selected ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Configurar nó
                  </span>
                  <button
                    onClick={deleteSelected}
                    className="p-1 text-slate-400 hover:text-red-500"
                    title="Excluir nó (Del)"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <NodeConfigPanel
                  node={selected.data.node}
                  onChange={updateSelectedConfig}
                  triggerType={triggerType}
                  upstreamTypes={upstreamTypes}
                  aiLabels={aiLabels}
                  onPreview={isScan ? runPreview : undefined}
                />
              </>
            ) : (
              <p className="text-xs text-slate-400 mt-6 text-center leading-relaxed">
                Selecione um nó para configurar.
                <br />
                Arraste da paleta para adicionar.
              </p>
            )}
          </div>
        </div>
      </div>

      {preview?.open && (
        <PreviewModal
          result={preview.result}
          loading={preview.loading}
          error={preview.error}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

const PALETTE: { label: string; items: NodeDescriptor[] }[] = [
  { label: 'Gatilhos', items: TRIGGERS },
  { label: 'Condições', items: FILTERS },
  { label: 'Ações', items: ACTIONS },
];
