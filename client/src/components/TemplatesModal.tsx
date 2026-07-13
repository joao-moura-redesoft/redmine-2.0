import { useState } from 'react';
import { X, Plus, Trash2, FileText } from 'lucide-react';
import { useTemplates, templatesStore } from '../utils/templates';

// Cadastro de templates (respostas prontas / modelos). CRUD local.
export function TemplatesModal({ onClose }: { onClose: () => void }) {
  const templates = useTemplates();
  const [name, setName] = useState('');
  const [body, setBody] = useState('');

  const add = () => {
    if (!body.trim()) return;
    templatesStore.add(name, body.trim());
    setName('');
    setBody('');
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <FileText size={16} className="text-blue-500" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Templates
          </span>
          <span className="text-[11px] text-slate-400 ml-1">respostas prontas e modelos</span>
          <button
            onClick={onClose}
            className="ml-auto text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4 scrollbar-thin">
          {/* Novo template */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome (ex.: Pedir passos de reprodução)"
              className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Conteúdo do template (Markdown)…"
              className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={add}
              disabled={!body.trim()}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus size={14} /> Adicionar
            </button>
          </div>

          {/* Lista */}
          {templates.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">
              Nenhum template ainda. Crie o primeiro acima.
            </p>
          ) : (
            <div className="space-y-2">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      value={t.name}
                      onChange={(e) => templatesStore.update(t.id, { name: e.target.value })}
                      className="flex-1 text-sm font-medium bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-400 focus:outline-none py-0.5"
                    />
                    <button
                      onClick={() => templatesStore.remove(t.id)}
                      title="Excluir"
                      className="text-slate-400 hover:text-red-500 flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    value={t.body}
                    onChange={(e) => templatesStore.update(t.id, { body: e.target.value })}
                    rows={3}
                    className="w-full text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
