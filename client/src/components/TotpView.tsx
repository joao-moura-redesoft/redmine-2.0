import { useState, useEffect } from 'react';
import { Plus, Copy, Trash2, Check, ShieldCheck, KeyRound, Eye, EyeOff } from 'lucide-react';
import { totpRemaining } from '../utils/totp';
import { listTotp, addTotp, deleteTotp, type TotpEntry } from '../api/totp';

// SVG countdown ring
function CountdownRing({ remaining, total = 30 }: { remaining: number; total?: number }) {
  const r = 13;
  const circ = 2 * Math.PI * r;
  const progress = remaining / total;
  const offset = circ * (1 - progress);
  const color = remaining <= 5 ? '#ef4444' : remaining <= 10 ? '#f59e0b' : '#3b82f6';
  return (
    <svg width="36" height="36" className="rotate-[-90deg]">
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        className="text-slate-200 dark:text-slate-700"
      />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
      />
      <text
        x="18"
        y="18"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9"
        fontWeight="600"
        fill={color}
        style={{ transform: 'rotate(90deg)', transformOrigin: '18px 18px' }}
      >
        {remaining}
      </text>
    </svg>
  );
}

function TotpCard({
  account,
  remaining,
  onDelete,
}: {
  account: TotpEntry;
  remaining: number;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const code = account.code;
  const error = code === '------';

  const copy = async () => {
    if (error) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const part1 = code.slice(0, 3);
  const part2 = code.slice(3, 6);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center gap-4 group">
      <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
        <ShieldCheck size={18} className="text-blue-600 dark:text-blue-400" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate mb-0.5">
          {account.name}
        </p>
        {error ? (
          <p className="text-sm text-red-500 font-medium">Segredo inválido</p>
        ) : (
          <p className="text-2xl font-mono font-bold tracking-widest text-slate-900 dark:text-slate-100 select-all">
            {part1}
            <span className="mx-1.5 text-slate-300 dark:text-slate-600 font-light">·</span>
            {part2}
          </p>
        )}
      </div>

      <CountdownRing remaining={remaining} />

      <button
        onClick={copy}
        disabled={error}
        title="Copiar código"
        className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
      </button>

      <button
        onClick={onDelete}
        title="Remover conta"
        className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function TotpView() {
  const [accounts, setAccounts] = useState<TotpEntry[]>([]);
  const [remaining, setRemaining] = useState(totpRemaining());
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    try {
      const { accounts } = await listTotp();
      setAccounts(accounts);
    } catch {
      /* mantém lista atual */
    }
  };

  useEffect(() => {
    reload();
  }, []);

  // Conta o tempo restante localmente (sem segredo) e rebusca os códigos no
  // servidor a cada rollover de 30s (detectado quando o tempo restante sobe).
  useEffect(() => {
    let prev = totpRemaining();
    const tick = setInterval(() => {
      const rem = totpRemaining();
      setRemaining(rem);
      if (rem > prev) reload(); // virou o ciclo
      prev = rem;
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const addAccount = async () => {
    setFormError(null);
    const cleanSecret = secret.trim().replace(/\s/g, '').toUpperCase();
    if (!name.trim()) return setFormError('Informe um nome para a conta.');
    if (cleanSecret.length < 16)
      return setFormError('Segredo muito curto — verifique o valor copiado.');
    setAdding(true);
    try {
      await addTotp(name.trim(), cleanSecret);
    } catch (e: any) {
      setAdding(false);
      return setFormError(
        e?.response?.data?.error === 'semente inválida'
          ? 'Segredo inválido. Verifique se copiou corretamente.'
          : 'Não foi possível salvar. Tente novamente.',
      );
    }
    await reload();
    setName('');
    setSecret('');
    setShowForm(false);
    setAdding(false);
  };

  const remove = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await deleteTotp(id);
    } catch {
      reload();
    }
  };

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Autenticação 2FA
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Códigos TOTP gerados no servidor (sementes cifradas), sem precisar do celular.
          </p>
        </div>
        <button
          onClick={() => {
            setShowForm((v) => !v);
            setFormError(null);
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={15} />
          Adicionar
        </button>
      </div>

      {/* Formulário de adição */}
      {showForm && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 mb-4 space-y-3">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
            <KeyRound size={14} />
            Nova conta TOTP
          </p>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Nome da conta</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Nextcloud, GitHub, Google…"
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && addAccount()}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Segredo (base32)</label>
            <div className="relative">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="JBSWY3DPEHPK3PXP…"
                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-10 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && addAccount()}
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Cole o segredo exibido no QR code da configuração.
            </p>
          </div>

          {formError && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {formError}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => {
                setShowForm(false);
                setFormError(null);
                setName('');
                setSecret('');
              }}
              className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={addAccount}
              disabled={adding}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {adding ? 'Verificando…' : 'Salvar'}
            </button>
          </div>
        </div>
      )}

      {/* Lista de contas */}
      {accounts.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <ShieldCheck size={40} className="mb-3 opacity-30" />
          <p className="text-sm">Nenhuma conta cadastrada ainda.</p>
          <p className="text-xs mt-1">Clique em "Adicionar" para incluir uma conta TOTP.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <TotpCard
              key={acc.id}
              account={acc}
              remaining={remaining}
              onDelete={() => remove(acc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
