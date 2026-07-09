import { useState } from 'react';
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
  Keyboard,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useKeyboardTriage } from '../hooks/useKeyboardTriage';
import { QuickEditPanel } from './inline/QuickEditPanel';
import { SnoozeMenu } from './inline/SnoozeMenu';
import { useSnoozes, snoozeStore, snoozeLabel } from '../utils/snooze';
import { useWaitingOn, waitingStore, waitingLabel } from '../utils/waitingOn';
import { Hourglass, Check } from 'lucide-react';
import { BulkBar } from './inline/BulkBar';

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

  // Adiadas (snooze): somem do Inbox até voltar; "mostrar" revela e permite desfazer.
  const snoozes = useSnoozes();
  const waiting = useWaitingOn();
  const [showSnoozed, setShowSnoozed] = useState(false);
  const isSnoozedNow = (id: number) => (snoozes[id] ?? 0) > Date.now();
  const snoozedCount = sections.reduce(
    (n, s) => n + s.items.filter((i) => isSnoozedNow(i.id)).length,
    0,
  );
  const visibleSections = showSnoozed
    ? sections
    : sections
        .map((s) => ({ ...s, items: s.items.filter((i) => !isSnoozedNow(i.id)) }))
        .filter((s) => s.items.length > 0);

  const total = visibleSections.reduce((n, s) => n + s.items.length, 0);
  const loading = my.isLoading || toReview.isLoading;

  // Triagem por teclado (j/k navega, e edita, z adia, x seleciona, enter abre).
  const ordered = visibleSections.flatMap((s) => s.items);
  const byId = new Map(ordered.map((i) => [i.id, i]));
  // Lookup amplo (inclui adiadas) pra resolver a seleção do lote.
  const allById = new Map(sections.flatMap((s) => s.items).map((i) => [i.id, i]));
  const triage = useKeyboardTriage({
    ids: ordered.map((i) => i.id),
    issueById: (id) => byId.get(id),
    onOpenIssue: onIssueClick,
  });

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Aguardando você</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Tudo que depende da sua ação, reunido num lugar só.
          </p>
          {total > 0 && (
            <button
              onClick={() => triage.setShowHelp(true)}
              className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600"
            >
              <Keyboard size={13} /> j/k navegar · e editar · enter abrir · ? atalhos
            </button>
          )}
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

      {snoozedCount > 0 && (
        <button
          onClick={() => setShowSnoozed((v) => !v)}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 bg-slate-100 rounded-full px-3 py-1 transition-colors"
        >
          <Clock size={12} /> {snoozedCount} adiada{snoozedCount > 1 ? 's' : ''} —{' '}
          {showSnoozed ? 'ocultar' : 'mostrar'}
        </button>
      )}

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
          {visibleSections.map((s) => (
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
                    data-issue-id={issue.id}
                    onClick={() => onIssueClick(issue.id)}
                    className={`w-full text-left flex items-center gap-2.5 px-4 py-2 hover:bg-blue-50 transition-colors group ${
                      triage.selected.has(issue.id)
                        ? 'bg-blue-50/70'
                        : triage.focusedId === issue.id
                          ? 'bg-blue-50 ring-2 ring-inset ring-blue-400'
                          : ''
                    }`}
                  >
                    {triage.selected.has(issue.id) && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          triage.toggleSelected(issue.id);
                        }}
                        title="Desselecionar"
                        className="flex-shrink-0 w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center"
                      >
                        <Check size={11} />
                      </span>
                    )}
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
                    {isSnoozedNow(issue.id) && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          snoozeStore.unsnooze(issue.id);
                        }}
                        title="Desfazer adiamento"
                        className="text-[10px] font-medium text-amber-600 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1"
                      >
                        <Clock size={10} /> {snoozeLabel(snoozes[issue.id])}
                      </span>
                    )}
                    {waiting[issue.id] && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          waitingStore.clear(issue.id);
                        }}
                        title="Parar de aguardar"
                        className="text-[10px] font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 px-1.5 py-0.5 rounded flex-shrink-0 inline-flex items-center gap-1"
                      >
                        <Hourglass size={10} /> aguardando {waitingLabel(waiting[issue.id].since)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Popover de edição rápida (aberto por teclado: e / s / a) */}
      {triage.quickEdit && (
        <QuickEditPanel
          issue={triage.quickEdit.issue}
          anchorRect={triage.quickEdit.rect}
          initialField={triage.quickEdit.field}
          onClose={triage.closeQuickEdit}
        />
      )}

      {/* Menu de adiar (aberto por teclado: z) */}
      {triage.snooze && (
        <SnoozeMenu
          anchorRect={triage.snooze.rect}
          onPick={(until) => {
            snoozeStore.snooze(triage.snooze!.issue.id, until);
            triage.closeSnooze();
          }}
          onClose={triage.closeSnooze}
        />
      )}

      {/* Barra de ações em lote (seleção com x) */}
      {triage.selected.size > 0 && (
        <BulkBar
          issues={[...triage.selected]
            .map((id) => allById.get(id))
            .filter((i): i is Issue => !!i)}
          onClear={triage.clearSelected}
        />
      )}

      {/* Ajuda de atalhos */}
      {triage.showHelp && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => triage.setShowHelp(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xs p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <Keyboard size={16} className="text-blue-500" />
              <h3 className="text-sm font-semibold text-slate-800">Atalhos da triagem</h3>
            </div>
            <dl className="space-y-1.5 text-sm">
              {[
                ['j / ↓', 'Próxima tarefa'],
                ['k / ↑', 'Tarefa anterior'],
                ['enter / o', 'Abrir tarefa'],
                ['e', 'Edição rápida'],
                ['s', 'Mudar status'],
                ['a', 'Mudar responsável'],
                ['z', 'Adiar (snooze)'],
                ['w', 'Aguardando resposta'],
                ['x', 'Selecionar (lote)'],
                ['esc', 'Limpar foco / fechar'],
              ].map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <kbd className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                    {k}
                  </kbd>
                  <span className="text-slate-600">{d}</span>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
