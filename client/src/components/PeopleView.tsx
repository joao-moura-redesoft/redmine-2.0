import { useState, useEffect, useRef } from 'react';
import { useProjects, useProjectMembers, useAllMembers, useUserIssues } from '../hooks/useRedmine';
import { IssueListView } from './IssueListView';
import { ChevronDown, Search, Check, User, Users } from 'lucide-react';

const TEAM_ORDER = ['Desenvolvimento', 'Suporte', 'Redes & Infra', 'Implantação', 'Projetos', 'Comercial', 'Customer Success', 'Contratos', 'Outros'];

interface Props {
  onIssueClick: (id: number) => void;
}

export function PeopleView({ onIssueClick }: Props) {
  const { data: projects } = useProjects();

  // 'all' = todas as pessoas de todos os projetos (padrão)
  const [project, setProject] = useState<number | 'all'>('all');
  const isAll = project === 'all';
  const [personId, setPersonId] = useState<number | undefined>(undefined);

  const { data: projectMembers } = useProjectMembers(isAll ? undefined : project);
  const { data: allMembers } = useAllMembers(isAll);
  const members = isAll ? allMembers : projectMembers;

  const userIssues = useUserIssues(personId);

  const person = members?.find(m => m.id === personId);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Pessoas</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Veja as tarefas abertas de qualquer pessoa da equipe.
        </p>
      </div>

      {/* Seletores */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Projeto */}
        <ProjectPicker
          projects={projects ?? []}
          value={project}
          onChange={p => { setProject(p); setPersonId(undefined); }}
        />
        {/* Pessoa */}
        <PersonPicker
          members={members ?? []}
          value={personId}
          onChange={setPersonId}
          disabled={false}
        />
      </div>

      {!personId ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Users size={32} className="mb-3 opacity-30" />
          <p className="text-sm">Selecione uma pessoa para ver as tarefas abertas dela.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3 text-sm text-slate-600">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {person?.name?.split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <span className="font-medium text-slate-800">{person?.name}</span>
            {person?.team && <span className="text-xs text-slate-400">· {person.team}</span>}
          </div>
          <IssueListView
            issues={userIssues.data}
            isLoading={userIssues.isLoading}
            isFetching={userIssues.isFetching}
            onRefetch={userIssues.refetch}
            onIssueClick={onIssueClick}
            emptyMessage="Esta pessoa não tem tarefas abertas."
          />
        </>
      )}
    </div>
  );
}

/* ── Seletor de projeto ── */
function ProjectPicker({ projects, value, onChange }: {
  projects: { id: number; name: string }[];
  value: number | 'all';
  onChange: (value: number | 'all') => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = value === 'all' ? undefined : projects.find(p => p.id === value);
  const label = value === 'all' ? 'Todos os projetos' : (current?.name ?? 'Selecionar projeto...');
  const filtered = projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <span className="block text-xs text-slate-400 mb-1">Projeto</span>
      <button
        onClick={() => { setSearch(''); setOpen(v => !v); }}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 min-w-56 max-w-72"
      >
        <span className="truncate flex-1 text-left">{label}</span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 w-72 flex flex-col" style={{ maxHeight: 320 }}>
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filtrar projeto..."
                className="w-full text-xs border border-slate-200 rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            <button
              onClick={() => { onChange('all'); setOpen(false); }}
              className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${value === 'all' ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
            >
              <span className="truncate">Todos os projetos</span>
              {value === 'all' && <Check size={12} className="flex-shrink-0" />}
            </button>
            <div className="border-t border-slate-100 my-1" />
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => { onChange(p.id); setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${p.id === value ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
              >
                <span className="truncate">{p.name}</span>
                {p.id === value && <Check size={12} className="flex-shrink-0" />}
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Nenhum projeto</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Seletor de pessoa (agrupado por equipe) ── */
function PersonPicker({ members, value, onChange, disabled }: {
  members: { id: number; name: string; team?: string }[];
  value?: number;
  onChange: (id: number) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const current = members.find(m => m.id === value);
  const filtered = members.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));

  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, m) => {
    const t = m.team || 'Outros';
    (acc[t] ??= []).push(m);
    return acc;
  }, {});
  const teams = Object.keys(grouped).sort((a, b) => {
    const ia = TEAM_ORDER.indexOf(a), ib = TEAM_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <span className="block text-xs text-slate-400 mb-1">Pessoa</span>
      <button
        disabled={disabled}
        onClick={() => { setSearch(''); setOpen(v => !v); }}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 min-w-56 max-w-72 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <User size={14} className="text-slate-400 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{current?.name ?? 'Selecionar pessoa...'}</span>
        <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-30 w-72 flex flex-col" style={{ maxHeight: 340 }}>
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar pessoa..."
                className="w-full text-xs border border-slate-200 rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="overflow-y-auto scrollbar-thin py-1">
            {teams.map(team => (
              <div key={team}>
                <p className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 bg-slate-50/70">
                  {team} <span className="text-slate-300">({grouped[team].length})</span>
                </p>
                {grouped[team].map(m => (
                  <button
                    key={m.id}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-blue-50 ${m.id === value ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.id === value && <Check size={12} className="flex-shrink-0" />}
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">Nenhuma pessoa</p>}
          </div>
        </div>
      )}
    </div>
  );
}
