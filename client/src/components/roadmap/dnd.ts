// IDs de drag-and-drop da Roadmap. Só existe um sistema aqui: tarefas (issues)
// sendo soltas numa versão ou no backlog "Sem versão". O encode da issue é
// reaproveitado do Sprints (i:<id>) para manter o mesmo padrão de card.
export { issueDragId, parseIssueId, isIssueDrag } from '../sprints/dnd';

export const C_BACKLOG = 'rc:backlog';

// Corpo droppable de uma versão. Carrega projectId + versionId porque a
// gravação (fixed_version_id) e a busca de tarefas são por projeto+versão.
export const cVersionBody = (projectId: number, versionId: number) =>
  `rc:v:${projectId}:${versionId}`;

export const isVersionBody = (id: string) => id.startsWith('rc:v:');

export function parseVersionBody(id: string): { projectId: number; versionId: number } | null {
  if (!isVersionBody(id)) return null;
  const [, , p, v] = id.split(':');
  return { projectId: Number(p), versionId: Number(v) };
}
