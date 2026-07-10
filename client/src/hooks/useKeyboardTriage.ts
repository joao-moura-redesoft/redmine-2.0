import { useCallback, useEffect, useRef, useState } from 'react';
import type { Issue } from '../types/redmine';
import type { QuickField } from '../components/inline/QuickEditPanel';
import { waitingStore } from '../utils/waitingOn';
import { focusStore } from '../utils/focus';

interface QuickEdit {
  issue: Issue;
  rect: DOMRect;
  field: QuickField;
}

// Triagem por teclado para uma lista de tarefas (ex.: Inbox). Auto-contido:
// captura os atalhos na fase de CAPTURA e usa stopImmediatePropagation nas teclas
// que trata, pra não conflitar com os atalhos globais (useShortcuts).
//
//   j/↓ k/↑  navega   ·   Enter/o abre   ·   e edita   ·   s status   ·   a responsável
//   ?  ajuda ·   Esc  fecha/limpa
//
// A âncora do popover vem do elemento [data-issue-id] da linha focada.
export function useKeyboardTriage({
  ids,
  issueById,
  onOpenIssue,
  enabled = true,
}: {
  ids: number[];
  issueById: (id: number) => Issue | undefined;
  onOpenIssue: (id: number) => void;
  enabled?: boolean;
}) {
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [quickEdit, setQuickEdit] = useState<QuickEdit | null>(null);
  const [snooze, setSnooze] = useState<{ issue: Issue; rect: DOMRect } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  const toggleSelected = useCallback((id: number) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);
  const clearSelected = useCallback(() => setSelected(new Set()), []);

  // refs estáveis pra não re-registrar o listener a cada render
  const st = useRef({ ids, focusedId, quickEdit, snooze, selected, issueById, onOpenIssue });
  st.current = { ids, focusedId, quickEdit, snooze, selected, issueById, onOpenIssue };

  const rowRect = (id: number): DOMRect | null =>
    document.querySelector<HTMLElement>(`[data-issue-id="${id}"]`)?.getBoundingClientRect() ?? null;

  const openQuick = useCallback((field: QuickField) => {
    const { focusedId: fid, issueById: byId } = st.current;
    if (fid == null) return;
    const issue = byId(fid);
    const rect = rowRect(fid);
    if (issue && rect) setQuickEdit({ issue, rect, field });
  }, []);

  const openSnooze = useCallback(() => {
    const { focusedId: fid, issueById: byId } = st.current;
    if (fid == null) return;
    const issue = byId(fid);
    const rect = rowRect(fid);
    if (issue && rect) setSnooze({ issue, rect });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const tag = t.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable) return;

      const { ids: list, focusedId: fid, quickEdit: qe, snooze: sn } = st.current;

      // Com um popover aberto, o PRÓPRIO popover cuida do teclado (setas/Enter/Esc).
      // A triagem sai de cena pra não navegar as linhas de fundo.
      if (qe || sn) return;

      const move = (dir: 1 | -1) => {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (!list.length) return;
        const cur = fid != null ? list.indexOf(fid) : -1;
        // sem foco: a primeira tecla de navegação entra na lista (j → topo, k → fim)
        const next = cur < 0 ? (dir === 1 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
        setFocusedId(list[next]);
      };

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          return move(1);
        case 'k':
        case 'ArrowUp':
          return move(-1);
        case 'Enter':
        case 'o':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            onOpenIssue(fid);
          }
          return;
        case 'e':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            openQuick(null);
          }
          return;
        case 's':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            openQuick('status');
          }
          return;
        case 'a':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            openQuick('assignee');
          }
          return;
        case 'z':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            openSnooze();
          }
          return;
        case 'w':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            waitingStore.toggle(fid);
          }
          return;
        case 'f':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            const issue = st.current.issueById(fid);
            focusStore.start(fid, issue?.subject ?? `#${fid}`);
          }
          return;
        case 'x':
          if (fid != null) {
            e.stopImmediatePropagation();
            e.preventDefault();
            toggleSelected(fid);
            // avança pro próximo (permite x x x rápido)
            const cur = list.indexOf(fid);
            if (cur >= 0 && cur < list.length - 1) setFocusedId(list[cur + 1]);
          }
          return;
        case '?':
          e.stopImmediatePropagation();
          e.preventDefault();
          setShowHelp((v) => !v);
          return;
        case 'Escape':
          if (showHelp) {
            setShowHelp(false);
          } else if (st.current.selected.size) {
            clearSelected();
          } else if (fid != null) {
            setFocusedId(null);
          }
          return;
      }
    };
    // captura: roda antes do listener global (window bubble) do useShortcuts
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [enabled, onOpenIssue, openQuick, openSnooze, toggleSelected, clearSelected, showHelp]);

  // Mantém a linha focada visível.
  useEffect(() => {
    if (focusedId == null) return;
    document
      .querySelector<HTMLElement>(`[data-issue-id="${focusedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  // Se a lista mudar e o focado sumir, limpa.
  useEffect(() => {
    if (focusedId != null && !ids.includes(focusedId)) setFocusedId(null);
  }, [ids, focusedId]);

  // Clicar fora de uma linha sai da navegação (assim como Esc). Com popover aberto
  // o clique é dele, não mexe no foco.
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: PointerEvent) => {
      if (st.current.quickEdit || st.current.snooze) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('[data-issue-id]')) return;
      setFocusedId(null);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [enabled]);

  return {
    focusedId,
    quickEdit,
    closeQuickEdit: () => setQuickEdit(null),
    snooze,
    closeSnooze: () => setSnooze(null),
    selected,
    toggleSelected,
    clearSelected,
    showHelp,
    setShowHelp,
  };
}

export type Triage = ReturnType<typeof useKeyboardTriage>;
