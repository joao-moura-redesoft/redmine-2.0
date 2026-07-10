// Regras PURAS do motor de automações — sem rede, sem I/O, sem estado global.
// Extraídas do workflowEngine para poderem ser testadas de verdade (vitest).
// O engine cuida de buscar dados e executar ações; aqui só decidimos:
//   - que valor um campo de condição tem no contexto do evento (fieldValue)
//   - se uma regra / um conjunto de regras passa (evalRule / evalFilter)
//   - se um gatilho casa com um evento detectado (triggerMatches)
//   - se um gatilho agendado está na hora (scheduleDue)
//   - quais tarefas entram numa varredura (scanIssues)

const DAY_MS = 24 * 60 * 60 * 1000;

// Dias inteiros decorridos desde uma data ISO (updated_on/created_on).
// undefined se ausente/inválida — a regra falha graciosamente.
function daysSince(iso, now = Date.now()) {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  return Math.floor((now - t) / DAY_MS);
}

// Dias até uma data 'YYYY-MM-DD' (due_date). Negativo = atrasada.
// Compara DIA DE CALENDÁRIO com dia de calendário: o prazo é meia-noite, então
// diffar contra o "agora" (meio-dia, p.ex.) e usar floor empurraria o resultado
// um dia para baixo (prazo ontem viraria -2). `round` também absorve o pulo de
// horário de verão.
function daysUntil(ymd, now = Date.now()) {
  if (!ymd) return undefined;
  const t = new Date(`${ymd}T00:00:00`).getTime();
  if (Number.isNaN(t)) return undefined;
  const n = new Date(now);
  const todayMidnight = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((t - todayMidnight) / DAY_MS);
}

const localYmd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── valor de um campo de condição no contexto do evento ─────────────────────
// undefined ⇒ o campo não existe naquele contexto (a regra falha). A UI já
// impede escolher um campo indisponível, mas regras antigas podem sobreviver a
// uma troca de gatilho.
function fieldValue(field, ctx, now = Date.now()) {
  const issue = ctx.issue;

  // Campo personalizado: "cf:<id>" (listas viram texto separado por vírgula).
  if (field.startsWith('cf:')) {
    if (!issue) return undefined;
    const cfId = field.slice(3);
    const cf = (issue.custom_fields || []).find((c) => String(c.id) === cfId);
    if (!cf) return undefined;
    return Array.isArray(cf.value) ? cf.value.join(',') : cf.value;
  }

  switch (field) {
    case 'project':
      return issue?.project?.id;
    case 'tracker':
      return issue?.tracker?.id;
    case 'status':
      return issue?.status?.id;
    case 'priority':
      return issue?.priority?.id;
    case 'assignee':
      return issue ? (issue.assigned_to?.id ?? null) : undefined;
    case 'subject':
      return issue?.subject;
    case 'issue.updated_days':
      return daysSince(issue?.updated_on, now);
    case 'issue.created_days':
      return daysSince(issue?.created_on, now);
    case 'issue.due_days':
      return daysUntil(issue?.due_date, now);

    // Dados do próprio evento que disparou o workflow.
    case 'event.from_status':
      return ctx.event?.fromStatus;
    case 'event.to_status':
      return ctx.event?.toStatus;
    case 'event.category':
      return ctx.event?.category;
    case 'event.new_assignee':
      return ctx.event?.newAssignee;

    case 'message.text':
      return ctx.message?.text;
    case 'message.actor':
      return ctx.message?.actor;
    case 'message.mention':
      return ctx.message ? !!ctx.message.mention : undefined;
    case 'room.name':
      return ctx.room?.name;

    // Comentário novo (gatilho issue.commented).
    case 'comment.text':
      return ctx.comment?.text;
    case 'comment.author':
      return ctx.comment?.author;

    // Saídas de ações anteriores (namespaces nomeados).
    case 'ai.text':
      return ctx.ai?.text;
    case 'ai.label':
      return ctx.ai?.label;
    case 'webhook.status':
      return ctx.webhook?.status;
    case 'created.id':
      return ctx.created?.id;

    case 'now.hour':
      return new Date(now).getHours();
    case 'now.weekday':
      return new Date(now).getDay(); // 0=domingo … 6=sábado
    default:
      return undefined;
  }
}

