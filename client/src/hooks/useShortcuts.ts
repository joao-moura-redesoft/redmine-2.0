import { useState, useEffect, useRef } from 'react';

interface Options {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenIssue: (id: number) => void;
  onOpenPalette: () => void;
  paletteOpen: boolean;
  modalOpen: boolean;
}

export function useShortcuts({
  activeTab,
  setActiveTab,
  onOpenIssue,
  onOpenPalette,
  paletteOpen,
  modalOpen,
}: Options) {
  const [focusedIssueId, setFocusedIssueId] = useState<number | null>(null);

  const focusedRef = useRef<number | null>(null);
  focusedRef.current = focusedIssueId;

  // Stable refs for callbacks — avoids stale closures without re-registering
  const cbRef = useRef({ setActiveTab, onOpenIssue, onOpenPalette });
  useEffect(() => { cbRef.current = { setActiveTab, onOpenIssue, onOpenPalette }; });

  // Reset focus whenever the active tab changes
  useEffect(() => { setFocusedIssueId(null); }, [activeTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const isEditing =
        tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;

      // Ctrl/Cmd+K: always works, even while editing
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        cbRef.current.onOpenPalette();
        return;
      }

      // All other shortcuts: skip when editing or overlays are blocking
      if (isEditing || paletteOpen || modalOpen) return;

      // Tab shortcuts: 1 → Dashboard, 2 → Kanban, 3 → Pessoas
      if (e.key === '1') { cbRef.current.setActiveTab('dashboard'); return; }
      if (e.key === '2') { cbRef.current.setActiveTab('kanban'); return; }
      if (e.key === '3') { cbRef.current.setActiveTab('people'); return; }

      // Card navigation: J (down) / K (up)
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>('[data-issue-id]'),
        );
        if (!cards.length) return;
        const ids = cards.map(c => parseInt(c.dataset.issueId!));
        const current = focusedRef.current;
        const currentIdx = current != null ? ids.indexOf(current) : -1;
        const nextIdx =
          e.key === 'j'
            ? currentIdx < ids.length - 1 ? currentIdx + 1 : 0
            : currentIdx > 0 ? currentIdx - 1 : ids.length - 1;
        setFocusedIssueId(ids[nextIdx]);
        cards[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }

      // Open focused issue: Enter
      if (e.key === 'Enter' && focusedRef.current != null) {
        e.preventDefault();
        cbRef.current.onOpenIssue(focusedRef.current);
        setFocusedIssueId(null);
      }

      // Escape: clear focused card
      if (e.key === 'Escape' && focusedRef.current != null) {
        setFocusedIssueId(null);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [paletteOpen, modalOpen]);

  return { focusedIssueId };
}
