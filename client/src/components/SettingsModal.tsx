import { useEffect, useRef, useState } from 'react';
import { X, KeyRound, Eye, EyeOff, Check, Loader2, Trash2, Sparkles, ChevronDown, MessageSquare, LogIn, Mail, BookOpen, Shield } from 'lucide-react';
import { getAIKeys, saveAIKey, clearAIKey, getActiveAI, type AIProvider } from '../utils/aiConfig';
import { getTalkAuth, saveTalkAuth, clearTalkAuth, initLoginFlow, pollLoginFlow } from '../api/talk';
import { getMailConfig, saveMailConfig, clearMailConfig, DEFAULT_HOST, getMailHost } from '../utils/mailConfig';
import { getStoredAuth } from '../api/redmine';
import { mailApi } from '../api/mail';
import { getADCreds, saveADCreds, clearADCreds, hasEffectiveCreds, needsADCreds } from '../utils/adConfig';

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
  const [currentKey, setCurrentKey] = useState(() => getAIKeys()[config.id] ?? '');
  const [input, setInput] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(!!currentKey || active);

  const save = () => {
    if (!input.trim().startsWith(config.prefix)) {
      setError(`A chave deve começar com ${config.prefix}`);
      return;
    }
    saveAIKey(config.id, input.trim());
    setCurrentKey(input.trim());
    setInput('');
    setSaved(true);
    setError('');
    setTimeout(() => setSaved(false), 2500);
  };

  const remove = () => {
    clearAIKey(config.id);
    setCurrentKey('');
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
          {currentKey && !active && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {currentKey ? (
            <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                <Check size={12} />
                <span className="font-mono">{currentKey.slice(0, 20)}…</span>
              </div>
              <button
                onClick={remove}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
              >
                <Trash2 size={11} />
                Remover
              </button>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

type FlowState = 'idle' | 'waiting' | 'error';

function NextcloudSection() {
  const [currentAuth, setCurrentAuth] = useState(() => getTalkAuth());
  const [open, setOpen] = useState(!!currentAuth);
  const [url, setUrl] = useState('');
  const [flowState, setFlowState] = useState<FlowState>('idle');
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollParamsRef = useRef<{ pollEndpoint: string; pollToken: string } | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollParamsRef.current = null;
  };

  useEffect(() => () => stopPolling(), []);

  const startFlow = async () => {
    const base = url.trim().replace(/\/$/, '');
    if (!base) return;
    setError('');
    setFlowState('waiting');
    try {
      const { loginUrl, pollEndpoint, pollToken } = await initLoginFlow(base);
      window.open(loginUrl, '_blank', 'noopener');
      pollParamsRef.current = { pollEndpoint, pollToken };
      pollRef.current = setInterval(async () => {
        if (!pollParamsRef.current) return;
        try {
          const result = await pollLoginFlow(pollParamsRef.current.pollEndpoint, pollParamsRef.current.pollToken);
          if (result.done) {
            stopPolling();
            const auth = { url: result.server.replace(/\/$/, ''), user: result.user, token: result.token };
            saveTalkAuth(auth);
            setCurrentAuth(auth);
            setUrl('');
            setFlowState('idle');
          }
        } catch {
          // poll pode falhar por rede; ignora e tenta no próximo tick
        }
      }, 2000);
    } catch {
      setFlowState('error');
      setError('Não foi possível conectar ao Nextcloud. Verifique a URL.');
    }
  };

  const cancelFlow = () => {
    stopPolling();
    setFlowState('idle');
    setError('');
  };

  const remove = () => {
    clearTalkAuth();
    setCurrentAuth(null);
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Nextcloud Talk</span>
          {currentAuth && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
              Configurado
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {currentAuth ? (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                <Check size={12} />
                <span className="font-mono">{currentAuth.user}@{currentAuth.url.replace(/^https?:\/\//, '')}</span>
              </div>
              <button onClick={remove} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors">
                <Trash2 size={11} /> Remover
              </button>
            </div>
          ) : flowState === 'waiting' ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2.5">
                <Loader2 size={13} className="animate-spin text-blue-500 flex-shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Faça login na janela que abriu e volte aqui — detectaremos automaticamente.
                </p>
              </div>
              <button
                onClick={cancelFlow}
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={e => { setUrl(e.target.value); setError(''); }}
                  onKeyDown={e => e.key === 'Enter' && startFlow()}
                  placeholder="https://drive.suaempresa.com"
                  className="flex-1 text-xs border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <button
                  onClick={startFlow}
                  disabled={!url.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors whitespace-nowrap"
                >
                  <LogIn size={11} /> Entrar
                </button>
              </div>
              {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Você será redirecionado para a página de login do Nextcloud — inclusive com 2FA.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Seção genérica de credenciais corporativas (AD) — cobre E-mail e Wiki.
// Se logado com usuário/senha no Redmine: automático. Se por API key: formulário.
function ADCredsSection() {
  const auth = getStoredAuth();
  const isAuto = !!(auth?.username && auth?.password);
  const [creds, setCreds] = useState(() => getADCreds());
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(!isAuto && !creds);

  const save = () => {
    if (!user.trim() || !password) return;
    saveADCreds({ username: user.trim(), password });
    setCreds(getADCreds());
    setUser(''); setPassword('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const remove = () => {
    clearADCreds();
    setCreds(null);
    setSaved(false);
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${isAuto ? 'border-green-200 dark:border-green-800' : creds ? 'border-blue-200 dark:border-blue-800' : 'border-slate-200 dark:border-slate-700'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Usuário e senha do AD</span>
          {isAuto && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300">
              Automático
            </span>
          )}
          {!isAuto && creds && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300">
              Configurado
            </span>
          )}
          {!isAuto && !creds && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
              Necessário
            </span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          {isAuto ? (
            <div className="flex items-start gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2.5 text-xs text-green-700 dark:text-green-300">
              <Check size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                Logado como <strong>{auth?.username}</strong> com usuário e senha — E-mail e Wiki usam as mesmas credenciais automaticamente.
              </span>
            </div>
          ) : creds ? (
            <div className="flex items-center justify-between bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400">
                <Check size={12} />
                <span className="font-mono">{creds.username}</span>
              </div>
              <button onClick={remove} className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 transition-colors">
                <Trash2 size={11} /> Remover
              </button>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Informe seu usuário e senha do AD (Windows). Usados por <strong>E-mail</strong> e <strong>Wiki</strong>.
                O usuário é sem @domínio (ex.: <span className="font-mono">joao.moura</span>).
              </p>
              <div className="space-y-2">
                <input
                  value={user} onChange={e => setUser(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && save()}
                  placeholder="Usuário (ex.: joao.moura)"
                  autoComplete="off"
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && save()}
                    placeholder="Senha do AD"
                    autoComplete="new-password"
                    className="w-full text-xs px-3 py-2 pr-8 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {show ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <button
                onClick={save}
                disabled={!user.trim() || !password}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
              >
                {saved ? <><Check size={11} /> Salvo!</> : <><KeyRound size={11} /> Salvar</>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Seção E-mail — mostra status e permite customizar host se necessário.
function MailSection() {
  const available = hasEffectiveCreds();
  const [host, setHost] = useState(() => getMailConfig().host || DEFAULT_HOST);
  const [saved, setSaved] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [open, setOpen] = useState(false);

  const saveHost = () => {
    saveMailConfig({ host });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const test = async () => {
    setTestState('testing'); setTestError('');
    try { await mailApi.ping(); setTestState('ok'); }
    catch (e: any) { setTestState('error'); setTestError(e?.response?.data?.error || 'Falha na conexão'); }
  };

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">E-mail (Zimbra)</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${available ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'}`}>
            {available ? 'Disponível' : 'Sem credenciais'}
          </span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white dark:bg-slate-900">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Servidor Zimbra. Deixe o padrão se não souber qual usar.
          </p>
          <div className="flex gap-2">
            <input
              value={host} onChange={e => { setHost(e.target.value); setSaved(false); }}
              onKeyDown={e => e.key === 'Enter' && saveHost()}
              placeholder={DEFAULT_HOST}
              className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              onClick={saveHost}
              className="flex items-center gap-1 px-3 py-2 text-xs bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg font-medium transition-colors"
            >
              {saved ? <Check size={11} /> : null} Salvar
            </button>
          </div>
          {available && (
            <div className="flex items-center gap-2">
              <button
                onClick={test}
                disabled={testState === 'testing'}
                className="flex items-center gap-1.5 px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium transition-colors"
              >
                {testState === 'testing' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Testar conexão
              </button>
              {testState === 'ok' && <span className="text-xs text-green-600 dark:text-green-400">Conectado!</span>}
              {testState === 'error' && <span className="text-xs text-red-500">{testError}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Seção Wiki — só mostra status (credenciais vêm da seção AD acima).
function WikiSection() {
  const available = hasEffectiveCreds();
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Wiki (DokuWiki)</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${available ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300' : 'bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'}`}>
            {available ? 'Disponível' : 'Sem credenciais'}
          </span>
        </div>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 py-3 bg-white dark:bg-slate-900">
          {available ? (
            <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2.5">
              <Check size={13} />
              <span>wiki.redesoft.com.br acessível com as credenciais configuradas.</span>
            </div>
          ) : (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Configure o <strong>Usuário e senha do AD</strong> acima para habilitar o acesso à Wiki.
            </p>
          )}
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

          {/* Seção Credenciais corporativas (AD) */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-slate-500" />
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Credenciais corporativas
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Usuário e senha do AD (Windows). Necessários para E-mail e Wiki quando o login no Redmine é feito por chave de API.
            </p>
            <ADCredsSection />
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          {/* Serviços corporativos: E-mail + Wiki */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Mail size={14} className="text-blue-500" />
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">
                Serviços corporativos
              </h3>
            </div>
            <MailSection />
            <WikiSection />
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

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
