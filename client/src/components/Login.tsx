import { useState } from 'react';
import { Eye, EyeOff, Gem, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { saveAuth, RedmineAuth } from '../api/redmine';
import axios from 'axios';

interface Props {
  onSuccess: () => void;
}

export function Login({ onSuccess }: Props) {
  const [url, setUrl] = useState('https://');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = async () => {
    setLoading(true);
    setError(null);

    const cleanUrl = url.replace(/\/$/, '');

    try {
      const { data } = await axios.get('/api/users/current', {
        headers: {
          'X-Redmine-Url': cleanUrl,
          'X-Redmine-Key': apiKey.trim(),
        },
      });

      saveAuth({ url: cleanUrl, apiKey: apiKey.trim() });
      onSuccess();
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        setError('Chave de API inválida ou sem permissão. Verifique e tente novamente.');
      } else if (status === 404 || err.code === 'ERR_NETWORK') {
        setError('URL do Redmine não encontrada. Verifique o endereço e tente novamente.');
      } else {
        setError(`Erro ao conectar: ${err.response?.data?.error || err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = url.length > 10 && apiKey.trim().length > 10 && !loading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl flex items-center justify-center shadow-lg mb-4">
            <Gem size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Bluemine</h1>
          <p className="text-sm text-slate-500 mt-1">Entre com suas credenciais do Redmine</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
          {/* URL */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              URL do Redmine
            </label>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://redmine.suaempresa.com"
              autoFocus
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyDown={e => e.key === 'Enter' && canSubmit && validate()}
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Chave de API
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="••••••••••••••••••••••••••••••••••••••••"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                onKeyDown={e => e.key === 'Enter' && canSubmit && validate()}
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
              Encontre em
              <a
                href={`${url.length > 10 ? url : 'https://redmine'}/my/account`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
              >
                Minha conta → Chave de acesso API
                <ExternalLink size={11} />
              </a>
            </p>
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Botão */}
          <button
            onClick={validate}
            disabled={!canSubmit}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Verificando…
              </>
            ) : (
              'Entrar'
            )}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          As credenciais ficam salvas apenas neste navegador.
        </p>
      </div>
    </div>
  );
}
