import { useState } from 'react';
import { X, KeyRound, Eye, EyeOff, Check, Trash2, Sparkles, ChevronDown, MessageSquare } from 'lucide-react';
import { getAIKeys, saveAIKey, clearAIKey, getActiveAI, type AIProvider } from '../utils/aiConfig';
import { getTalkAuth, saveTalkAuth, clearTalkAuth } from '../api/talk';

interface Props {
  onClose: () => void;
}

interface ProviderConfig {
  id: AIProvider;
  name: string;
  prefix: string;
  placeholder: string;
  docsUrl: string;
  color: string;
  badge: string;
  badgeDark: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    prefix: 'sk-ant-',
    placeholder: 'sk-ant-api03-...',
    docsUrl: 'console.anthropic.com',
    color: 'text-orange-600 dark:text-orange-400',
    badge: 'bg-orange-50 border-orange-200 text-orange-700',
    badgeDark: 'dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300',
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    prefix: 'sk-',
    placeholder: 'sk-proj-...',
    docsUrl: 'platform.openai.com/api-keys',
    color: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    badgeDark: 'dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300',
  },
];

function ProviderSection({ config, active }: { config: ProviderConfig; active: boolean }) {
  const keys = getAIKeys();
  const existing = keys[config.id];
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!!existing || active);

  const save = () => {
    if (!input.trim().startsWith(config.prefix)) {
      setError(`A chave deve começar com ${config.prefix}`);
      return;
    }
    saveAIKey(config.id, input.trim());
    setInput('');
    setSaved(true);
    setError('');
    setTimeout(() => setSaved(false), 2500);
  };

  const remove = () => {
    clearAIKey(config.id);
    setSaved(false);
    setError('');
  };

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${
      active
        ? 'border-purple-300 dark:border-purple-700'
        : 'border-slate-200 dark:border-slate-700'
    }`}>
      {/* Header do provedor */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className={`text-sm font-medium ${config.color}`}>{config.name}</span>
          {active && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${config.badge} ${config.badgeDark}`}>
              Em uso
            </span>
          )}
          {existing && !active && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {/* Key atual */}
          {existing && !input && (
            <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                <Check size={12} />
                <span className="font-mono">{existing.slice(0, 20)}…</span>
              </div>
              <button
                onClick={remove}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
              >
                <Trash2 size={11} />
                Remover
              </button>
            </div>
          )}

          {/* Input */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={show ? 'text' : 'password'}
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); setSaved(false); }}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder={config.placeholder}
                autoComplete="new-password"
                className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {show ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              onClick={save}
              disabled={!input.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              {saved ? <><Check size={11} /> Salvo!</> : <><KeyRound size={11} /> Salvar</>}
            </button>
          </div>
          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Obtenha sua chave em <span className="font-mono">{config.docsUrl}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function NextcloudSection() {
  const existing = getTalkAuth();
  const [open, setOpen] = useState(!!existing);
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    if (!url.trim() || !user.trim() || !token.trim()) return;
    saveTalkAuth({ url: url.trim().replace(/\/$/, ''), user: user.trim(), token: token.trim() });
    setUrl(''); setUser(''); setToken('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const remove = () => {
    clearTalkAuth();
    setSaved(false);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Nextcloud Talk</span>
          {existing && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {existing && (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                <Check size={12} />
                <span className="font-mono">{existing.user}@{existing.url.replace(/^https?:\/\//, '')}</span>
              </div>
              <button onClick={remove} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors">
                <Trash2 size={11} /> Remover
              </button>
            </div>
          )}

          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://drive.suaempresa.com"
            className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <input
            type="text"
            value={user}
            onChange={e => setUser(e.target.value)}
            placeholder="usuário"
            className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                autoComplete="new-password"
                className="w-full text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 pr-8 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button type="button" onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <button
              onClick={save}
              disabled={!url.trim() || !user.trim() || !token.trim()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              {saved ? <><Check size={11} /> Salvo!</> : <><KeyRound size={11} /> Salvar</>}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Gere o App Token em: Configurações → Segurança → Dispositivos e sessões
          </p>
        </div>
      )}
    </div>
  );
}

export function SettingsModal({ onClose }: Props) {
  const active = getActiveAI();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Configurações</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Seção Nextcloud Talk */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-blue-500" />
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Nextcloud Talk
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Conecte ao Talk da sua empresa para chat integrado no canto inferior direito do app.
            </p>
            <NextcloudSection />
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          {/* Seção IA */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-purple-500" />
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Inteligência Artificial
              </h3>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Configure uma ou mais chaves. O <strong>Claude</strong> é usado quando disponível; o <strong>ChatGPT</strong> entra como fallback.
              As chaves ficam salvas apenas neste navegador.
            </p>

            {/* Status ativo */}
            {active && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                Usando: <strong className="text-slate-700 dark:text-slate-200">
                  {active.provider === 'anthropic' ? 'Claude (Anthropic)' : 'ChatGPT (OpenAI)'}
                </strong>
              </div>
            )}

            {PROVIDERS.map(p => (
              <ProviderSection
                key={p.id}
                config={p}
                active={active?.provider === p.id}
              />
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