// ── avaliação de regras ─────────────────────────────────────────────────────
// Só os campos de PESSOA aceitam o valor especial "me". Resolver "me" em
// qualquer campo quebraria uma regra legítima como: Título contém "me".
const ME_FIELDS = new Set(['assignee', 'event.new_assignee']);

function evalRule(rule, ctx, uid, now = Date.now()) {
  const actual = fieldValue(rule.field, ctx, now);
  if (actual === undefined || actual === null) return false; // campo indisponível
  // "Eu (mim)" resolve para o id do usuário dono da automação.
  const value = ME_FIELDS.has(rule.field) && rule.value === 'me' ? uid : rule.value;
  switch (rule.operand) {
    case 'neq':
      return String(actual) !== String(value);
    case 'contains':
      return String(actual).toLowerCase().includes(String(value).toLowerCase());
    case 'in':
      return String(value)
        .split(',')
        .map((s) => s.trim())
        .includes(String(actual));
    case 'gt':
      return Number(actual) > Number(value);
    case 'gte':
      return Number(actual) >= Number(value);
    case 'lt':
      return Number(actual) < Number(value);
    case 'lte':
      return Number(actual) <= Number(value);
    case 'eq':
    default:
      return String(actual) === String(value);
  }
}

// Sem regras ⇒ passa (o ramo sempre segue).
function evalFilter(config, ctx, uid, now = Date.now()) {
  const op = config?.op === 'or' ? 'or' : 'and';
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  if (rules.length === 0) return true;
  const results = rules.map((r) => evalRule(r, ctx, uid, now));
  return op === 'or' ? results.some(Boolean) : results.every(Boolean);
}

// ── matching de gatilho contra um evento detectado ──────────────────────────
function triggerMatches(trigger, ev, uid) {
  const c = trigger.config || {};
  switch (trigger.type) {
    case 'issue.created':
      return ev.type === 'created' && (!c.category || c.category === ev.category);
    case 'issue.status_changed':
      if (ev.type !== 'status_changed') return false;
      if (c.from && String(c.from) !== String(ev.fromStatus)) return false;
      if (c.to && String(c.to) !== String(ev.toStatus)) return false;
      return true;
    case 'issue.assigned_changed':
      if (ev.type !== 'assigned_changed') return false;
      if (c.toMe && String(ev.newAssignee) !== String(uid)) return false;
      return true;
    case 'talk.message':
      if (ev.type !== 'talk.message') return false;
      if (c.roomToken && c.roomToken !== ev.roomToken) return false;
      if (c.mentionsOnly && !ev.mention) return false;
      return true;
    case 'issue.commented':
      if (ev.type !== 'commented') return false;
      // "Somente de outras pessoas": ignora comentários feitos pelo próprio dono.
      if (c.fromOthers && String(ev.authorId) === String(uid)) return false;
      return true;
    default:
      return false;
  }
}

// ── agendamento ─────────────────────────────────────────────────────────────
// MUTA `state.lastScheduleRuns[trigger.id]` quando dispara (marca o disparo).
function scheduleDue(state, trigger, now = new Date()) {
  const c = trigger.config || {};
  const last = state.lastScheduleRuns[trigger.id] || 0;

  if ((c.mode || 'daily') === 'interval') {
    const everyMs = Math.max(1, Number(c.everyMinutes) || 60) * 60 * 1000;
    if (now.getTime() - last >= everyMs) {
      state.lastScheduleRuns[trigger.id] = now.getTime();
      return true;
    }
    return false;
  }

  // Diário: dispara uma vez ao passar hora:minuto no dia local.
  const hour = Number(c.hour) || 0;
  const minute = Number(c.minute) || 0;
  const passed = now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
  const lastDay = last ? localYmd(new Date(last)) : null;
  if (passed && lastDay !== localYmd(now)) {
    state.lastScheduleRuns[trigger.id] = now.getTime();
    return true;
  }
  return false;
}

