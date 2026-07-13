import { useState } from 'react';
import { ChevronUp, Clock, Hourglass, X, Loader2 } from 'lucide-react';
import type { Issue } from '../../types/redmine';
import { useQuickEditIssue, useStatuses, useAllMembers } from '../../hooks/useRedmine';
import { snoozeStore, SNOOZE_PRESETS } from '../../utils/snooze';
import { waitingStore } from '../../utils/waitingOn';

interface Opt {
  id: number;
  name: string;
}

// Menu suspenso (abre pra cima, já que a barra fica no rodapé).
function UpMenu({
  label,
  options,
  loading,
  onPick,
}: {
  label: string;
  options: Opt[] | undefined;
  loading?: boolean;
  onPick: (o: Opt) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      >
        {label} <ChevronUp size={12} className={open ? '' : 'rotate-180'} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 bottom-full mb-1 left-0 w-52 max-h-64 overflow-y-auto bg-white text-slate-700 rounded-lg shadow-2xl border border-slate-200 py-1 scrollbar-thin">
            {loading ? (
              <div className="flex justify-center py-3 text-slate-400">
                <Loader2 size={15} className="animate-spin" />
              </div>
            ) : (
              (options ?? []).map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    onPick(o);
                    setOpen(false);
                  }}
                  className="w-full text-left text-sm px-3 py-1.5 hover:bg-blue-50 truncate"
                >
                  {o.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Barra de ações em lote para as tarefas selecionadas na triagem.
export function BulkBar({ issues, onClear }: { issues: Issue[]; onClear: () => void }) {
  const quick = useQuickEditIssue();
  const statuses = useStatuses();
  const members = useAllMembers();
  const n = issues.length;

  const applyStatus = (o: Opt) => {
    issues.forEach((i) =>
      quick.mutate({
        id: i.id,
        fields: { status_id: o.id },
        optimistic: { status: o } as Partial<Issue>,
      }),
    );
    onClear();
  };
  const applyAssignee = (o: Opt) => {
    issues.forEach((i) =>
      quick.mutate({
        id: i.id,
        fields: { assigned_to_id: o.id },
        optimistic: { assigned_to: o } as Partial<Issue>,
      }),
    );
    onClear();
  };
  const snoozeAll = () => {
    const until = SNOOZE_PRESETS.find((p) => p.key === 'tomorrow')!.at();
    issues.forEach((i) => snoozeStore.snooze(i.id, until));
    onClear();
  };
  const waitAll = () => {
    issues.forEach((i) => waitingStore.toggle(i.id));
    onClear();
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[55] bg-slate-900 text-white rounded-xl shadow-2xl px-3 py-2 flex items-center gap-2 border border-white/10">
      <span className="text-sm font-semibold px-1 tabular-nums">
        {n} selecionada{n > 1 ? 's' : ''}
      </span>
      <span className="w-px h-5 bg-white/15" />
      <UpMenu
        label="Status"
        options={statuses.data}
        loading={statuses.isLoading}
        onPick={applyStatus}
      />
      <UpMenu
        label="Responsável"
        options={members.data?.map((m) => ({ id: m.id, name: m.name }))}
        loading={members.isLoading}
        onPick={applyAssignee}
      />
      <button
        onClick={snoozeAll}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      >
        <Clock size={12} /> Adiar
      </button>
      <button
        onClick={waitAll}
        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
      >
        <Hourglass size={12} /> Aguardando
      </button>
      <span className="w-px h-5 bg-white/15" />
      <button
        onClick={onClear}
        title="Limpar seleção (Esc)"
        className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}
