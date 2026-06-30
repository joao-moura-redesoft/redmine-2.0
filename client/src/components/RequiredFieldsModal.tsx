import { useState, type ReactNode } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import type { EditField } from '../types/redmine';

interface Props {
  statusName: string; // nome do status de destino (para o título)
  fields: EditField[]; // campos obrigatórios que faltam
  loading: boolean; // schema ainda carregando
  saving: boolean; // reenvio em andamento
  intro?: ReactNode; // texto de introdução (sobrescreve "Para mudar para X")
  submitLabel?: string; // rótulo do botão de confirmação
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void;
}

// Popup que aparece quando o Redmine recusa a mudança de status por campo(s)
// obrigatório(s) em branco. Renderiza um input por campo (conforme o tipo do
// schema) e reenvia a mudança junto com os valores preenchidos.
export function RequiredFieldsModal({
  statusName,
  fields,
  loading,
  saving,
  intro,
  submitLabel,
  onCancel,
  onSubmit,
}: Props) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const set = (id: string, v: string | string[]) => setValues((prev) => ({ ...prev, [id]: v }));

  const allFilled =
    fields.length > 0 &&
    fields.every((f) => {
      const val = values[f.id];
      if (Array.isArray(val)) return val.length > 0;
      return (val ?? '').trim() !== '';
    });

  const handleSubmit = () => {
    const out: Record<string, unknown> = {};
    const customs: { id: number; value: string | string[] }[] = [];
    for (const f of fields) {
      let v = values[f.id];
      if (v === undefined) {
        v = f.type === 'multiselect' ? [] : '';
      }
      if (f.kind === 'custom' && f.cfId != null) customs.push({ id: f.cfId, value: v });
      else if (f.kind === 'standard' && f.name) {
        out[f.name] = f.type === 'number' ? (v ? Number(v) : null) : v;
      }
    }
    if (customs.length) out.custom_fields = customs;
    onSubmit(out);
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex gap-2">
            <AlertCircle size={18} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Campos obrigatórios</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {intro ?? (
                  <>
                    Para mudar para <span className="font-medium">{statusName}</span>, preencha:
                  </>
                )}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {loading && (
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Carregando campos…
            </p>
          )}
          {!loading && fields.length === 0 && (
            <p className="text-sm text-slate-500">
              Não foi possível identificar os campos automaticamente. Preencha-os no formulário e
              tente de novo.
            </p>
          )}
          {!loading &&
            fields.map((f) => (
              <div key={f.id}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                <FieldInput field={f} value={values[f.id] ?? ''} onChange={(v) => set(f.id, v)} />
              </div>
            ))}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!allFilled || saving}
            className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-1.5"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}{' '}
            {submitLabel ?? 'Salvar e mudar status'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const cls =
    'w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300';
  switch (field.type) {
    case 'select':
      return (
        <select className={cls} value={value as string} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Selecione —</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const arrValue = Array.isArray(value) ? value : value ? [value as string] : [];
      return (
        <select
          multiple
          className={`${cls} min-h-[100px]`}
          value={arrValue}
          onChange={(e) => {
            const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange(vals);
          }}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case 'date':
      return (
        <input
          type="date"
          className={cls}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          rows={3}
          className={`${cls} resize-none`}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className={cls}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <input
          type="text"
          className={cls}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
