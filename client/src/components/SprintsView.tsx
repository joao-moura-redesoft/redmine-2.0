import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Folder, FolderPlus, CalendarRange, Loader2, ChevronDown } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCorners,
  type CollisionDetection, type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { useIssues, useIssuesByIds, useProjects, useStatuses } from '../hooks/useRedmine';
import { useSprints, useCreateSprint, useUpdateSprint, useAddIssueToSprint, useReorderSprints } from '../hooks/useSprints';
import { useQueryClient } from '@tanstack/react-query';
import { startOfWeek, addDays, format } from 'date-fns';
import { useBoards, useCreateBoard } from '../hooks/useBoards';
import { newBoardId, createBoard } from '../api/boards';
import { newSprintId, type Sprint, createSprint } from '../api/sprints';
import type { Issue } from '../types/redmine';
import { NONE, COLLAPSE_KEY } from './sprints/constants';
import { BacklogPanel } from './sprints/BacklogPanel';
import { BoardLane } from './sprints/BoardLane';
import { IssueRow } from './sprints/IssueRow';
import { SprintCardOverlay } from './sprints/SprintCard';
import {
  C_BACKLOG, issueDragId, parseIssueId, parseSprintId, isIssueDrag, isSprintDrag, issueContainerKey,
} from './sprints/dnd';

// Status terminais saem do backlog — backlog é trabalho a fazer. O conjunto de
// IDs fechados (de /issue_statuses) é a fonte confiável; o regex pega ainda
// status ABERTOS que devem sumir ("pendente fechamento") como rede de segurança.
const HIDDEN_BACKLOG_STATUS = /fecha|cancel/i;

type ActiveDrag = { kind: 'issue'; issueId: number } | { kind: 'sprint'; sprintId: string } | null;

function LaneSkeleton() {
  return (
    <div className="mb-5 animate-pulse">
      <div className="h-4 w-40 bg-slate-200 dark:bg-slate-700 rounded mb-3 ml-2" />
      <div className="flex gap-3 pl-4">
        {[0, 1, 2].map(i => <div key={i} className="w-[300px] h-32 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700" />)}
      </div>
    </div>
  );
}

interface Props {
  onIssueClick?: (id: number) => void;
}

