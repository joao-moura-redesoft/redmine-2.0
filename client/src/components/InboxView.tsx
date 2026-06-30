import { useIssues, useToReviewIssues } from '../hooks/useRedmine';
import type { Issue } from '../types/redmine';
import {
  ClipboardCheck,
  RotateCcw,
  Play,
  ListTodo,
  CircleDot,
  Inbox,
  RefreshCw,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

function isClosed(i: Issue): boolean {
  const n = i.status.name.toLowerCase();
  return n.includes('fechad') || n.includes('cancelad');
}

interface Props {
  onIssueClick: (id: number) => void;
}

export function InboxView({ onIssueClick }: Props) {
  const my = useIssues();
  const toReview = useToReviewIssues();

  const open = (my.data ?? []).filter((i) => !isClosed(i));
  const correct = open.filter((i) => i.status.id === 34); // Pendente Correção
  const dev = open.filter((i) => i.status.id === 32); // Pendente Desenvolvimento
  const doing = open.filter((i) => i.status.id === 8); // Em andamento
  const handled = new Set([34, 32, 8]);
  const other = open.filter((i) => !handled.has(i.status.id));

  const sections = [
    {
      key: 'review',
      icon: ClipboardCheck,
      title: 'Para revisar',
      desc: 'Você é o revisor',
      items: toReview.data ?? [],
      color: 'text-violet-600 bg-violet-50',
    },
    {
      key: 'correct',
      icon: RotateCcw,
      title: 'Para corrigir',
      desc: 'Voltou da revisão',
      items: correct,
      color: 'text-amber-600 bg-amber-50',
    },
    {
      key: 'dev',
      icon: ListTodo,
      title: 'Para desenvolver',
      desc: 'Pendente desenvolvimento',
      items: dev,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      key: 'doing',
      icon: Play,
      title: 'Em andamento',
      desc: 'Você está trabalhando',
      items: doing,
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      key: 'other',
      icon: CircleDot,
      title: 'Outras pendências',
      desc: 'Atribuídas a você',
      items: other,
      color: 'text-slate-500 bg-slate-100',
    },
  ].filter((s) => s.items.length > 0);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const loading = my.isLoading || toReview.isLoading;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Aguardando você</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Tudo que depende da sua ação, reunido num lugar só.
          </p>
        </div>
        <button
          onClick={() => {
            my.refetch();
            toReview.refetch();
          }}
          className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
          title="Atualizar"
        >
          <RefreshCw
            size={15}
            className={my.isFetching || toReview.isFetching ? 'animate-spin' : ''}
          />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <RefreshCw size={20} className="animate-spin" />
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
          <Inbox size={32} className="mb-3 opacity-30" />
          <p className="text-sm">Tudo limpo! Nada aguardando você. 🎉</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map((s) => (
            <div
              key={s.key}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden"
            >
              <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-100">
                <span
                  className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${s.color}`}
                >
                  <s.icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    {s.title} <span className="text-slate-400 font-normal">· {s.items.length}</span>
                  </p>
                  <p className="text-[11px] text-slate-400">{s.desc}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {s.items.map((issue) => (
                  <button
                    key={issue.id}
                    onClick={() => onIssueClick(issue.id)}
                    className="w-full text-left flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 transition-colors group"
                  >
                    <span className="text-xs font-medium text-slate-400 flex-shrink-0 w-14">
                      #{issue.id}
                    </span>
                    <span className="text-sm text-slate-700 group-hover:text-blue-700 truncate flex-1">
                      {issue.subject}
                    </span>
                    <span className="hidden sm:block text-[11px] text-slate-400 flex-shrink-0">
                      {formatDistanceToNow(new Date(issue.updated_on), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                    <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded flex-shrink-0">
                      {issue.status.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
