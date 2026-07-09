import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Issue } from '../../types/redmine';
import {
  useAllowedStatuses,
  useCurrentUser,
  useProjectMembers,
  usePriorities,
  useQuickEditIssue,
} from '../../hooks/useRedmine';
import { InlineSelect, InlineDate, type Opt } from './InlineSelect';

const PANEL_W = 264;
const PANEL_H = 236;

export type QuickField = 'status' | 'assignee' | 'priority' | null;
const ROWS = ['status', 'assignee', 'priority', 'date'] as const;
type Row = (typeof ROWS)[number];

// Popover de edição rápida (status/responsável/prioridade/prazo). Navegável por
// TECLADO: ↑/↓ move entre campos, Enter/→ abre o dropdown, ↑/↓ move as opções,
// Enter escolhe, Esc/← volta (e Esc no nível dos campos fecha o popover).
export function QuickEditPanel({
  issue,
  anchorRect,
  initialField = null,
  onClose,
}: {
  issue: Issue;
  anchorRect: DOMRect;
  initialField?: QuickField;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [openField, setOpenField] = useState<QuickField>(initialField);
  const [focusRow, setFocusRow] = useState<number>(
    initialField ? ROWS.indexOf(initialField) : 0,
  );
  const [activeOption, setActiveOption] = useState(0);

  const { data: me } = useCurrentUser();
  const quick = useQuickEditIssue();

  const wf = {
    issueId: issue.id,
    projectId: issue.project.id,
    trackerId: issue.tracker?.id,
    statusId: issue.status.id,
    isAuthor: !!me && issue.author?.id === me.id,
    isAssignee: !!me && issue.assigned_to?.id === me.id,
  };
  const statuses = useAllowedStatuses(wf, true);
  const members = useProjectMembers(issue.project.id);
  const priorities = usePriorities();

  const optsFor = (f: Row): Opt[] =>
    f === 'status'
      ? statuses.data ?? []
      : f === 'assignee'
        ? (members.data?.map((m) => ({ id: m.id, name: m.name })) ?? [])
        : f === 'priority'
          ? (priorities.data?.map((p) => ({ id: p.id, name: p.name })) ?? [])
          : [];

  const currentIdOf = (f: Row): number | undefined =>
    f === 'status'
      ? issue.status.id
      : f === 'assignee'
        ? issue.assigned_to?.id
        : f === 'priority'
          ? issue.priority.id
          : undefined;

  // Ao abrir um campo, posiciona a opção ativa no valor atual.
  useEffect(() => {
    if (!openField) return;
    const opts = optsFor(openField);
    const idx = opts.findIndex((o) => o.id === currentIdOf(openField));
    setActiveOption(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openField, statuses.data, members.data, priorities.data]);

  useLayoutEffect(() => {
    const r = anchorRect;
    const flipUp = r.bottom + 6 + PANEL_H > window.innerHeight;
    setPos({
      top: flipUp ? Math.max(8, r.top - PANEL_H - 6) : r.bottom + 6,
      left: Math.max(8, Math.min(r.right - PANEL_W, window.innerWidth - PANEL_W - 8)),
    });
  }, [anchorRect]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const apply = (fields: Record<string, unknown>, optimistic: Partial<Issue>) =>
    quick.mutate({ id: issue.id, fields, optimistic });
  const pick = (opt: Opt, apiKey: string, patchKey: keyof Issue) => {
    apply({ [apiKey]: opt.id }, { [patchKey]: { id: opt.id, name: opt.name } } as Partial<Issue>);
    setOpenField(null);
  };
  const applyPick = (f: Row, opt: Opt) => {
    if (f === 'status') pick(opt, 'status_id', 'status');
    else if (f === 'assignee') pick(opt, 'assigned_to_id', 'assigned_to');
    else if (f === 'priority') pick(opt, 'priority_id', 'priority');
  };

  // Estado + funções espelhados pro handler de teclado — ATUALIZADO a cada render,
  // senão o handler (registrado uma vez) captura optsFor/applyPick com os dados
  // vazios do 1º render (antes das opções carregarem).
  const kb = useRef({ openField, focusRow, activeOption, optsFor, applyPick, onClose });
  kb.current = { openField, focusRow, activeOption, optsFor, applyPick, onClose };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { openField: of, focusRow: fr, activeOption: ao, optsFor: getOpts, applyPick: doPick, onClose: close } =
        kb.current;
      const stop = () => {
        e.stopImmediatePropagation();
        e.preventDefault();
      };
      if (of) {
        const opts = getOpts(of);
        switch (e.key) {
          case 'ArrowDown':
          case 'j':
            stop();
            return setActiveOption((a) => Math.min(a + 1, Math.max(0, opts.length - 1)));
          case 'ArrowUp':
          case 'k':
            stop();
            return setActiveOption((a) => Math.max(a - 1, 0));
          case 'Enter':
            stop();
            if (opts[ao]) doPick(of, opts[ao]);
            return;
          case 'Escape':
          case 'ArrowLeft':
            stop();
            return setOpenField(null);
        }
        return;
      }
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          stop();
          return setFocusRow((r) => Math.min(r + 1, ROWS.length - 1));
        case 'ArrowUp':
        case 'k':
          stop();
          return setFocusRow((r) => Math.max(r - 1, 0));
        case 'Enter':
        case 'ArrowRight':
        case ' ': {
          stop();
          const f = ROWS[fr];
          if (f === 'date') dateRef.current?.showPicker?.();
          else setOpenField(f);
          return;
        }
        case 'Escape':
          stop();
          return close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowFocused = (f: Row) => !openField && ROWS[focusRow] === f;

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: PANEL_W }}
      className="z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="text-xs font-semibold text-slate-400 px-0.5">#{issue.id} · edição rápida</div>

      <InlineSelect
        label="Status"
        current={{ id: issue.status.id, name: issue.status.name }}
        options={statuses.data ?? undefined}
        loading={statuses.isLoading}
        isOpen={openField === 'status'}
        onToggle={() => setOpenField((f) => (f === 'status' ? null : 'status'))}
        onPick={(o) => pick(o, 'status_id', 'status')}
        activeIndex={openField === 'status' ? activeOption : undefined}
        focused={rowFocused('status')}
      />
      <InlineSelect
        label="Responsável"
        current={issue.assigned_to ? { id: issue.assigned_to.id, name: issue.assigned_to.name } : null}
        options={members.data?.map((m) => ({ id: m.id, name: m.name }))}
        loading={members.isLoading}
        isOpen={openField === 'assignee'}
        onToggle={() => setOpenField((f) => (f === 'assignee' ? null : 'assignee'))}
        onPick={(o) => pick(o, 'assigned_to_id', 'assigned_to')}
        activeIndex={openField === 'assignee' ? activeOption : undefined}
        focused={rowFocused('assignee')}
      />
      <InlineSelect
        label="Prioridade"
        current={{ id: issue.priority.id, name: issue.priority.name }}
        options={priorities.data?.map((p) => ({ id: p.id, name: p.name }))}
        loading={priorities.isLoading}
        isOpen={openField === 'priority'}
        onToggle={() => setOpenField((f) => (f === 'priority' ? null : 'priority'))}
        onPick={(o) => pick(o, 'priority_id', 'priority')}
        activeIndex={openField === 'priority' ? activeOption : undefined}
        focused={rowFocused('priority')}
      />
      <InlineDate
        label="Prazo"
        value={issue.due_date ?? null}
        onChange={(v) => apply({ due_date: v || '' }, { due_date: v || undefined })}
        focused={rowFocused('date')}
        inputRef={dateRef}
      />
    </div>,
    document.body,
  );
}