// ── varredura ───────────────────────────────────────────────────────────────
// Tarefas no escopo. scope: 'assigned' | 'review' | 'monitored' | 'all'.
function scanIssues(issuesData, scope) {
  if (!issuesData) return [];
  const { issues, seen } = issuesData;
  if (!scope || scope === 'all') return [...issues.values()];
  const ids = new Set(seen[scope] || []);
  return [...issues.values()].filter((i) => ids.has(i.id));
}

// Política de repetição de uma varredura, por tarefa:
//   'always'   → sempre reexecuta (padrão; preserva o comportamento antigo)
//   'once'     → uma vez por tarefa, para sempre
//   'cooldown' → no máximo uma vez a cada `cooldownDays` dias
// `fired` é o mapa { [issueId]: timestamp } daquele workflow.
// Teto de segurança: quantas tarefas uma varredura pode AGIR por execução.
// Sem isso, um `issue.scan` com escopo "todas" + `issue.comment` comentaria em
// todas as tarefas abertas de uma vez, sem desfazer.
const SCAN_CAP_DEFAULT = 20;
function scanCap(config = {}) {
  const n = Number(config.maxIssues);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : SCAN_CAP_DEFAULT;
}

// Saídas publicadas por ações (ver ACTION_OUTPUTS no cliente). Numa PRÉVIA as
// ações não rodam, então esses valores não existem no contexto.
const OUTPUT_PREFIXES = ['ai.', 'webhook.', 'created.'];

// Uma condição que depende da saída de uma ação é INDECIDÍVEL numa prévia: fingir
// que é falsa mentiria (o ramo "verdadeiro" sumiria da prévia). Quem chama deve
// marcar a tarefa como "indeterminada" em vez de descartá-la.
function filterNeedsMissingOutput(config, ctx, now = Date.now()) {
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  return rules.some(
    (r) =>
      OUTPUT_PREFIXES.some((p) => String(r.field).startsWith(p)) &&
      fieldValue(r.field, ctx, now) === undefined,
  );
}

// Classifica o resultado de uma execução para o auto-pause:
//  - 'ok'        → alguma ação teve sucesso (zera o streak)
//  - 'transient' → todas falharam, mas só por instabilidade (429/5xx/rede)
//  - 'hard'      → todas falharam e ao menos uma é falha "dura" (4xx/config/auth)
//  - 'empty'     → nada rodou
function classifyRun(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return 'empty';
  if (actions.some((a) => a.ok)) return 'ok';
  if (actions.some((a) => !a.ok && !a.transient)) return 'hard';
  return 'transient';
}

// Próximo estado do fail-streak (puro). Devolve { streak, pause, changed }.
// Só falhas "duras" incrementam; sucesso zera; transiente é neutro. Ao atingir
// `max` falhas duras seguidas, sinaliza pausar (e zera o streak).
function nextFailStreak(current, actions, max = 5) {
  const kind = classifyRun(actions);
  if (kind === 'ok') return { streak: 0, pause: false, changed: current !== 0 };
  if (kind === 'hard') {
    const streak = current + 1;
    if (streak >= max) return { streak: 0, pause: true, changed: true };
    return { streak, pause: false, changed: true };
  }
  // 'transient' ou 'empty' → não mexe no streak.
  return { streak: current, pause: false, changed: false };
}

function scanRepeatAllows(fired, issueId, config = {}, now = Date.now()) {
  const mode = config.repeat || 'always';
  if (mode === 'always') return true;
  const last = fired?.[issueId];
  if (!last) return true;
  if (mode === 'once') return false;
  if (mode === 'cooldown') {
    const days = Math.max(0, Number(config.cooldownDays) || 0);
    return now - last >= days * DAY_MS;
  }
  return true;
}

module.exports = {
  DAY_MS,
  daysSince,
  daysUntil,
  localYmd,
  fieldValue,
  evalRule,
  evalFilter,
  triggerMatches,
  scheduleDue,
  scanIssues,
  scanRepeatAllows,
  scanCap,
  SCAN_CAP_DEFAULT,
  filterNeedsMissingOutput,
  classifyRun,
  nextFailStreak,
};
