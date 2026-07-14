import { useMemo, useState } from 'react';
import {
  Map as MapIcon,
  Filter,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  Circle,
  User,
  FolderCheck,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  useProjects,
  useIssues,
  useStatuses,
  useUpdateIssue,
  useAllVersions,
  useVersionIssuesMulti,
  useCurrentUser,
  useMonitoredIssues,
} from '../hooks/useRedmine';
import type { Issue } from '../types/redmine';
import { isClosedStatus } from './sprints/format';
import { IssueRow } from './sprints/IssueRow';
import { C_BACKLOG, parseIssueId, isIssueDrag, parseVersionBody } from './roadmap/dnd';
import { ProjectLane } from './roadmap/ProjectLane';
import { RoadmapBacklog } from './roadmap/RoadmapBacklog';

// Status terminais/abertos que não devem aparecer no backlog "sem versão".
const HIDDEN_BACKLOG_STATUS = /fecha|cancel/i;
const COLLAPSE_KEY = 'bluemine.roadmapLanesCollapsed';
const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#14b8a6', '#ef4444'];

type Override = Map<number, { versionId: number | null; issue: Issue }>;

interface Props {
  onIssueClick?: (id: number) => void;
}

export function RoadmapView({ onIssueClick }: Props) {
  const { data: projects = [] } = useProjects();
  const { data: myIssues = [] } = useIssues();
  const { data: statuses = [] } = useStatuses();
  const { data: currentUser } = useCurrentUser();
  const { data: devIssues = [] } = useMonitoredIssues(); // sou DEV Desenvolvedor (CF 141)
  const updateIssue = useUpdateIssue();
  const qc = useQueryClient();

  const [showClosedVersions, setShowClosedVersions] = useState(false);
  const [hideClosedIssues, setHideClosedIssues] = useState(true); // ocultar tarefas concluídas por padrão
  const [onlyMine, setOnlyMine] = useState(false); // só tarefas atribuídas a mim
  const [onlyMyProjects, setOnlyMyProjects] = useState(true); // só projetos em que participo
  const [selectedProjects, setSelectedProjects] = useState<Set<number> | null>(null); // null = todos
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [backlogProjectFilter, setBacklogProjectFilter] = useState<number | 'all'>('all');
  const [override, setOverride] = useState<Override>(new Map());
  const [activeIssueId, setActiveIssueId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'));
    } catch {
      return new Set();
    }
  });

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const projectName = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of projects) m.set(p.id, p.name);
    return m;
  }, [projects]);

  const { byProject, isLoading: loadingVersions } = useAllVersions(projectIds);

  const closedStatusIds = useMemo(
    () => new Set(statuses.filter((s) => s.is_closed).map((s) => s.id)),
    [statuses],
  );

  const myUserId = currentUser?.id;
  // "Meus projetos" = projetos que têm tarefa minha (como responsável ou como
  // DEV Desenvolvedor), não os projetos que apenas consigo visualizar.
  const myProjectIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of myIssues) if (i.project?.id != null) s.add(i.project.id);
    for (const i of devIssues) if (i.project?.id != null) s.add(i.project.id);
    return s;
  }, [myIssues, devIssues]);

  // Uma raia por projeto consultado que tem ≥1 versão (respeitando o toggle de
  // versões fechadas). Uma versão compartilhada é listada só na raia do projeto
  // DONO (version.project.id) — assim ela não aparece idêntica em todo projeto.
  // Guarda: se o dono não estiver entre os projetos consultados, mantém a versão
  // onde ela veio para não sumir.
  const projectIdSet = useMemo(() => new Set(projectIds), [projectIds]);
  const projectsWithVersions = useMemo(() => {
    return byProject
      .map((bp) => ({
        projectId: bp.projectId,
        projectName: projectName.get(bp.projectId) ?? `Projeto ${bp.projectId}`,
        versions: bp.versions.filter((v) => {
          if (!showClosedVersions && v.status === 'closed') return false;
          const ownerId = v.project?.id;
          return ownerId == null || ownerId === bp.projectId || !projectIdSet.has(ownerId);
        }),
      }))
      .filter((bp) => bp.versions.length > 0);
  }, [byProject, showClosedVersions, projectName, projectIdSet]);

  const visibleLanes = useMemo(
    () =>
      projectsWithVersions.filter(
        (bp) =>
          (!selectedProjects || selectedProjects.has(bp.projectId)) &&
          (!onlyMyProjects || myProjectIds.has(bp.projectId)),
      ),
    [projectsWithVersions, selectedProjects, onlyMyProjects, myProjectIds],
  );

  // Versões das raias expandidas → busca de tarefas (versão inteira).
  const expandedVersionIds = useMemo(() => {
    const ids: number[] = [];
    for (const bp of visibleLanes) {
      if (collapsed.has(bp.projectId)) continue;
      for (const v of bp.versions) ids.push(v.id);
    }
    return ids;
  }, [visibleLanes, collapsed]);

  const { byVersion, issueById: versionIssueById } = useVersionIssuesMulti(expandedVersionIds);

  // Índice global issueId → Issue para resolver o item arrastado.
  const issueLookup = useMemo(() => {
    const m = new Map<number, Issue>();
    for (const i of myIssues) m.set(i.id, i);
    for (const [id, i] of versionIssueById) m.set(id, i);
    for (const [, o] of override) m.set(o.issue.id, o.issue);
    return m;
  }, [myIssues, versionIssueById, override]);

  // Tarefas de uma versão, aplicando os movimentos otimistas (override).
  const issuesByVersion = useMemo(() => {
    return (versionId: number): Issue[] => {
      const base = byVersion.get(versionId) ?? [];
      const movedIn: Issue[] = [];
      for (const o of override.values()) if (o.versionId === versionId) movedIn.push(o.issue);
      let list = base.filter((i) => !override.has(i.id)).concat(movedIn);
      if (onlyMine && myUserId != null) list = list.filter((i) => i.assigned_to?.id === myUserId);
      return list;
    };
  }, [byVersion, override, onlyMine, myUserId]);

  const backlog = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = myIssues.filter(
      (i) =>
        !i.fixed_version &&
        !isClosedStatus(i, closedStatusIds) &&
        !HIDDEN_BACKLOG_STATUS.test(i.status?.name ?? ''),
    );
    const movedToNull: Issue[] = [];
    for (const o of override.values()) if (o.versionId === null) movedToNull.push(o.issue);
    let list = base.filter((i) => !override.has(i.id)).concat(movedToNull);
    if (backlogProjectFilter !== 'all')
      list = list.filter((i) => i.project?.id === backlogProjectFilter);
    if (q) list = list.filter((i) => `#${i.id} ${i.subject}`.toLowerCase().includes(q));
    return list;
  }, [myIssues, override, closedStatusIds, backlogProjectFilter, search]);

  const totalTasks = useMemo(() => {
    let n = 0;
    for (const bp of visibleLanes)
      if (!collapsed.has(bp.projectId))
        for (const v of bp.versions) n += issuesByVersion(v.id).length;
    return n;
  }, [visibleLanes, collapsed, issuesByVersion]);

  // ── Mover tarefa: grava fixed_version_id no Redmine, com feedback otimista ──
  async function moveIssue(issue: Issue, target: { versionId: number } | null) {
    const targetVersionId = target?.versionId ?? null;
    setOverride((prev) => new Map(prev).set(issue.id, { versionId: targetVersionId, issue }));
    try {
      await updateIssue.mutateAsync({
        id: issue.id,
        fields: { fixed_version_id: targetVersionId ?? '' },
      });
      await qc.invalidateQueries({ queryKey: ['roadmap-version-issues'] });
      await qc.invalidateQueries({ queryKey: ['version-issues'] });
      await qc.invalidateQueries({ queryKey: ['issues'] });
    } catch {
      alert('Erro ao mover a tarefa. Verifique suas permissões no Redmine.');
    } finally {
      setOverride((prev) => {
        const n = new Map(prev);
        n.delete(issue.id);
        return n;
      });
    }
  }

  // ── DnD ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const collisionDetection: CollisionDetection = (args) => {
    // Só corpos de versão e o backlog são alvos — ignora os itens ordenáveis,
    // assim o "over" é sempre um container e o drop cai na versão certa.
    const filtered = args.droppableContainers.filter((c) => {
      const id = String(c.id);
      return id === C_BACKLOG || id.startsWith('rc:v:');
    });
    return closestCorners({ ...args, droppableContainers: filtered });
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (isIssueDrag(id)) setActiveIssueId(parseIssueId(id));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    setActiveIssueId(null);
    if (!isIssueDrag(active) || !e.over) return;
    const issue = issueLookup.get(parseIssueId(active));
    if (!issue) return;
    const over = String(e.over.id);
    if (over === C_BACKLOG) {
      if (issue.fixed_version) moveIssue(issue, null);
      return;
    }
    const vb = parseVersionBody(over);
    if (vb && issue.fixed_version?.id !== vb.versionId)
      moveIssue(issue, { versionId: vb.versionId });
  };

  const toggleCollapse = (projectId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const toggleProject = (projectId: number) => {
    setSelectedProjects((prev) => {
      const base = prev ?? new Set(projectsWithVersions.map((bp) => bp.projectId));
      const next = new Set(base);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const activeIssue = activeIssueId != null ? issueLookup.get(activeIssueId) : undefined;
  const selectedCount = selectedProjects ? selectedProjects.size : projectsWithVersions.length;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <MapIcon size={17} /> Roadmap
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Versões do Redmine por projeto. Arraste tarefas para planejar por âmbito.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOnlyMine((v) => !v)}
            title={onlyMine ? 'Mostrando só as minhas tarefas' : 'Mostrando as tarefas de todos'}
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border ${
              onlyMine
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-500/60'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <User size={15} /> Minhas tarefas
          </button>
          <button
            onClick={() => setOnlyMyProjects((v) => !v)}
            title={
              onlyMyProjects
                ? 'Mostrando só os projetos em que participo'
                : 'Mostrando todos os projetos'
            }
            className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border ${
              onlyMyProjects
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-500/60'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            <FolderCheck size={15} /> Meus projetos
          </button>
          <button
            onClick={() => setHideClosedIssues((v) => !v)}
            title={
              hideClosedIssues
                ? 'Mostrando apenas tarefas em aberto'
                : 'Mostrando também as tarefas concluídas'
            }
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {hideClosedIssues ? <Circle size={15} /> : <CheckCircle2 size={15} />}
            {hideClosedIssues ? 'Ocultar concluídas' : 'Mostrar concluídas'}
          </button>
          <button
            onClick={() => setShowClosedVersions((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {showClosedVersions ? <EyeOff size={15} /> : <Eye size={15} />}
            {showClosedVersions ? 'Ocultar versões fechadas' : 'Mostrar versões fechadas'}
          </button>
          <div className="relative">
            <button
              onClick={() => setFilterOpen((o) => !o)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
            >
              <Filter size={15} /> Projetos ({selectedCount})
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute top-full mt-1 right-0 w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1 scrollbar-thin">
                  <button
                    onClick={() => setSelectedProjects(null)}
                    className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Selecionar todos
                  </button>
                  {projectsWithVersions.map((bp) => {
                    const on = !selectedProjects || selectedProjects.has(bp.projectId);
                    return (
                      <button
                        key={bp.projectId}
                        onClick={() => toggleProject(bp.projectId)}
                        className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                      >
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}
                        >
                          {on && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="truncate">{bp.projectName}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex-1 min-h-0 flex">
          <RoadmapBacklog
            issues={backlog}
            projects={projects}
            search={search}
            onSearch={setSearch}
            projectFilter={backlogProjectFilter}
            onProjectFilter={setBacklogProjectFilter}
            onOpen={onIssueClick}
            closedIds={closedStatusIds}
          />

          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {loadingVersions && projectsWithVersions.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">
                Carregando versões…
              </p>
            ) : visibleLanes.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                <MapIcon size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Nenhuma versão encontrada nos projetos selecionados.</p>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-2 px-1">
                  {visibleLanes.length} projeto{visibleLanes.length !== 1 ? 's' : ''} · {totalTasks}{' '}
                  tarefa{totalTasks !== 1 ? 's' : ''} nas versões expandidas
                </p>
                {visibleLanes.map((bp, idx) => (
                  <ProjectLane
                    key={bp.projectId}
                    projectId={bp.projectId}
                    projectName={bp.projectName}
                    versions={bp.versions}
                    issuesByVersion={issuesByVersion}
                    collapsed={collapsed.has(bp.projectId)}
                    onToggleCollapse={() => toggleCollapse(bp.projectId)}
                    onOpen={onIssueClick}
                    closedIds={closedStatusIds}
                    hideClosedIssues={hideClosedIssues}
                    onRemoveIssue={(issue) => moveIssue(issue, null)}
                    accentColor={PALETTE[idx % PALETTE.length]}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeIssue && (
            <div className="w-[320px]">
              <IssueRow issue={activeIssue} closedIds={closedStatusIds} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
