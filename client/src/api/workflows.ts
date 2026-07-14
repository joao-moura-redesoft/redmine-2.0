import { createAuthedClient } from './client';

// ---------------------------------------------------------------------------
// Modelo de dados (grafo, espelha o server/routes/workflows.js). Um workflow é
// uma automação: exatamente 1 nó `trigger` + nós `filter`/`action` ligados por
// `nextIds`. As posições vivem no próprio nó (canvas React Flow).
// ---------------------------------------------------------------------------
export type NodeKind = 'trigger' | 'filter' | 'action' | 'branch';

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  type: string; // ex.: 'issue.status_changed', 'talk.send', 'issue.comment'
  config: Record<string, unknown>;
  position: { x: number; y: number };
  nextIds: string[]; // ramo padrão (e ramo "verdadeiro" de um nó branch)
  elseIds?: string[]; // ramo "falso" de um nó branch (Se/senão)
}

export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount?: number;
}

export type WorkflowPatch = Partial<Pick<Workflow, 'name' | 'enabled' | 'nodes'>>;

// Id gerado no cliente (criação otimista sem troca de id ao responder o server).
export const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const api = createAuthedClient();

export async function fetchWorkflows(): Promise<Workflow[]> {
  const { data } = await api.get<Workflow[]>('/workflows');
  return data;
}

export async function createWorkflow(
  patch: WorkflowPatch & { id?: string } = {},
): Promise<Workflow> {
  const { data } = await api.post<Workflow>('/workflows', patch);
  return data;
}

export async function updateWorkflow(id: string, patch: WorkflowPatch): Promise<Workflow> {
  const { data } = await api.put<Workflow>(`/workflows/${id}`, patch);
  return data;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api.delete(`/workflows/${id}`);
}

// Executa o workflow com contexto de exemplo (ignora filtros; não escreve em
// tarefas reais) para testar as ações sem esperar um evento real.
export async function runWorkflow(id: string): Promise<void> {
  await api.post(`/workflows/${id}/run`);
}

// Execução manual REAL (gatilho workflow.manual): respeita filtros e executa as
// ações de verdade. `issueId` opcional injeta a tarefa do card no contexto.
export async function triggerWorkflow(id: string, issueId?: number): Promise<void> {
  await api.post(`/workflows/${id}/trigger`, issueId ? { issueId } : {});
}

export interface WorkflowRunAction {
  type: string;
  ok: boolean;
  error?: string;
  /** true quando a falha interrompeu o ramo (config `onError: 'stop'`). */
  stopped?: boolean;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  at: number;
  mode: 'auto' | 'manual';
  trigger: string;
  event: string;
  ok: boolean;
  actions: WorkflowRunAction[];
  /** Tarefas que ficaram para a próxima execução por causa do teto. */
  truncated?: number;
  /** Rastro da execução: nodeId → desfecho ('ok'|'error'|'passed'|'stopped'|'true'|'false'). */
  nodes?: Record<string, string>;
  /** Rótulo do que disparou (ex.: "#42 Corrigir login"). */
  context?: string;
}

// ---------------------------------------------------------------------------
// Prévia da varredura: quais tarefas casam AGORA, sem executar nada.
// ---------------------------------------------------------------------------
export interface PreviewMatch {
  id: number;
  subject: string;
  actions: string[];
  indeterminate: boolean;
}

export interface PreviewResult {
  scopeCount: number;
  matchedCount: number;
  /** Tarefas cuja condição depende da saída de uma ação (ex.: IA) — indecidível. */
  indeterminate: number;
  cap: number;
  matched: PreviewMatch[];
}

export async function previewWorkflow(id: string): Promise<PreviewResult> {
  const { data } = await api.post<PreviewResult>(`/workflows/${id}/preview`);
  return data;
}

export async function fetchWorkflowRuns(id: string): Promise<WorkflowRun[]> {
  const { data } = await api.get<WorkflowRun[]>(`/workflows/${id}/runs`);
  return data;
}
