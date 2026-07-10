// Export/Import de automações. Como um workflow é só um grafo JSON, dá para
// copiar/colar entre pessoas e montar uma biblioteca de templates da equipe.
//
// No import os ids dos nós são REGERADOS (e as arestas remapeadas): dois
// workflows nunca compartilham ids, evitando colisão de tags de notificação e
// afins. Campos de runtime (timestamps, runCount) não são exportados.
import { newId, type Workflow, type WorkflowNode } from '../../api/workflows';

const MAGIC = 'bluemine.workflow';

interface ExportShape {
  _t: typeof MAGIC;
  v: 1;
  name: string;
  nodes: WorkflowNode[];
}

export function exportWorkflow(wf: Workflow): string {
  const payload: ExportShape = {
    _t: MAGIC,
    v: 1,
    name: wf.name,
    nodes: wf.nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      type: n.type,
      config: n.config,
      position: n.position,
      nextIds: n.nextIds,
      ...(n.kind === 'branch' ? { elseIds: n.elseIds ?? [] } : {}),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

// Aceita o formato exportado OU um objeto cru { name?, nodes[] }. Lança em
// entrada inválida (o chamador mostra o erro).
export function importWorkflow(text: string): { name: string; nodes: WorkflowNode[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON inválido — cole o texto exportado de uma automação.');
  }
  const obj = parsed as Partial<ExportShape>;
  if (!obj || !Array.isArray(obj.nodes)) {
    throw new Error('Formato não reconhecido (esperado um objeto com "nodes").');
  }

  // Regenera ids e remapeia as arestas.
  const idMap = new Map<string, string>();
  for (const n of obj.nodes) {
    if (n && typeof n.id === 'string') idMap.set(n.id, newId());
  }
  const remap = (ids: unknown): string[] =>
    Array.isArray(ids)
      ? ids.map((id) => idMap.get(String(id))).filter((x): x is string => !!x)
      : [];

  const nodes: WorkflowNode[] = obj.nodes
    .filter((n): n is WorkflowNode => !!n && typeof n === 'object')
    .map((n) => {
      const kind = n.kind;
      const node: WorkflowNode = {
        id: idMap.get(n.id) ?? newId(),
        kind,
        type: typeof n.type === 'string' ? n.type : '',
        config: n.config && typeof n.config === 'object' ? n.config : {},
        position: n.position && typeof n.position === 'object' ? n.position : { x: 0, y: 0 },
        nextIds: remap(n.nextIds),
      };
      if (kind === 'branch') node.elseIds = remap(n.elseIds);
      return node;
    });

  return {
    name: typeof obj.name === 'string' && obj.name ? obj.name : 'Automação importada',
    nodes,
  };
}
