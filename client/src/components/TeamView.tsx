import { useState, useMemo } from 'react';
import { useProjects, useProjectIssues, useProjectMembers, useAllMembers } from '../hooks/useRedmine';
import { ChevronDown, ChevronRight, RefreshCw, Users, User, Play, AlertTriangle } from 'lucide-react';
import type { Issue } from '../types/redmine';

const TEAM_ORDER = ['Desenvolvimento', 'Suporte', 'Redes & Infra', 'Implantação', 'Projetos', 'Comercial', 'Customer Success', 'Contratos', 'Outros', '—'];
const WIP_LIMIT = 3; // acima disso, sinaliza sobrecarga
const wipOf = (p: { items: Issue[] }) => p.items.filter(i => i.status.id === 8).length;

interface Person { id: number; name: string; team: string; items: Issue[]; }

interface Props {
  onIssueClick: (id: number) => void;
}

export function TeamView({ onIssueClick }: Props) {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const { data: issues, isLoading, isFetching, refetch } = useProjectIssues(projectId);
  const { data: projectMembers } = useProjectMembers(projectId);
  const { data: allMembers } = useAllMembers(!projectId);
  const members = projectId ? projectMembers : allMembers;
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Agrupa tarefas por responsável e pessoas por equipe
  const teams = useMemo(() => {
    const teamOf = new Map((members ?? []).map(m => [m.id, m.team]));
    const byPerson = new Map<number, Person>();
    (issues ?? []).forEach(i => {
      const id = i.assigned_to?.id ?? 0;
      if (!byPerson.has(id)) {
        byPerson.set(id, {
          id,
          name: i.assigned_to?.name ?? 'Sem responsável',
          team: id ? (teamOf.get(id) ?? 'Outros') : '—',
          items: [],
        });
      }
      byPerson.get(id)!.items.push(i);
    });

    const byTeam = new Map<string, Person[]>();
    [...byPerson.values()].forEach(p => {
      (byTeam.get(p.team) ?? byTeam.set(p.team, []).get(p.team)!).push(p);
    });
    byTeam.forEach(arr => arr.sort((a, b) => b.items.length - a.items.length));

    return [...byTeam.entries()].sort(([a], [b]) => {
      const ia = TEAM_ORDER.indexOf(a), ib = TEAM_ORDER.indexOf(b);
      return (ia === -1 ? 50 : ia) - (ib === -1 ? 50 : ib);
    });
  }, [issues, members]);

  const totalPeople = teams.reduce((n, [, ps]) => n + ps.length, 0);
  const overloaded = teams.flatMap(([, ps]) => ps).filter(p => wipOf(p) >= WIP_LIMIT);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Quadro do time</h2>
          <p className="text-sm text-slate-500 mt-0.5">Quem está com o quê — tarefas abertas por pessoa e equipe.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={projectId ?? ''}
            onChange={e => setProjectId(e.target.value ? Number(e.target.value) : undefined)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 max-w-64"
          >
            <option value="">Todos os projetos</option>
            {(projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => refetch()} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Atualizar">
            <RefreshCw size={15} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!isLoading && overloaded.length > 0 && (
        <div className="mb-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span><strong>{overloaded.length}</strong> {overloaded.length === 1 ? 'pessoa' : 'pessoas'} com carga alta (≥ {WIP_LIMIT} em andamento): {overloaded.map(p => p.name.split(' ')[0]).join(', ')}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400"><RefreshCw size={20} className="animate-spin" /></div>
      ) : totalPeople === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Users size={30} className="mb-3 opacity-30" />
          <p className="text-sm">Nenhuma tarefa aberta {projectId ? 'neste projeto' : 'em nenhum projeto'}.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {teams.map(([team, people]) => (
            <div key={team}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                {team} <span className="text-slate-300">· {people.reduce((n, p) => n + p.items.length, 0)}</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {people.map(p => {
                  const open = expanded.has(p.id);
                  return (
                    <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <button onClick={() => toggle(p.id)} className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {p.id === 0 ? <User size={14} /> : p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-slate-700 truncate flex-1 text-left">{p.name}</span>
                        {(() => {
                          const wip = wipOf(p);
                          if (wip === 0) return null;
                          const over = wip >= WIP_LIMIT;
                          return (
                            <span
                              title={`${wip} em andamento`}
                              className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 flex items-center gap-0.5 flex-shrink-0 ${over ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}
                            >
                              <Play size={9} className="fill-current" />{wip}
                            </span>
                          );
                        })()}
                        <span className="text-xs font-semibold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 flex-shrink-0" title="Total de tarefas abertas">{p.items.length}</span>
                        {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </button>
                      {open && (
                        <div className="border-t border-slate-100 divide-y divide-slate-50">
                          {p.items.map(issue => (
                            <button
                              key={issue.id}
                              onClick={() => onIssueClick(issue.id)}
                              className="w-full text-left flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 transition-colors group"
                            >
                              <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">#{issue.id}</span>
                              <span className="text-xs text-slate-600 group-hover:text-blue-700 truncate flex-1">{issue.subject}</span>
                              <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{issue.status.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
