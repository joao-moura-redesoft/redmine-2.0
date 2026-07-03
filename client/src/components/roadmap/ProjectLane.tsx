import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react';
import type { Issue, Version } from '../../types/redmine';
import { isClosedStatus } from '../sprints/format';
import { VersionCard } from './VersionCard';

/* Raia de um projeto do Redmine, agrupando suas Versões (âmbitos). */
export function ProjectLane({
  projectId,
  projectName,
  versions,
  issuesByVersion,
  collapsed,
  onToggleCollapse,
  onOpen,
  closedIds,
  hideClosedIssues,
  onRemoveIssue,
  accentColor,
}: {
  projectId: number;
  projectName: string;
  versions: Version[];
  issuesByVersion: (versionId: number) => Issue[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen?: (id: number) => void;
  closedIds?: Set<number>;
  hideClosedIssues?: boolean;
  onRemoveIssue?: (issue: Issue) => void;
  accentColor?: string;
}) {
  const agg = useMemo(() => {
    let total = 0;
    let closed = 0;
    if (!collapsed) {
      for (const v of versions) {
        const iss = issuesByVersion(v.id);
        total += iss.length;
        closed += iss.filter((i) => isClosedStatus(i, closedIds)).length;
      }
    }
    return { total, closed };
  }, [versions, issuesByVersion, closedIds, collapsed]);
  const aggPct = agg.total > 0 ? Math.round((agg.closed / agg.total) * 100) : 0;
  const laneBorder = accentColor ?? '#cbd5e1';

  return (
    <section className="mb-4 border-l-2 pl-2 rounded-l" style={{ borderLeftColor: laneBorder }}>
      <header className="flex items-center gap-2 px-1 py-1.5">
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expandir' : 'Recolher'}
          className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </button>
        <Folder
          size={14}
          className="text-slate-400 flex-shrink-0"
          style={accentColor ? { color: accentColor } : undefined}
        />
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate max-w-[280px]">
          {projectName}
        </span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {versions.length} versão{versions.length !== 1 ? 'es' : ''}
          {!collapsed && agg.total > 0 && ` · ${agg.closed}/${agg.total} tarefas`}
        </span>
        {!collapsed && agg.total > 0 && (
          <div
            className="hidden sm:block w-16 h-1 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden"
            title={`${aggPct}% concluído`}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${aggPct}%`, backgroundColor: accentColor ?? '#3b82f6' }}
            />
          </div>
        )}
      </header>

      {!collapsed && (
        <div className="flex gap-3 overflow-x-auto pb-1 pl-4 scrollbar-thin">
          {versions.map((v) => (
            <div key={v.id} className="w-[300px] flex-shrink-0">
              <VersionCard
                version={v}
                projectId={projectId}
                issues={issuesByVersion(v.id)}
                onOpen={onOpen}
                closedIds={closedIds}
                hideClosedIssues={hideClosedIssues}
                onRemoveIssue={onRemoveIssue}
                accentColor={accentColor}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
