// Codificação de IDs para o drag-and-drop. Dois sistemas convivem no mesmo
// DndContext: tarefas (issues) e sprints. Prefixos evitam colisão e permitem
// filtrar a detecção de colisão por tipo do item arrastado.

export const C_BACKLOG = 'c:backlog';
export const cSprintBody = (sprintId: string) => `c:b:${sprintId}`; // droppable de issues da sprint
export const cLane = (laneKey: string) => `c:l:${laneKey}`; // droppable de sprints da raia

export const issueDragId = (issueId: number) => `i:${issueId}`;
export const sprintDragId = (sprintId: string) => `s:${sprintId}`;

export const isIssueDrag = (id: string | number) => String(id).startsWith('i:');
export const isSprintDrag = (id: string | number) => String(id).startsWith('s:');

export const parseIssueId = (dragId: string | number) => Number(String(dragId).slice(2));
export const parseSprintId = (dragId: string | number) => String(dragId).slice(2);

// Container de issues (chave interna 'backlog' ou sprintId) a partir de um id de
// over (que pode ser o próprio container, ou um item issue dentro dele).
export function issueContainerKey(overId: string, items: Record<string, string[]>): string | null {
  if (overId === C_BACKLOG) return 'backlog';
  if (overId.startsWith('c:b:')) return overId.slice(4);
  if (isIssueDrag(overId)) return Object.keys(items).find((k) => items[k].includes(overId)) ?? null;
  return null;
}