export function SprintsView({ onIssueClick }: Props) {
  const { data: sprints = [], isLoading: loadingSprints } = useSprints();
  const { data: boards = [] } = useBoards();
  const { data: myIssues = [] } = useIssues();
  const { data: projects = [] } = useProjects();
  const { data: statuses = [] } = useStatuses();
  const createSprintMutation = useCreateSprint();
  const addIssue = useAddIssueToSprint();
  const updateSprint = useUpdateSprint();
  const reorderSprints = useReorderSprints();
  const createBoardMutation = useCreateBoard();

  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
  });
  
  const [planningWeek, setPlanningWeek] = useState(false);
  const [weekMenuOpen, setWeekMenuOpen] = useState(false);
  const qc = useQueryClient();

  // ── DnD: estado dos containers de issue (chave 'backlog' | sprintId → drag ids) ──
  const [issueItems, setIssueItems] = useState<Record<string, string[]>>({});
  const itemsRef = useRef<Record<string, string[]>>({});
  const syncSigRef = useRef('');
  const dragSourceRef = useRef<string | null>(null);     // container de origem (issue)
  const dragLaneRef = useRef<string | null>(null);       // raia de origem (sprint)
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);

  const setItems = (next: Record<string, string[]>) => { itemsRef.current = next; setIssueItems(next); };

  const closedStatusIds = useMemo(() => new Set(statuses.filter(s => s.is_closed).map(s => s.id)), [statuses]);

  const assignedIds = useMemo(() => {
    const set = new Set<number>();
    for (const s of sprints) for (const id of s.issueIds) set.add(id);
    return set;
  }, [sprints]);

  const myIssueIds = useMemo(() => new Set(myIssues.map(i => i.id)), [myIssues]);
  const missingIds = useMemo(() => [...assignedIds].filter(id => !myIssueIds.has(id)), [assignedIds, myIssueIds]);
  const { data: extraIssues = [] } = useIssuesByIds(missingIds);

  const issueById = useMemo(() => {
    const m = new Map<number, Issue>();
    for (const i of myIssues) m.set(i.id, i);
    for (const i of extraIssues) m.set(i.id, i);
    return m;
  }, [myIssues, extraIssues]);

  const backlog = useMemo(() => {
    const q = search.trim().toLowerCase();
    return myIssues.filter(i => {
      if (i.status?.is_closed || closedStatusIds.has(i.status.id)) return false;
      if (i.status?.name && HIDDEN_BACKLOG_STATUS.test(i.status.name)) return false;
      if (assignedIds.has(i.id)) return false;
      if (projectFilter !== 'all' && i.project?.id !== projectFilter) return false;
      if (q && !(`#${i.id} ${i.subject}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [myIssues, assignedIds, projectFilter, search, closedStatusIds]);

  // Sprints agrupadas por board, preservando a ordem do store (ordem manual).
  const boardIds = useMemo(() => new Set(boards.map(b => b.id)), [boards]);
  const sprintsByBoard = useMemo(() => {
    const map = new Map<string, Sprint[]>();
    for (const s of sprints) {
      const key = s.boardId && boardIds.has(s.boardId) ? s.boardId : NONE; // boardId órfão → "Sem projeto"
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sprints, boardIds]);

  // Sincroniza o estado de DnD com os dados quando NÃO se está arrastando.
  useEffect(() => {
    if (activeDrag) return;
    const next: Record<string, string[]> = { backlog: backlog.map(i => issueDragId(i.id)) };
    for (const s of sprints) next[s.id] = s.issueIds.filter(id => issueById.has(id)).map(issueDragId);
    const sig = JSON.stringify(next);
    if (sig === syncSigRef.current) return;
    syncSigRef.current = sig;
    setItems(next);
  }, [sprints, backlog, issueById, activeDrag]);

  const resolve = (dragIds: string[] = []) =>
    dragIds.map(d => issueById.get(parseIssueId(d))).filter((i): i is Issue => !!i);

  const backlogIssues = resolve(issueItems.backlog);
  const issuesBySprintId = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const s of sprints) m.set(s.id, resolve(issueItems[s.id]));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sprints, issueItems, issueById]);

  // ── Sensores / colisão (separa os dois sistemas por tipo do item) ──
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const collisionDetection: CollisionDetection = (args) => {
    const sprintKind = isSprintDrag(String(args.active.id));
    const filtered = args.droppableContainers.filter(c => {
      const cid = String(c.id);
      return sprintKind
        ? (cid.startsWith('c:l:') || isSprintDrag(cid))
        : (cid === C_BACKLOG || cid.startsWith('c:b:') || isIssueDrag(cid));
    });
    return closestCorners({ ...args, droppableContainers: filtered });
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (isSprintDrag(id)) {
      const sid = parseSprintId(id);
      const sprint = sprints.find(s => s.id === sid);
      dragLaneRef.current = sprint ? (sprint.boardId && boardIds.has(sprint.boardId) ? sprint.boardId : NONE) : null;
      setActiveDrag({ kind: 'sprint', sprintId: sid });
    } else {
      // Origem calculada direto dos dados (confiável), não do estado de DnD.
      const iid = parseIssueId(id);
      const src = sprints.find(s => s.issueIds.includes(iid));
      dragSourceRef.current = src ? src.id : 'backlog';
      setActiveDrag({ kind: 'issue', issueId: iid });
    }
  };

  const onDragOver = (e: DragOverEvent) => {
    const active = String(e.active.id);
    if (!isIssueDrag(active) || !e.over) return;
    const over = String(e.over.id);
    const cur = itemsRef.current;
    const from = issueContainerKey(active, cur);
    const to = issueContainerKey(over, cur);
    if (!from || !to || from === to) return;
    const fromArr = cur[from];
    const toArr = cur[to];
    const insertAt = (over === C_BACKLOG || over.startsWith('c:b:'))
      ? toArr.length
      : (toArr.indexOf(over) >= 0 ? toArr.indexOf(over) : toArr.length);
    setItems({
      ...cur,
      [from]: fromArr.filter(x => x !== active),
      [to]: [...toArr.slice(0, insertAt), active, ...toArr.slice(insertAt)],
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    setActiveDrag(null);

    if (isSprintDrag(active)) {
      const laneKey = dragLaneRef.current;
      dragLaneRef.current = null;
      if (!over || !laneKey) return;
      const laneIds = (sprintsByBoard.get(laneKey) ?? []).map(s => s.id);
      const oldI = laneIds.indexOf(parseSprintId(active));
      const newI = isSprintDrag(over) ? laneIds.indexOf(parseSprintId(over)) : laneIds.length - 1;
      if (oldI < 0 || newI < 0 || oldI === newI) return;
      const newLane = arrayMove(laneIds, oldI, newI);
      // Ordem global: percorre as raias na ordem de exibição, trocando só a afetada.
      const order: string[] = [];
      for (const b of boards) order.push(...(b.id === laneKey ? newLane : (sprintsByBoard.get(b.id) ?? []).map(s => s.id)));
      order.push(...(laneKey === NONE ? newLane : (sprintsByBoard.get(NONE) ?? []).map(s => s.id)));
      reorderSprints.mutate(order);
      return;
    }

    // Issue
    const source = dragSourceRef.current;   // container de origem (dos dados)
    dragSourceRef.current = null;
    if (!over) return;
    const cur = itemsRef.current;
    const to = issueContainerKey(over, cur);
    const activeContainer = issueContainerKey(active, cur); // onde está agora (após onDragOver)
    if (!to || !activeContainer) return;

    let final = cur;
    if (activeContainer === to) {
      // Reordenar dentro do mesmo container.
      const arr = cur[to];
      const oldI = arr.indexOf(active);
      const newI = (over === C_BACKLOG || over.startsWith('c:b:')) ? arr.length - 1 : arr.indexOf(over);
      if (newI >= 0 && oldI !== newI) final = { ...cur, [to]: arrayMove(arr, oldI, newI) };
    } else {
      // Move entre containers aqui mesmo (não depende do onDragOver ter agido).
      const insertAt = (over === C_BACKLOG || over.startsWith('c:b:'))
        ? cur[to].length
        : (cur[to].indexOf(over) >= 0 ? cur[to].indexOf(over) : cur[to].length);
      final = {
        ...cur,
        [activeContainer]: cur[activeContainer].filter(x => x !== active),
        [to]: [...cur[to].slice(0, insertAt), active, ...cur[to].slice(insertAt)],
      };
    }
    setItems(final);

    // Persiste todos os sprints afetados: origem real, container atual e destino.
    const affected = new Set<string>();
    for (const k of [source, activeContainer, to]) if (k && k !== 'backlog') affected.add(k);
    for (const key of affected) updateSprint.mutate({ id: key, patch: { issueIds: (final[key] ?? []).map(parseIssueId) } });
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const addSelectedTo = (sprintId: string) => {
    for (const issueId of selected) addIssue.mutate({ sprintId, issueId });
    setSelected(new Set());
  };
  const toggleCollapse = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const handleNewSprint = (boardId: string | null) => {
    const id = newSprintId();
    const count = (boardId ? sprintsByBoard.get(boardId) : sprintsByBoard.get(NONE))?.length ?? 0;
    setEditingId(id);
    createSprintMutation.mutate({ id, name: `Sprint ${count + 1}`, status: 'planned', boardId });
  };
  const handleNewBoard = () => {
    const id = newBoardId();
    setEditingBoardId(id);
    createBoardMutation.mutate({ id, name: 'Novo projeto' });
  };

  const handlePlanWeek = async (offsetWeeks: number) => {
    try {
      setPlanningWeek(true);
      setWeekMenuOpen(false);
      
      const now = new Date();
      // Start of week considering Monday as first day
      const monday = addDays(startOfWeek(now, { weekStartsOn: 1 }), offsetWeeks * 7);
      const friday = addDays(monday, 4);

      const boardName = `${format(monday, 'dd/MM')} - ${format(friday, 'dd/MM')}`;
      const boardId = newBoardId();

      await createBoard({ id: boardId, name: boardName });

      const days = [
        { name: 'Segunda', offset: 0 },
        { name: 'Terça', offset: 1 },
        { name: 'Quarta', offset: 2 },
        { name: 'Quinta', offset: 3 },
        { name: 'Sexta', offset: 4 },
      ];

      await Promise.all(days.map(d => {
        const dateStr = format(addDays(monday, d.offset), 'yyyy-MM-dd');
        return createSprint({
          id: newSprintId(),
          name: d.name,
          startDate: dateStr,
          endDate: dateStr,
          status: 'planned',
          boardId: boardId
        });
      }));

      await qc.invalidateQueries({ queryKey: ['boards'] });
      await qc.invalidateQueries({ queryKey: ['sprints'] });
    } catch (e) {
      console.error(e);
      alert('Erro ao planejar semana.');
    } finally {
      setPlanningWeek(false);
    }
  };

  const noneSprints = sprintsByBoard.get(NONE) ?? [];
  const activeIssue = activeDrag?.kind === 'issue' ? issueById.get(activeDrag.issueId) : undefined;
  const activeSprint = activeDrag?.kind === 'sprint' ? sprints.find(s => s.id === activeDrag.sprintId) : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">Sprints</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {boards.length > 0 || sprints.length > 0
              ? `${boards.length} projeto${boards.length !== 1 ? 's' : ''} · ${sprints.length} sprint${sprints.length !== 1 ? 's' : ''} · ${assignedIds.size} tarefa${assignedIds.size !== 1 ? 's' : ''}`
              : 'Projetos pessoais → sprints → tarefas. Arraste tarefas e sprints para organizar.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button 
              onClick={() => setWeekMenuOpen(!weekMenuOpen)}
              disabled={planningWeek}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50"
            >
              {planningWeek ? <Loader2 size={15} className="animate-spin" /> : <CalendarRange size={15} />} 
              Planejar Semana <ChevronDown size={13} />
            </button>
            {weekMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setWeekMenuOpen(false)} />
                <div className="absolute top-full mt-1 right-0 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 overflow-hidden text-sm">
                  <button onClick={() => handlePlanWeek(0)} className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                    Esta semana
                  </button>
                  <button onClick={() => handlePlanWeek(1)} className="w-full text-left px-3 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">
                    Próxima semana
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={handleNewBoard} className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">
            <FolderPlus size={15} /> Novo projeto
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex-1 min-h-0 flex">
          <BacklogPanel
            backlog={backlogIssues}
            projects={projects}
            sprints={sprints}
            search={search}
            onSearch={setSearch}
            projectFilter={projectFilter}
            onProjectFilter={setProjectFilter}
            selected={selected}
            onToggleSelect={toggleSelect}
            onClearSelection={() => setSelected(new Set())}
            onAddSingle={(sprintId, issueId) => addIssue.mutate({ sprintId, issueId })}
            onAddSelected={addSelectedTo}
            onOpen={onIssueClick}
          />

          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {loadingSprints ? (
              <><LaneSkeleton /><LaneSkeleton /></>
            ) : boards.length === 0 && noneSprints.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
                <Folder size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Nenhum projeto ainda.</p>
                <button onClick={handleNewBoard} className="mt-2 flex items-center gap-1 text-sm text-blue-600 hover:underline">
                  <Plus size={14} /> Criar o primeiro projeto
                </button>
              </div>
            ) : (
              <>
                {boards.map(board => (
                  <BoardLane
                    key={board.id}
                    board={board}
                    sprints={sprintsByBoard.get(board.id) ?? []}
                    issuesBySprintId={issuesBySprintId}
                    boards={boards}
                    collapsed={collapsed.has(board.id)}
                    onToggleCollapse={() => toggleCollapse(board.id)}
                    onNewSprint={() => handleNewSprint(board.id)}
                    onOpen={onIssueClick}
                    editingId={editingId}
                    autoEditBoard={board.id === editingBoardId}
                    closedIds={closedStatusIds}
                  />
                ))}
                {noneSprints.length > 0 && (
                  <BoardLane
                    board={null}
                    sprints={noneSprints}
                    issuesBySprintId={issuesBySprintId}
                    boards={boards}
                    collapsed={collapsed.has(NONE)}
                    onToggleCollapse={() => toggleCollapse(NONE)}
                    onNewSprint={() => handleNewSprint(null)}
                    onOpen={onIssueClick}
                    editingId={editingId}
                    autoEditBoard={false}
                    closedIds={closedStatusIds}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <DragOverlay>
          {activeIssue && <div className="w-[320px]"><IssueRow issue={activeIssue} closedIds={closedStatusIds} /></div>}
          {activeSprint && <SprintCardOverlay sprint={activeSprint} />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
