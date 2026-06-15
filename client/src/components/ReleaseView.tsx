import { useState, useMemo } from 'react';
import { useProjects, useProjectIssues } from '../hooks/useRedmine';
import { RefreshCw, Rocket, Copy, Check } from 'lucide-react';
import type { Issue } from '../types/redmine';

const CF_IMPACTO = 229;
const CF_NOTA = 213;
// Confirmadas para entrar no sistema. Integração (35) ainda depende de aval do
// superior, então NÃO conta. A partir de Atualização (36) já vai pra próxima versão.
const RELEASE_STATUSES = new Set([36, 29]); // Pendente Atualização, Pendente Fechamento

function cfStr(issue: Issue, id: number): string {
  const v = issue.custom_fields?.find(f => f.id === id)?.value;
  if (!v) return '';
  return Array.isArray(v) ? v.join(', ') : v;
}

interface Props {
  onIssueClick: (id: number) => void;
}

export function ReleaseView({ onIssueClick }: Props) {
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState<number | undefined>(undefined);

  const { data: issues, isLoading, isFetching, refetch } = useProjectIssues(projectId);
  const [copied, setCopied] = useState(false);

  // Tarefas que vão pra release, agrupadas por Impacto
  const groups = useMemo(() => {
    const candidates = (issues ?? []).filter(i => RELEASE_STATUSES.has(i.status.id));
    const byImpacto = new Map<string, Issue[]>();
    candidates.forEach(i => {
      const imp = cfStr(i, CF_IMPACTO) || 'Sem impacto';
      (byImpacto.get(imp) ?? byImpacto.set(imp, []).get(imp)!).push(i);
    });
    return [...byImpacto.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [issues]);

  const total = groups.reduce((n, [, arr]) => n + arr.length, 0);

  const copyNotes = () => {
    const text = groups.map(([imp, arr]) =>
      `[${imp}]\n${arr.map(i => `- #${i.id} ${i.subject}${cfStr(i, CF_NOTA) ? ` — ${cfStr(i, CF_NOTA)}` : ''}`).join('\n')}`
    ).join('\n\n');
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Release</h2>
          <p className="text-sm text-slate-500 mt-0.5">O que vai na próxima versão — tarefas em atualização/fechamento (já confirmadas), por impacto.</p>
        </div>
        <div className="flex items-center gap-2">
          {total > 0 && (
            <button onClick={copyNotes} className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100">
              {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copiado!' : 'Copiar notas'}
            </button>
          )}
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

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400"><RefreshCw size={20} className="animate-spin" /></div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Rocket size={30} className="mb-3 opacity-30" />
          <p className="text-sm">Nada em atualização/fechamento {projectId ? 'neste projeto' : 'em nenhum projeto'}.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([imp, arr]) => (
            <div key={imp} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100">
                <Rocket size={14} className="text-indigo-500" />
                <span className="text-sm font-semibold text-slate-800">{imp}</span>
                <span className="text-xs text-slate-400">· {arr.length}</span>
              </div>
              <div className="divide-y divide-slate-50">
                {arr.map(issue => {
                  const nota = cfStr(issue, CF_NOTA);
                  return (
                    <button
                      key={issue.id}
                      onClick={() => onIssueClick(issue.id)}
                      className="w-full text-left flex items-start gap-2.5 px-4 py-2 hover:bg-blue-50 transition-colors group"
                    >
                      <span className="text-xs font-medium text-slate-400 flex-shrink-0 mt-0.5 w-12">#{issue.id}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-700 group-hover:text-blue-700 truncate">{issue.subject}</p>
                        {nota && <p className="text-xs text-slate-400 truncate">{nota}</p>}
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">{issue.status.name}</span>
                    </button>
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
