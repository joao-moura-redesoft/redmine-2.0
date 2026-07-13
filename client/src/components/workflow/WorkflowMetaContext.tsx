// Listas do Redmine/Talk usadas pelo editor de automações. Ficam num contexto
// porque os nós customizados do React Flow só recebem `data` — não dá para passar
// props até eles. O card do nó precisa disso para escrever `Status = Em andamento`
// em vez de `status = 3`.
//
// As queries são as mesmas já usadas pelo painel de config; o react-query
// deduplica, então isto não gera requisições extras.
import { createContext, useContext, useMemo } from 'react';
import {
  useStatuses,
  usePriorities,
  useAllMembers,
  useProjects,
  useTrackers,
  useCustomFieldDefs,
  useTimeEntryActivities,
} from '../../hooks/useRedmine';
import { useTalkRooms } from '../../hooks/useTalk';
import type { Opt } from './filterFields';

export interface WorkflowMeta {
  statuses: Opt[];
  priorities: Opt[];
  trackers: Opt[];
  projects: Opt[];
  /** Membros com "Eu (mim)" no topo. */
  members: Opt[];
  rooms: Opt[];
  /** Campos personalizados como opções de campo (id "cf:<id>"). */
  customFields: Opt[];
  activities: Opt[];
}

const EMPTY: WorkflowMeta = {
  statuses: [],
  priorities: [],
  trackers: [],
  projects: [],
  members: [],
  rooms: [],
  customFields: [],
  activities: [],
};

const Ctx = createContext<WorkflowMeta>(EMPTY);

export const useWorkflowMeta = () => useContext(Ctx);

export function WorkflowMetaProvider({ children }: { children: React.ReactNode }) {
  const statuses = useStatuses();
  const priorities = usePriorities();
  const trackers = useTrackers();
  const projects = useProjects();
  const members = useAllMembers();
  const rooms = useTalkRooms();
  const customFieldDefs = useCustomFieldDefs();
  const activities = useTimeEntryActivities();

  const value = useMemo<WorkflowMeta>(
    () => ({
      statuses: statuses.data ?? [],
      priorities: priorities.data ?? [],
      trackers: trackers.data ?? [],
      projects: (projects.data ?? []).map((p) => ({ id: p.id, name: p.name })),
      members: [{ id: 'me', name: 'Eu (mim)' }, ...(members.data ?? [])],
      rooms: (rooms.data ?? []).map((r) => ({ id: r.token, name: r.displayName || r.name })),
      customFields: (customFieldDefs.data ?? []).map((cf) => ({
        id: `cf:${cf.id}`,
        name: cf.name,
      })),
      activities: activities.data ?? [],
    }),
    [
      statuses.data,
      priorities.data,
      trackers.data,
      projects.data,
      members.data,
      rooms.data,
      customFieldDefs.data,
      activities.data,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
