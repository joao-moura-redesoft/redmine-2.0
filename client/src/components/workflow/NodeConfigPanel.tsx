// Painel lateral de configuração do nó selecionado no editor de automações.
// Renderiza um formulário por `type`, escrevendo em `node.config` via onChange.
// Usa <select>/<input> nativos (leves) e hooks Redmine/Talk já existentes para
// popular dropdowns de status/prioridade/responsável/sala.
import { useState } from 'react';
import { Plus, Trash2, AlertTriangle, Eye } from 'lucide-react';
import {
  descriptorFor,
  triggerContext,
  ACTION_OUTPUTS,
  type NodeDescriptor,
  type TriggerContext,
} from './nodeCatalog';
import {
  FILTER_FIELD_DEFS,
  FIELD_GROUPS,
  CATEGORY_OPTS,
  WEEKDAYS,
  BOOL_OPTS,
  defFor,
  typeForField,
  fieldAvailable,
  operandsForType,
  labelForField,
  type Opt,
  type Rule,
} from './filterFields';
import { useWorkflowMeta } from './WorkflowMetaContext';
import type { WorkflowNode } from '../../api/workflows';

type Cfg = Record<string, unknown>;

// ---- primitivos de formulário --------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full text-sm text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-transparent';

function Text({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className={inputCls}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function Area({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      className={`${inputCls} resize-y`}
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// `emptyLabel` só existe quando "nenhum valor" é uma escolha válida (ex.: "—
// qualquer status —"). Sem ele, NÃO renderizamos a opção vazia — senão, quando o
// campo tem um padrão real (ex.: onError='continue'), o primeiro item apareceria
// duplicado: uma vez como opção vazia e outra como opção de verdade.
function Select({
  value,
  onChange,
  options,
  emptyLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  emptyLabel?: string;
}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.id} value={String(o.id)}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
      />
      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
    </label>
  );
}

// Dica de variáveis {{ }} — lista apenas o que o gatilho (e os nós anteriores)
// realmente produzem, evitando sugerir algo que resolveria vazio.
function VarHint({ ctx, outputs }: { ctx: TriggerContext; outputs: Set<string> }) {
  const tokens: string[] = [];
  if (ctx.issue) tokens.push('{{issue.id}}', '{{issue.subject}}', '{{issue.status.name}}');
  if (ctx.talk) tokens.push('{{message.text}}', '{{message.actor}}', '{{room.name}}');
  if (ctx.comment) tokens.push('{{comment.text}}', '{{comment.author}}');
  if (ctx.eventFields.has('from_status')) tokens.push('{{event.fromStatus}}');
  if (ctx.eventFields.has('to_status')) tokens.push('{{event.toStatus}}');
  // Saídas publicadas por nós anteriores.
  for (const o of ['ai.label', 'ai.text', 'webhook.status', 'created.id']) {
    if (outputs.has(o)) tokens.push(`{{${o}}}`);
  }
  tokens.push('{{now}}');

  return (
    <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
      Variáveis disponíveis:{' '}
      {tokens.map((t, i) => (
        <span key={t}>
          {i > 0 && ', '}
          <code className="font-mono">{t}</code>
        </span>
      ))}
      .
    </p>
  );
}

// ---- editor de regras (nó filter / branch) --------------------------------
// O catálogo de campos vive em ./filterFields (compartilhado com o card do nó).

// Seletor de campo agrupado (optgroup nativo), mostrando SÓ campos disponíveis no
// contexto do gatilho. Um campo já salvo mas indisponível (ex.: o gatilho mudou)
// aparece num grupo "Indisponível" para não sumir silenciosamente da tela.
function FieldSelect({
  value,
  onChange,
  customFields,
  ctx,
  outputs,
}: {
  value: string;
  onChange: (v: string) => void;
  customFields: Opt[];
  ctx: TriggerContext;
  outputs: Set<string>;
  aiLabels: string[];
}) {
  const stale = !!value && !fieldAvailable(value, ctx, outputs);
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {FIELD_GROUPS.map((g) => {
        const items = FILTER_FIELD_DEFS.filter(
          (f) => f.group === g && fieldAvailable(f.id, ctx, outputs),
        );
        if (items.length === 0) return null;
        return (
          <optgroup key={g} label={g}>
            {items.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </optgroup>
        );
      })}
      {ctx.issue && customFields.length > 0 && (
        <optgroup label="Personalizado">
          {customFields.map((cf) => (
            <option key={cf.id} value={String(cf.id)}>
              {cf.name}
            </option>
          ))}
        </optgroup>
      )}
      {stale && (
        <optgroup label="Indisponível neste gatilho">
          <option value={value}>{labelForField(value, customFields)}</option>
        </optgroup>
      )}
    </select>
  );
}

function FilterEditor({
  config,
  patch,
  fieldOptions,
  customFields,
  ctx,
  outputs,
  aiLabels,
}: {
  config: Cfg;
  patch: (p: Cfg) => void;
  fieldOptions: Record<string, Opt[]>;
  customFields: Opt[];
  ctx: TriggerContext;
  outputs: Set<string>;
  aiLabels: string[];
}) {
  const op = (config.op as string) === 'or' ? 'or' : 'and';
  const rules = (Array.isArray(config.rules) ? config.rules : []) as Rule[];

  // Primeiro campo válido no contexto atual (usado como padrão de uma regra nova).
  // "Horário" está sempre disponível, então isso nunca fica vazio.
  const defaultField =
    FILTER_FIELD_DEFS.find((f) => fieldAvailable(f.id, ctx, outputs))?.id ?? 'now.hour';

  const setRule = (i: number, r: Partial<Rule>) => {
    const next = rules.map((rule, idx) => (idx === i ? { ...rule, ...r } : rule));
    patch({ rules: next });
  };
  // Ao trocar o campo, zera valor e escolhe um operador válido para o novo tipo.
  const changeField = (i: number, field: string) => {
    const type = typeForField(field);
    const defVal = type === 'bool' ? 'true' : '';
    setRule(i, { field, value: defVal, operand: operandsForType(type)[0].id as string });
  };
  const addRule = () => {
    const type = typeForField(defaultField);
    patch({
      rules: [
        ...rules,
        { field: defaultField, operand: operandsForType(type)[0].id as string, value: type === 'bool' ? 'true' : '' },
      ],
    });
  };
  const removeRule = (i: number) => patch({ rules: rules.filter((_, idx) => idx !== i) });

  // Controle de valor conforme o tipo do campo.
  const renderValue = (rule: Rule, i: number) => {
    const type = typeForField(rule.field);
    const set = (v: string) => setRule(i, { value: v });
    if (type === 'issueSelect') {
      return (
        <Select
          value={rule.value ?? ''}
          onChange={set}
          options={fieldOptions[rule.field] ?? []}
          emptyLabel="— selecione —"
        />
      );
    }
    if (type === 'weekday') {
      return <Select value={rule.value ?? ''} onChange={set} options={WEEKDAYS} emptyLabel="— dia —" />;
    }
    if (type === 'category') {
      return <Select value={rule.value ?? ''} onChange={set} options={CATEGORY_OPTS} emptyLabel="— categoria —" />;
    }
    if (type === 'aiLabel') {
      // Rótulos vêm do nó "Classificar com IA" ancestral — sem digitar à mão.
      return aiLabels.length > 0 ? (
        <Select
          value={rule.value ?? ''}
          onChange={set}
          options={aiLabels.map((l) => ({ id: l, name: l }))}
          emptyLabel="— rótulo —"
        />
      ) : (
        <Text value={rule.value ?? ''} onChange={set} placeholder="Rótulo" />
      );
    }
    if (type === 'bool') {
      return <Select value={rule.value || 'true'} onChange={set} options={BOOL_OPTS} />;
    }
    if (type === 'number') {
      return (
        <input
          type="number"
          className={inputCls}
          value={rule.value ?? ''}
          onChange={(e) => set(e.target.value)}
          placeholder="Valor"
        />
      );
    }
    return <Text value={rule.value ?? ''} onChange={set} placeholder="Texto a buscar" />;
  };

  return (
    <div className="space-y-3">
      <Field label="Combinar regras com">
        <Select
          value={op}
          onChange={(v) => patch({ op: v })}
          options={[
            { id: 'and', name: 'E (todas)' },
            { id: 'or', name: 'OU (qualquer)' },
          ]}
        />
      </Field>
      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="text-xs text-slate-400">Sem regras — o ramo sempre segue.</p>
        )}
        {rules.map((rule, i) => {
          const type = typeForField(rule.field);
          const operands = operandsForType(type);
          const unavailable = !fieldAvailable(rule.field, ctx, outputs);
          return (
            <div
              key={i}
              className={`space-y-1.5 rounded-md border p-2 ${
                unavailable
                  ? 'border-amber-400 dark:border-amber-600'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <FieldSelect
                  value={rule.field}
                  onChange={(v) => changeField(i, v)}
                  customFields={customFields}
                  ctx={ctx}
                  outputs={outputs}
                  aiLabels={aiLabels}
                />
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  className="p-1 text-slate-400 hover:text-red-500"
                  title="Remover regra"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {unavailable && (
                <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
                  <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                  Este campo não existe no contexto deste gatilho — a regra nunca será verdadeira.
                </p>
              )}
              {operands.length > 1 && (
                <Select
                  value={rule.operand || (operands[0].id as string)}
                  onChange={(v) => setRule(i, { operand: v })}
                  options={operands}
                />
              )}
              {renderValue(rule, i)}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addRule}
        className="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
      >
        <Plus size={13} /> Adicionar regra
      </button>
    </div>
  );
}

// ---- painel principal ------------------------------------------------------
export function NodeConfigPanel({
  node,
  onChange,
  triggerType,
  upstreamTypes,
  aiLabels = [],
  onPreview,
}: {
  node: WorkflowNode;
  onChange: (config: Cfg) => void;
  /** Tipo do gatilho do workflow — define que dados existem no contexto. */
  triggerType?: string;
  /** Tipos dos nós ANCESTRAIS deste — definem quais saídas `{{…}}` existem. */
  upstreamTypes?: Set<string>;
  /** Rótulos do nó "Classificar com IA" ancestral (dropdown de `ai.label`). */
  aiLabels?: string[];
  /** Abre a prévia — só existe no gatilho de varredura. */
  onPreview?: () => void;
}) {
  const tctx = triggerContext(triggerType);
  // Saídas disponíveis = união do que cada ação ancestral publica.
  const outputs = new Set<string>();
  for (const t of upstreamTypes ?? []) for (const o of ACTION_OUTPUTS[t] ?? []) outputs.add(o);
  const meta = useWorkflowMeta();

  const d: NodeDescriptor | undefined = descriptorFor(node.type);
  const c = node.config || {};
  // patch mescla no config atual e propaga.
  const patch = (p: Cfg) => onChange({ ...c, ...p });
  const str = (k: string) => (c[k] == null ? '' : String(c[k]));

  // Listas vêm do contexto (mesmas queries, sem refetch) — ver WorkflowMetaContext.
  const statusOpts = meta.statuses;
  const priorityOpts = meta.priorities;
  const projectOpts = meta.projects;
  const trackerOpts = meta.trackers;
  const roomOpts = meta.rooms;
  const activityOpts = meta.activities;
  const meFirst = meta.members; // já vem com "Eu (mim)" no topo
  const customFieldOpts = meta.customFields;

  // Opções de valor por campo do filtro (dropdown em vez de texto livre).
  const filterFieldOptions: Record<string, Opt[]> = {
    project: projectOpts,
    tracker: trackerOpts,
    status: statusOpts,
    priority: priorityOpts,
    assignee: meFirst,
    'event.from_status': statusOpts,
    'event.to_status': statusOpts,
    'event.new_assignee': meFirst,
  };

  return (
    <div className="space-y-4">
      {d && (
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <d.icon size={16} />
            {d.label}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{d.description}</p>
        </div>
      )}

      {/* Ações que agem sobre a tarefa do evento exigem um gatilho de tarefa. */}
      {(node.type === 'issue.update' || node.type === 'issue.comment') && !tctx.issue && (
        <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          Este gatilho não produz uma tarefa — esta ação não fará nada. Use um gatilho de tarefa
          (criada, status mudou, responsável mudou ou varredura).
        </p>
      )}

      {/* ---------- Gatilhos ---------- */}
      {node.type === 'issue.created' && (
        <Field label="Categoria da tarefa">
          <Select
            value={str('category')}
            onChange={(v) => patch({ category: v })}
            options={[
              { id: 'assigned', name: 'Atribuída a mim' },
              { id: 'review', name: 'Para revisão' },
              { id: 'monitored', name: 'Monitorada' },
            ]}
            emptyLabel="— qualquer categoria —"
          />
        </Field>
      )}

      {node.type === 'issue.status_changed' && (
        <>
          <Field label="De (status origem)">
            <Select
              value={str('from')}
              onChange={(v) => patch({ from: v })}
              options={statusOpts}
              emptyLabel="— qualquer —"
            />
          </Field>
          <Field label="Para (status destino)">
            <Select
              value={str('to')}
              onChange={(v) => patch({ to: v })}
              options={statusOpts}
              emptyLabel="— qualquer —"
            />
          </Field>
        </>
      )}

      {node.type === 'issue.assigned_changed' && (
        <Toggle
          checked={!!c.toMe}
          onChange={(v) => patch({ toMe: v })}
          label="Somente quando atribuída a mim"
        />
      )}

      {node.type === 'issue.commented' && (
        <Toggle
          checked={c.fromOthers !== false}
          onChange={(v) => patch({ fromOthers: v })}
          label="Somente comentários de outras pessoas"
        />
      )}

      {node.type === 'talk.message' && (
        <>
          <Field label="Sala">
            <Select
              value={str('roomToken')}
              onChange={(v) => patch({ roomToken: v })}
              options={roomOpts}
              emptyLabel="— qualquer sala —"
            />
          </Field>
          <Toggle
            checked={!!c.mentionsOnly}
            onChange={(v) => patch({ mentionsOnly: v })}
            label="Somente menções a mim"
          />
        </>
      )}

      {(node.type === 'schedule' || node.type === 'issue.scan') && (
        <>
          <Field label="Modo">
            <Select
              value={str('mode') || 'daily'}
              onChange={(v) => patch({ mode: v })}
              options={[
                { id: 'daily', name: 'Diário (hora fixa)' },
                { id: 'interval', name: 'A cada N minutos' },
              ]}
            />
          </Field>
          {(str('mode') || 'daily') === 'daily' ? (
            <div className="flex gap-2">
              <Field label="Hora">
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={inputCls}
                  value={str('hour') || '8'}
                  onChange={(e) => patch({ hour: Number(e.target.value) })}
                />
              </Field>
              <Field label="Minuto">
                <input
                  type="number"
                  min={0}
                  max={59}
                  className={inputCls}
                  value={str('minute') || '0'}
                  onChange={(e) => patch({ minute: Number(e.target.value) })}
                />
              </Field>
            </div>
          ) : (
            <Field label="Intervalo (minutos)">
              <input
                type="number"
                min={1}
                className={inputCls}
                value={str('everyMinutes') || '60'}
                onChange={(e) => patch({ everyMinutes: Number(e.target.value) })}
              />
            </Field>
          )}
          {node.type === 'issue.scan' && (
            <>
              <Field label="Tarefas a varrer">
                <Select
                  value={str('scope') || 'assigned'}
                  onChange={(v) => patch({ scope: v })}
                  options={[
                    { id: 'assigned', name: 'Atribuídas a mim' },
                    { id: 'review', name: 'Para revisão' },
                    { id: 'monitored', name: 'Monitoradas' },
                    { id: 'all', name: 'Todas (as acima)' },
                  ]}
                />
              </Field>
              {/* Sem isso, a varredura reexecuta as ações a cada rodada enquanto a
                  condição seguir verdadeira — vira spam. */}
              <Field label="Repetir por tarefa">
                <Select
                  value={str('repeat') || 'always'}
                  onChange={(v) => patch({ repeat: v })}
                  options={[
                    { id: 'always', name: 'Toda execução' },
                    { id: 'once', name: 'Uma vez por tarefa' },
                    { id: 'cooldown', name: 'No máximo a cada N dias' },
                  ]}
                />
              </Field>
              {str('repeat') === 'cooldown' && (
                <Field label="Intervalo mínimo (dias)">
                  <input
                    type="number"
                    min={1}
                    className={inputCls}
                    value={str('cooldownDays') || '1'}
                    onChange={(e) => patch({ cooldownDays: Number(e.target.value) })}
                  />
                </Field>
              )}
              {/* Teto de segurança: as tarefas cortadas não são marcadas como
                  avisadas, então entram na próxima execução. É limite de ritmo. */}
              <Field label="Máximo de tarefas por execução">
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={str('maxIssues') || '20'}
                  onChange={(e) => patch({ maxIssues: Number(e.target.value) })}
                />
              </Field>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
                Se mais tarefas casarem, o excedente fica para a próxima execução — nada é perdido.
              </p>
              {onPreview && (
                <button
                  type="button"
                  onClick={onPreview}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Eye size={13} />
                  Ver quais tarefas casam agora
                </button>
              )}
            </>
          )}
        </>
      )}

      {/* ---------- Filtro / Se-senão ---------- */}
      {(node.type === 'filter' || node.type === 'if') && (
        <FilterEditor
          config={c}
          patch={patch}
          fieldOptions={filterFieldOptions}
          customFields={customFieldOpts}
          ctx={tctx}
          outputs={outputs}
          aiLabels={aiLabels}
        />
      )}

      {/* ---------- Ações ---------- */}
      {node.type === 'notify' && (
        <>
          <Field label="Título">
            <Text value={str('title')} onChange={(v) => patch({ title: v })} />
          </Field>
          <Field label="Corpo">
            <Area value={str('body')} onChange={(v) => patch({ body: v })} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'k86.screen' && (
        <>
          <Field label="Título">
            <Text value={str('title')} onChange={(v) => patch({ title: v })} />
          </Field>
          <Field label="Subtítulo">
            <Text value={str('subtitle')} onChange={(v) => patch({ subtitle: v })} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'talk.send' && (
        <>
          <Field label="Sala">
            <Select
              value={str('roomToken')}
              onChange={(v) => patch({ roomToken: v })}
              options={roomOpts}
              emptyLabel="— selecione uma sala —"
            />
          </Field>
          <Field label="Mensagem">
            <Area value={str('message')} onChange={(v) => patch({ message: v })} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'issue.update' && (
        <>
          <Field label="Novo status">
            <Select
              value={str('status_id')}
              onChange={(v) => patch({ status_id: v })}
              options={statusOpts}
              emptyLabel="— não alterar —"
            />
          </Field>
          <Field label="Novo responsável">
            <Select
              value={str('assigned_to_id')}
              onChange={(v) => patch({ assigned_to_id: v })}
              options={meFirst}
              emptyLabel="— não alterar —"
            />
          </Field>
          <Field label="Nova prioridade">
            <Select
              value={str('priority_id')}
              onChange={(v) => patch({ priority_id: v })}
              options={priorityOpts}
              emptyLabel="— não alterar —"
            />
          </Field>
          <Field label="Prazo">
            <input
              type="date"
              className={inputCls}
              value={str('due_date')}
              onChange={(e) => patch({ due_date: e.target.value })}
            />
          </Field>
        </>
      )}

      {node.type === 'issue.comment' && (
        <>
          <Field label="Comentário">
            <Area value={str('body')} onChange={(v) => patch({ body: v })} rows={4} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'webhook' && (
        <>
          <Field label="URL">
            <Text
              value={str('url')}
              onChange={(v) => patch({ url: v })}
              placeholder="https://..."
            />
          </Field>
          <Field label="Método">
            <Select
              value={str('method') || 'POST'}
              onChange={(v) => patch({ method: v })}
              options={[
                { id: 'POST', name: 'POST' },
                { id: 'GET', name: 'GET' },
                { id: 'PUT', name: 'PUT' },
              ]}
            />
          </Field>
          <Field label="Corpo (JSON)">
            <Area value={str('body')} onChange={(v) => patch({ body: v })} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'email.send' && (
        <>
          <Field label="Para">
            <Text
              value={str('to')}
              onChange={(v) => patch({ to: v })}
              placeholder="destinatario@exemplo.com"
            />
          </Field>
          <Field label="Assunto">
            <Text value={str('subject')} onChange={(v) => patch({ subject: v })} />
          </Field>
          <Field label="Texto">
            <Area value={str('text')} onChange={(v) => patch({ text: v })} rows={4} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {node.type === 'ai.generate' && (
        <>
          <Field label="Prompt">
            <Area value={str('prompt')} onChange={(v) => patch({ prompt: v })} rows={5} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
            O texto gerado fica disponível como <code className="font-mono">{'{{ai.text}}'}</code> nos
            nós seguintes (ex.: usar num comentário ou notificação). Usa a IA configurada nas suas
            Configurações.
          </p>
        </>
      )}

      {node.type === 'ai.classify' && (
        <>
          <Field label="O que classificar">
            <Area value={str('prompt')} onChange={(v) => patch({ prompt: v })} rows={4} />
          </Field>
          <LabelsEditor
            labels={Array.isArray(c.labels) ? (c.labels as string[]) : []}
            onChange={(labels) => patch({ labels })}
          />
          <VarHint ctx={tctx} outputs={outputs} />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
            A IA escolhe UM rótulo. Use <code className="font-mono">{'{{ai.label}}'}</code> num nó
            <strong> Se/senão</strong> logo abaixo para ramificar.
          </p>
        </>
      )}

      {node.type === 'issue.create' && (
        <>
          <Field label="Projeto">
            <Select
              value={str('project_id')}
              onChange={(v) => patch({ project_id: v })}
              options={projectOpts}
              emptyLabel="— selecione —"
            />
          </Field>
          <Field label="Título">
            <Text value={str('subject')} onChange={(v) => patch({ subject: v })} />
          </Field>
          <Field label="Descrição">
            <Area value={str('description')} onChange={(v) => patch({ description: v })} />
          </Field>
          <Field label="Tipo (tracker)">
            <Select
              value={str('tracker_id')}
              onChange={(v) => patch({ tracker_id: v })}
              options={trackerOpts}
              emptyLabel="— padrão do projeto —"
            />
          </Field>
          <Field label="Responsável">
            <Select
              value={str('assigned_to_id')}
              onChange={(v) => patch({ assigned_to_id: v })}
              options={meFirst}
              emptyLabel="— ninguém —"
            />
          </Field>
          <Field label="Prioridade">
            <Select
              value={str('priority_id')}
              onChange={(v) => patch({ priority_id: v })}
              options={priorityOpts}
              emptyLabel="— padrão —"
            />
          </Field>
          <Field label="Prazo">
            <input
              type="date"
              className={inputCls}
              value={str('due_date')}
              onChange={(e) => patch({ due_date: e.target.value })}
            />
          </Field>
          {tctx.issue && (
            <Field label="Vincular">
              <Select
                value={str('parent') || 'none'}
                onChange={(v) => patch({ parent: v })}
                options={[
                  { id: 'none', name: 'Tarefa independente' },
                  { id: 'event', name: 'Subtarefa da tarefa do evento' },
                ]}
              />
            </Field>
          )}
          <VarHint ctx={tctx} outputs={outputs} />
          <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            Cria uma tarefa de verdade no Redmine — inclusive ao usar o botão “Testar”.
          </p>
        </>
      )}

      {node.type === 'time.log' && (
        <>
          <Field label="Tarefa">
            <Select
              value={str('issue') || 'event'}
              onChange={(v) => patch({ issue: v })}
              options={[
                { id: 'event', name: 'A tarefa do evento' },
                { id: 'id', name: 'Uma tarefa fixa (por id)' },
              ]}
            />
          </Field>
          {str('issue') === 'id' && (
            <Field label="Id da tarefa">
              <input
                type="number"
                className={inputCls}
                value={str('issue_id')}
                onChange={(e) => patch({ issue_id: e.target.value })}
              />
            </Field>
          )}
          {(str('issue') || 'event') === 'event' && !tctx.issue && (
            <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400 leading-snug">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              Este gatilho não produz uma tarefa — escolha “tarefa fixa” ou use um gatilho de tarefa.
            </p>
          )}
          <Field label="Horas">
            <input
              type="number"
              step="0.25"
              min={0}
              className={inputCls}
              value={str('hours')}
              onChange={(e) => patch({ hours: e.target.value })}
            />
          </Field>
          <Field label="Atividade">
            <Select
              value={str('activity_id')}
              onChange={(v) => patch({ activity_id: v })}
              options={activityOpts}
              emptyLabel="— selecione —"
            />
          </Field>
          <Field label="Comentário">
            <Text value={str('comments')} onChange={(v) => patch({ comments: v })} />
          </Field>
          <VarHint ctx={tctx} outputs={outputs} />
        </>
      )}

      {/* Política de erro — vale para toda ação. */}
      {node.kind === 'action' && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
          <Field label="Se esta ação falhar">
            <Select
              value={str('onError') || 'continue'}
              onChange={(v) => patch({ onError: v })}
              options={[
                { id: 'continue', name: 'Continuar mesmo assim' },
                { id: 'stop', name: 'Parar este ramo' },
              ]}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

// Lista editável de rótulos do `ai.classify` (chips + adicionar/remover).
function LabelsEditor({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (l: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || labels.includes(v)) return;
    onChange([...labels, v]);
    setDraft('');
  };
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Rótulos possíveis</span>
      <div className="flex flex-wrap gap-1">
        {labels.map((l) => (
          <span
            key={l}
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200"
          >
            {l}
            <button
              type="button"
              onClick={() => onChange(labels.filter((x) => x !== l))}
              className="text-slate-400 hover:text-red-500"
              title="Remover rótulo"
            >
              <Trash2 size={11} />
            </button>
          </span>
        ))}
        {labels.length === 0 && <span className="text-xs text-slate-400">Nenhum rótulo</span>}
      </div>
      <div className="flex gap-1">
        <input
          className={inputCls}
          value={draft}
          placeholder="ex.: urgente"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          onClick={add}
          className="px-2 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          title="Adicionar rótulo"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
