// MOTOR DE AUTOMAÇÕES — roda no loop de polling (push.js). A cada tick:
//  1) agrupa inscrições por usuário (credenciais + uid);
//  2) para cada usuário com automações ativas, detecta eventos:
//     - issues (created / status_changed / assigned_changed) via collectPushState + snapshot;
//     - Talk (mensagem/menção) via listagem de salas + talkSeen;
//     - schedule (diário/intervalo) via lastScheduleRuns;
//  3) para cada workflow cujo gatilho casa o evento, caminha o grafo
//     (filter para/segue o ramo; action executa) resolvendo variáveis {{ }}.
// O dedup vem do snapshot-diff / talkSeen: um evento só é emitido quando o campo
// muda de fato. Toda ação é try/catch: uma falha não derruba o tick (e pode parar
// só o ramo, via `onError: 'stop'`).
const axios = require('axios');
const { buildAuthHeaders, getMyUserId } = require('../lib/redmine');
const { sanitizeIssueBody, toLatin1Safe } = require('../lib/latin1');
const { mapLimit } = require('../lib/pagination');
const { safeAgents } = require('../lib/ssrfGuard');
const keyboard = require('./keyboardNotify');
const soundNotify = require('./soundNotify');
const talkStore = require('./talkStore');
const zimbra = require('../zimbra');
const { resolveInput } = require('../lib/variableResolver');
const {
  evalCondition,
  isOverBudget,
  triggerMatches,
  scheduleDue,
  scanIssues,
  scanRepeatAllows,
  scanCap,
  filterNeedsMissingOutput,
  nextFailStreak,
  waitMs,
  localYmd,
} = require('../lib/workflowRules');
const { listWorkflows, saveWorkflows } = require('./workflowStore');
const { getState, saveState } = require('./workflowState');
const { getTotp } = require('./secretsStore');
const { generateTOTP } = require('../lib/totp');
const workflowRuns = require('./workflowRuns');
const ai = require('./ai');
const { providerFor } = require('./digest');

const ISSUE_TRIGGERS = ['issue.created', 'issue.status_changed', 'issue.assigned_changed'];

// Marca do processo atual: o gatilho `app.startup` dispara uma vez por boot (por
// workflow). Como o estado é persistido, um restart muda o BOOT_TS e dispara de novo.
const BOOT_TS = Date.now();

// ── entrada do loop ─────────────────────────────────────────────────────────
let running = false;
async function tick(subscriptions, sendPush) {
  if (running) return;
  running = true;
  try {
    const byUid = await collectRunners(subscriptions);
    if (byUid.size === 0) return;
    for (const [uid, rec] of byUid) {
      try {
        await tickUser(uid, rec, sendPush, subscriptions);
      } catch (e) {
        console.warn('[workflow] uid', uid, 'falhou:', e.response?.status || e.message);
      }
    }
  } finally {
    running = false;
  }
}

// Monta o mapa uid → credenciais (rec) para rodar as automações. Duas fontes:
//  1) inscrições de Web Push (têm uid + subscription, permitem a ação notify);
//  2) sessões ativas de login (permitem rodar SEM push inscrito — resolve o uid
//     via getMyUserId, cacheado). Um rec por usuário basta.
async function collectRunners(subscriptions) {
  const byUid = new Map();
  for (const rec of subscriptions || []) {
    if (rec.uid && !byUid.has(rec.uid)) byUid.set(rec.uid, rec);
  }
  try {
    const { listSessions } = require('../lib/session');
    for (const s of listSessions()) {
      if (!s.url) continue;
      const rec = {
        url: s.url,
        key: s.apiKey || '',
        username: s.username || '',
        password: s.password || '',
      };
      let uid;
      try {
        uid = await getMyUserId(reqShim(rec));
      } catch {
        continue; // credencial inválida/offline — ignora esta sessão
      }
      if (uid && !byUid.has(uid)) {
        rec.uid = uid;
        byUid.set(uid, rec);
      }
    }
  } catch (e) {
    console.warn('[workflow] falha ao listar sessões:', e.message);
  }
  return byUid;
}

async function tickUser(uid, rec, sendPush, subscriptions) {
  const allWorkflows = listWorkflows(uid);
  const workflows = allWorkflows.filter(
    (w) => w.enabled && Array.isArray(w.nodes) && w.nodes.some((n) => n.kind === 'trigger'),
  );
  const state = getState(uid);
  // Também roda se houver esperas (nó Delay) a retomar, mesmo sem gatilho ativo.
  if (workflows.length === 0 && state.pending.length === 0) return;

  let dirty = false;
  let workflowsDirty = false;

  const triggerTypes = new Set(
    workflows.map((w) => w.nodes.find((n) => n.kind === 'trigger')?.type).filter(Boolean),
  );
  const needComments = triggerTypes.has('issue.commented');
  const needIssues = ISSUE_TRIGGERS.some((t) => triggerTypes.has(t)) || needComments;
  const needScan = triggerTypes.has('issue.scan');
  const needBudget = triggerTypes.has('time.budget_exceeded');
  const needTalk = triggerTypes.has('talk.message');
  const needEmail = triggerTypes.has('email.received');

  const events = [];
  let issuesData = null; // { issues: Map, seen } — usado por eventos E pela varredura

  if (needIssues || needScan || needBudget) {
    const { collectPushState } = require('./push'); // lazy: evita ciclo de require
    issuesData = await collectPushState(
      rec.url,
      rec.key || '',
      rec.username || '',
      rec.password || '',
    );
    // detectIssueEvents diffa/atualiza o snapshot — só para gatilhos de evento.
    if (needIssues) {
      const r = detectIssueEvents(state, issuesData.issues, issuesData.seen);
      events.push(...r.events);
      if (r.changed) dirty = true;
      // Comentários novos: busca journals só das tarefas que mudaram.
      if (needComments && r.commentCandidates.length) {
        events.push(...(await detectCommentEvents(state, r.commentCandidates, rec)));
        dirty = true;
      }
    }
  }

  if (needTalk) {
    const r = await detectTalkEvents(state, uid);
    events.push(...r.events);
    if (r.changed) dirty = true;
  }

  if (needEmail) {
    const r = await detectEmailEvents(state, rec);
    events.push(...r.events);
    if (r.changed) dirty = true;
  }

  const user = { id: uid };
  // (workflowsDirty declarado no topo — workflows.json é reescrito 1x por tick.)

  for (const w of workflows) {
    const trigger = w.nodes.find((n) => n.kind === 'trigger');
    if (!trigger) continue;

    // app.startup: dispara UMA VEZ por boot do backend (por workflow). Após um
    // restart, BOOT_TS muda e dispara de novo.
    if (trigger.type === 'app.startup') {
      if (state.appStartup[w.id] !== BOOT_TS) {
        state.appStartup[w.id] = BOOT_TS;
        dirty = true;
        const ctx = {
          issue: null,
          room: null,
          message: null,
          event: { type: 'app.startup' },
          user,
          now: nowIso(),
        };
        const run = { actions: [] };
        await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run });
        const o = await applyRunOutcome(uid, state, w, trigger, 'app.startup', run, {
          rec,
          sendPush,
          subscriptions,
        });
        if (o.dirty) dirty = true;
        if (o.workflowsDirty) workflowsDirty = true;
      }
      continue;
    }

    // Schedule é por-nó (não depende de evento externo).
    if (trigger.type === 'schedule') {
      if (scheduleDue(state, trigger)) {
        dirty = true; // scheduleDue mutou lastScheduleRuns
        const ctx = {
          issue: null,
          room: null,
          message: null,
          event: { type: 'schedule' },
          user,
          now: nowIso(),
        };
        const run = { actions: [] };
        await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run });
        if (absorbPending(state, run)) dirty = true;
        if (touchWorkflow(w, run)) workflowsDirty = true;
        {
          const fr = trackFailure(uid, state, w, run);
          if (fr.stateChanged) dirty = true;
          if (fr.paused) {
            workflowsDirty = true;
            await notifyAutoPaused(w, rec, sendPush, subscriptions);
          }
        }
        recordRun(uid, w, trigger, 'auto', 'schedule', run);
      }
      continue;
    }

    // Varredura agendada: no horário definido, roda o grafo UMA VEZ POR TAREFA no
    // escopo (as condições de idade/prazo/CF filtram por tarefa).
    if (trigger.type === 'issue.scan') {
      if (issuesData && scheduleDue(state, trigger)) {
        dirty = true;
        const scoped = scanIssues(issuesData, (trigger.config || {}).scope);
        const run = await runScanWorkflow(w, trigger, scoped, state, {
          rec,
          sendPush,
          subscriptions,
          user,
          eventType: 'issue.scan',
        });
        const o = await applyRunOutcome(uid, state, w, trigger, 'issue.scan', run, {
          rec,
          sendPush,
          subscriptions,
        });
        if (o.dirty) dirty = true;
        if (o.workflowsDirty) workflowsDirty = true;
      }
      continue;
    }

    // Orçamento de horas estourado: no horário definido, varre o escopo, enriquece
    // com spent_hours e roda o grafo por tarefa que passou das horas estimadas.
    if (trigger.type === 'time.budget_exceeded') {
      if (issuesData && scheduleDue(state, trigger)) {
        dirty = true;
        const scoped = scanIssues(issuesData, (trigger.config || {}).scope);
        const over = await filterOverBudget(rec, scoped);
        const run = await runScanWorkflow(w, trigger, over, state, {
          rec,
          sendPush,
          subscriptions,
          user,
          eventType: 'time.budget_exceeded',
        });
        const o = await applyRunOutcome(uid, state, w, trigger, 'time.budget_exceeded', run, {
          rec,
          sendPush,
          subscriptions,
        });
        if (o.dirty) dirty = true;
        if (o.workflowsDirty) workflowsDirty = true;
      }
      continue;
    }

    for (const ev of events) {
      if (!triggerMatches(trigger, ev, uid)) continue;
      // Dedup é feito pelo snapshot-diff (issues) / talkSeen (Talk): um evento só é
      // emitido quando o campo muda de fato — nunca a cada poll. Não usamos uma
      // lista de "firedKeys" porque ela suprimiria re-disparos legítimos (ex.: uma
      // tarefa que entra em Pendente Teste, sai e volta a entrar).
      dirty = true;
      const ctx = {
        issue: ev.ctx?.issue ?? null,
        room: ev.ctx?.room ?? null,
        message: ev.ctx?.message ?? null,
        comment: ev.ctx?.comment ?? null,
        email: ev.ctx?.email ?? null,
        // Os dados do evento (de/para status, categoria, novo responsável) ficam
        // disponíveis nas condições e em {{event.*}} — antes eram descartados.
        event: {
          type: ev.type,
          fromStatus: ev.fromStatus,
          toStatus: ev.toStatus,
          category: ev.category,
          newAssignee: ev.newAssignee,
        },
        user,
        now: nowIso(),
      };
      const run = { actions: [] };
      await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run });
      if (absorbPending(state, run)) dirty = true;
      if (touchWorkflow(w, run)) workflowsDirty = true;
      {
        const fr = trackFailure(uid, state, w, run);
        if (fr.stateChanged) dirty = true;
        if (fr.paused) {
          workflowsDirty = true;
          await notifyAutoPaused(w, rec, sendPush, subscriptions);
        }
      }
      recordRun(uid, w, trigger, 'auto', ev.type, run);
    }
  }

  // Retoma esperas (nó Delay) vencidas.
  if (state.pending.length) {
    const r = await processResumes(uid, state, allWorkflows, rec, sendPush, subscriptions);
    if (r.changed) dirty = true;
    if (r.workflowsDirty) workflowsDirty = true;
  }

  if (workflowsDirty) saveWorkflows();
  if (dirty) saveState();
}

// Move as esperas produzidas por um run (nós Delay) para o estado durável.
const MAX_PENDING = 1000;
function absorbPending(state, run) {
  if (!run.pending || run.pending.length === 0) return false;
  state.pending.push(...run.pending);
  if (state.pending.length > MAX_PENDING) {
    state.pending.splice(0, state.pending.length - MAX_PENDING);
  }
  return true;
}

// Varre um conjunto de tarefas rodando o grafo UMA VEZ POR TAREFA, com o teto de
// segurança e a política de repetição por tarefa (once/cooldown). Compartilhado
// por `issue.scan` e `time.budget_exceeded`. Devolve o `run` acumulado.
async function runScanWorkflow(
  w,
  trigger,
  scoped,
  state,
  { rec, sendPush, subscriptions, user, eventType },
) {
  const run = { actions: [] };
  const cfg = trigger.config || {};
  if (!state.scanFired[w.id]) state.scanFired[w.id] = {};
  const fired = state.scanFired[w.id];
  const now = Date.now();

  // Teto de segurança: limita quantas tarefas sofrem AÇÃO por execução. Ao bater
  // o teto, `break` — as restantes não são marcadas em `fired`, então entram na
  // próxima execução. O teto é rate limit, não perda.
  const cap = scanCap(cfg);
  let acted = 0;

  for (let i = 0; i < scoped.length; i++) {
    const issue = scoped[i];
    // Política 'once'/'cooldown': não age de novo na mesma tarefa.
    if (!scanRepeatAllows(fired, issue.id, cfg, now)) continue;
    if (acted >= cap) {
      run.truncated = scoped.length - i; // sobrou para a próxima execução
      break;
    }
    const ctx = {
      issue,
      room: null,
      message: null,
      event: { type: eventType },
      user,
      now: nowIso(),
    };
    const before = run.actions.length;
    await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run });
    // Só marca se alguma ação REALMENTE rodou — caso contrário uma tarefa barrada
    // pelo filtro seria contada como "já avisada".
    if (run.actions.length > before) {
      fired[issue.id] = now;
      acted++;
    }
  }

  // Poda tarefas que saíram do escopo (evita o mapa crescer para sempre). Nota:
  // com repeat='once', uma tarefa que sai e volta ao escopo é avisada de novo —
  // é o preço de não guardar histórico infinito.
  const inScope = new Set(scoped.map((i) => String(i.id)));
  for (const id of Object.keys(fired)) if (!inScope.has(id)) delete fired[id];

  return run;
}

// Pós-processamento comum de uma varredura: absorve esperas, marca a execução,
// aplica o auto-pause e grava no run log. Devolve o que o chamador deve persistir.
async function applyRunOutcome(
  uid,
  state,
  w,
  trigger,
  eventType,
  run,
  { rec, sendPush, subscriptions },
) {
  let dirty = false;
  let workflowsDirty = false;
  if (absorbPending(state, run)) dirty = true;
  if (touchWorkflow(w, run)) workflowsDirty = true;
  const fr = trackFailure(uid, state, w, run);
  if (fr.stateChanged) dirty = true;
  if (fr.paused) {
    workflowsDirty = true;
    await notifyAutoPaused(w, rec, sendPush, subscriptions);
  }
  recordRun(uid, w, trigger, 'auto', eventType, run);
  return { dirty, workflowsDirty };
}

// Enriquece as tarefas com spent_hours (o list do Redmine nem sempre traz) e
// devolve só as que estouraram o orçamento. Busca o detalhe só de quem TEM
// estimativa, com concorrência limitada — não puxa detalhe de tudo.
async function filterOverBudget(rec, issues) {
  const candidates = issues.filter((i) => Number(i.estimated_hours) > 0);
  const detailed = await mapLimit(candidates, 4, async (i) => {
    if (i.spent_hours != null) return i; // já veio no list
    try {
      const { data } = await redmineClient(rec).get(`/issues/${i.id}.json`);
      return data.issue;
    } catch (e) {
      console.warn('[workflow] budget: falha ao ler', i.id, e.response?.status || e.message);
      return null;
    }
  });
  return detailed.filter((i) => i && isOverBudget(i));
}

// Retoma as esperas vencidas (resumeAt <= agora). Para cada uma:
//  - workflow sumiu/desativado → descarta;
//  - re-busca a tarefa (reavalia condições pós-espera com dados ATUAIS); 404 →
//    descarta; erro de rede → mantém p/ o próximo tick;
//  - caminha o grafo a partir dos nós após o Delay.
async function processResumes(uid, state, allWorkflows, rec, sendPush, subscriptions) {
  const now = Date.now();
  const byId = new Map(allWorkflows.map((w) => [w.id, w]));
  const keep = [];
  const newPending = [];
  let changed = false;
  let workflowsDirty = false;

  for (const p of state.pending) {
    if (p.resumeAt > now) {
      keep.push(p);
      continue;
    }
    changed = true; // vencida: sai da fila de um jeito ou de outro
    const w = byId.get(p.wfId);
    if (!w || !w.enabled) continue; // workflow apagado/desativado → descarta a espera
    const trigger = w.nodes.find((n) => n.kind === 'trigger');
    if (!trigger) continue;

    let ctx = p.ctx;
    if (ctx.issue?.id) {
      try {
        const { data } = await redmineClient(rec).get(`/issues/${ctx.issue.id}.json`);
        ctx = { ...ctx, issue: data.issue, now: nowIso() }; // dados atuais pós-espera
      } catch (e) {
        if (e.response?.status === 404) continue; // tarefa sumiu → descarta
        keep.push(p); // erro de rede → tenta de novo no próximo tick
        continue;
      }
    }

    const run = { actions: [] };
    await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run, startIds: p.nodeIds });
    if (run.pending?.length) newPending.push(...run.pending); // Delay em sequência
    if (touchWorkflow(w, run)) workflowsDirty = true;
    const fr = trackFailure(uid, state, w, run);
    if (fr.paused) {
      workflowsDirty = true;
      await notifyAutoPaused(w, rec, sendPush, subscriptions);
    }
    recordRun(uid, w, trigger, 'auto', 'resume', run);
  }

  state.pending = keep.concat(newPending);
  return { changed, workflowsDirty };
}

// ── detecção de eventos ─────────────────────────────────────────────────────
// Devolve { events, changed }. `changed` diz se o snapshot mudou de fato — sem
// isso, gravaríamos o arquivo de estado (cifrado) a cada tick, para sempre.
function detectIssueEvents(state, issues, seen) {
  const events = [];
  const prev = state.issues || {};
  const firstRun = !state.issuesInit;
  const next = {};
  let changed = firstRun;

  // Categoria (assigned/review/monitored) da issue, para o gatilho issue.created.
  const category = {};
  for (const c of ['assigned', 'review', 'monitored']) {
    for (const id of seen[c] || []) if (!category[id]) category[id] = c;
  }

  const commentCandidates = []; // issues cujo updated_on mudou → checar comentário
  for (const [id, issue] of issues) {
    const snap = prev[id];
    const cur = {
      status_id: issue.status?.id ?? null,
      priority_id: issue.priority?.id ?? null,
      assigned_to_id: issue.assigned_to?.id ?? null,
      updated_on: issue.updated_on ?? null,
      // Preserva o baseline de comentários entre ticks (detectCommentEvents mexe nele).
      lastJournalId: snap ? snap.lastJournalId : undefined,
    };
    if (
      !snap ||
      snap.status_id !== cur.status_id ||
      snap.priority_id !== cur.priority_id ||
      snap.assigned_to_id !== cur.assigned_to_id ||
      snap.updated_on !== cur.updated_on
    ) {
      changed = true;
    }
    if (!firstRun) {
      const ctx = { issue };
      if (!snap) {
        events.push({ type: 'created', category: category[id] || null, issueId: id, ctx });
      } else {
        if (snap.status_id !== cur.status_id) {
          events.push({
            type: 'status_changed',
            fromStatus: snap.status_id,
            toStatus: cur.status_id,
            issueId: id,
            ctx,
          });
        }
        if (snap.assigned_to_id !== cur.assigned_to_id) {
          events.push({
            type: 'assigned_changed',
            newAssignee: cur.assigned_to_id,
            issueId: id,
            ctx,
          });
        }
        // updated_on mudou → algo aconteceu; pode ter sido um comentário novo.
        if (snap.updated_on !== cur.updated_on) commentCandidates.push({ id, issue });
      }
    }
    next[id] = cur;
  }

  // Tarefas que sumiram do escopo (fecharam, foram reatribuídas) também são mudança.
  if (Object.keys(prev).length !== Object.keys(next).length) changed = true;

  state.issues = next;
  state.issuesInit = true;
  return { events, changed, commentCandidates };
}

// Comentários novos (gatilho issue.commented). Só busca os journals das tarefas
// que MUDARAM (candidates), com concorrência limitada — não varre tudo. Guarda o
// último journal visto por tarefa; na primeira vez faz baseline sem disparar
// (mesma regra "não retroativo" dos outros gatilhos).
async function detectCommentEvents(state, candidates, rec) {
  if (!candidates || candidates.length === 0) return [];
  const client = redmineClient(rec);
  const events = [];

  await mapLimit(candidates, 4, async ({ id, issue }) => {
    let journals;
    try {
      const { data } = await client.get(`/issues/${id}.json`, { params: { include: 'journals' } });
      journals = (data.issue.journals || []).filter((j) => j.notes && String(j.notes).trim());
    } catch (e) {
      console.warn(
        '[workflow] issue.commented: falha ao ler journals de',
        id,
        e.response?.status || e.message,
      );
      return;
    }
    if (journals.length === 0) return;
    const maxId = Math.max(...journals.map((j) => j.id));
    const snap = state.issues[id];
    const last = snap?.lastJournalId;
    if (snap) snap.lastJournalId = maxId;
    if (last == null) return; // baseline — não dispara para comentários já existentes

    for (const j of journals.filter((jj) => jj.id > last)) {
      events.push({
        type: 'commented',
        issueId: id,
        authorId: j.user?.id ?? null,
        ctx: {
          issue,
          comment: {
            text: String(j.notes),
            author: j.user?.name || '',
            authorId: j.user?.id ?? null,
          },
        },
      });
    }
  });
  return events;
}

async function detectTalkEvents(state, uid) {
  const auth = talkStore.getTalkAuth(uid);
  if (!(auth?.url && auth?.user && auth?.token)) return { events: [], changed: false };
  const client = axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
  });
  const { data } = await client.get('/ocs/v2.php/apps/spreed/api/v4/room?format=json');

  const events = [];
  const firstRun = !state.talkInit;
  let changed = firstRun;
  const seen = state.talkSeen || {};
  for (const room of data.ocs.data || []) {
    if (room.type === 6) continue; // changelog
    const lastMsgId = room.lastMessage?.id || 0;
    const prevId = seen[room.token] || 0;
    if (lastMsgId && lastMsgId !== prevId) changed = true;
    if (!firstRun && lastMsgId > prevId && prevId > 0) {
      const msg = room.lastMessage;
      events.push({
        type: 'talk.message',
        roomToken: room.token,
        mention: !!room.unreadMention,
        issueId: null,
        ctx: {
          room: { token: room.token, name: room.displayName },
          message: {
            text: resolveMessageText(msg),
            actor: msg?.actorDisplayName || '',
            id: lastMsgId,
            mention: !!room.unreadMention,
          },
        },
      });
    }
    if (lastMsgId) seen[room.token] = lastMsgId;
  }
  state.talkSeen = seen;
  state.talkInit = true;
  return { events, changed };
}

// E-mails não lidos (gatilho email.received) via Zimbra SOAP. Os ids do Zimbra são
// inteiros crescentes; guardamos o maior já visto e disparamos só para os maiores
// que ele. No primeiro tick faz baseline sem disparar (não retroativo). Sem
// credenciais de e-mail / Zimbra offline → silencioso (não derruba o tick).
async function detectEmailEvents(state, rec) {
  let messages;
  try {
    const r = await zimbra.searchMessages(reqShim(rec), 'is:unread', { limit: 25 });
    messages = r.messages || [];
  } catch (e) {
    console.warn('[workflow] email.received: sem e-mail/Zimbra:', e.response?.status || e.message);
    return { events: [], changed: false };
  }

  const firstRun = !state.emailInit;
  const lastId = Number(state.emailSeenId) || 0;
  let maxId = lastId;
  const events = [];
  for (const m of messages) {
    const id = Number(m.id);
    if (!Number.isFinite(id)) continue;
    if (id > maxId) maxId = id;
    if (!firstRun && id > lastId) {
      events.push({
        type: 'email.received',
        emailId: id,
        from: m.from?.address || '',
        subject: m.subject || '',
        ctx: {
          email: {
            id: m.id,
            subject: m.subject || '',
            from: m.from?.address || '',
            fromName: m.from?.name || '',
            snippet: m.snippet || '',
            date: m.date || 0,
          },
        },
      });
    }
  }

  const changed = firstRun || maxId !== lastId;
  state.emailSeenId = maxId;
  state.emailInit = true;
  return { events, changed };
}

// ── caminhada no grafo ──────────────────────────────────────────────────────
// `bypassFilters` (teste manual) faz filtros passarem e branch seguir o ramo
// "verdadeiro". `dryRun` (prévia) avalia os filtros DE VERDADE mas não executa
// nenhuma ação. `run` coleta o resultado de cada ação para o run log/prévia.
async function runGraph(
  w,
  trigger,
  ctx,
  rec,
  sendPush,
  subscriptions,
  { bypassFilters, dryRun, run, startIds } = {},
) {
  const nodeById = new Map(w.nodes.map((n) => [n.id, n]));
  const visited = new Set();

  // Rastro da execução: nodeId → desfecho, para pintar o caminho no canvas.
  // 'ok'/'passed'/'true' = seguiu; 'error' = falhou; 'stopped'/'false' = parou/
  // ramo não tomado. Na varredura, união entre tarefas (last-write). Também
  // guardamos um rótulo do "sobre o quê" rodou (contexto).
  const mark = (id, outcome) => {
    if (run) {
      if (!run.nodes) run.nodes = {};
      run.nodes[id] = outcome;
    }
  };
  if (run && !run.context) run.context = contextLabel(ctx);
  mark(trigger.id, 'ok');

  // Numa prévia, condições que dependem da saída de uma ação (ex.: {{ai.label}})
  // são INDECIDÍVEIS — a ação não rodou. Marcamos e paramos o ramo, em vez de
  // fingir "falso" e sumir com o ramo verdadeiro da prévia.
  const undecidable = (node) => {
    if (!dryRun || !filterNeedsMissingOutput(node.config, ctx)) return false;
    if (run) run.indeterminate = true;
    return true;
  };

  async function walk(id) {
    if (visited.has(id)) return; // guarda contra ciclos acidentais
    visited.add(id);
    const node = nodeById.get(id);
    if (!node) return;

    if (node.kind === 'filter') {
      if (undecidable(node)) return void mark(id, 'stopped');
      const pass = bypassFilters || evalCondition(node, ctx, rec.uid);
      mark(id, pass ? 'passed' : 'stopped');
      if (!pass) return; // para o ramo
    } else if (node.kind === 'branch') {
      // Se/senão: segue nextIds (verdadeiro) ou elseIds (falso). Não cai no walk
      // genérico de nextIds embaixo (senão o ramo verdadeiro rodaria em dobro).
      if (undecidable(node)) return void mark(id, 'stopped');
      const pass = bypassFilters || evalCondition(node, ctx, rec.uid);
      mark(id, pass ? 'true' : 'false');
      for (const t of pass ? node.nextIds || [] : node.elseIds || []) await walk(t);
      return;
    } else if (node.kind === 'action') {
      // Nó de Espera: agenda a retomada e PARA este ramo. Em prévia/teste passa
      // direto (não cria espera de verdade que dispararia dias depois).
      if (node.type === 'wait') {
        mark(id, 'ok');
        if (!dryRun && !bypassFilters && run) {
          (run.pending ||= []).push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            wfId: w.id,
            resumeAt: Date.now() + waitMs(node.config),
            nodeIds: node.nextIds || [],
            ctx,
          });
          run.actions.push({ type: 'wait', ok: true });
          return; // pausa aqui; retoma num tick futuro
        }
        // prévia/teste: cai fora do if e segue para os nextIds abaixo
      } else if (dryRun) {
        if (run) run.actions.push({ type: node.type, ok: true, preview: true });
        mark(id, 'ok');
      } else {
        try {
          await execAction(node, ctx, rec, sendPush, subscriptions, { test: !!bypassFilters });
          if (run) run.actions.push({ type: node.type, ok: true });
          mark(id, 'ok');
        } catch (e) {
          const msg = e.response?.data?.errors?.join?.('; ') || e.response?.status || e.message;
          console.warn('[workflow] ação', node.type, 'falhou:', msg);
          mark(id, 'error');
          // `onError: 'stop'` interrompe ESTE ramo (os demais seguem). O padrão
          // continua sendo 'continue', preservando o comportamento anterior.
          const stopped = node.config?.onError === 'stop';
          if (run)
            run.actions.push({
              type: node.type,
              ok: false,
              error: String(msg),
              stopped,
              ...(e.transient ? { transient: true } : {}),
            });
          if (stopped) return;
        }
      }
    }
    for (const nextId of node.nextIds || []) await walk(nextId);
  }

  for (const nextId of startIds || trigger.nextIds || []) await walk(nextId);
}

// ── dispatch de ações ───────────────────────────────────────────────────────
async function execAction(node, ctx, rec, sendPush, subscriptions, { test } = {}) {
  const cfg = resolveInput(node.config || {}, ctx); // resolve {{ }} em todo o config

  switch (node.type) {
    case 'notify': {
      const recs = pushRecsFor(rec, subscriptions);
      if (recs.length === 0)
        return void console.warn('[workflow] notify: sem inscrição push p/ uid', rec.uid);
      // A tag identifica a notificação: com a MESMA tag, o service worker substitui
      // a anterior. Numa varredura que avisa 5 tarefas, um `tag` fixo por nó
      // deixaria só a última visível — por isso entra o id da tarefa/mensagem.
      const subject = ctx.issue?.id ?? ctx.message?.id ?? '';
      const payload = {
        title: cfg.title || 'Automação',
        body: cfg.body || '',
        tag: subject ? `wf-${node.id}-${subject}` : `wf-${node.id}`,
        ...(ctx.issue?.id ? { url: `/?issue=${ctx.issue.id}`, issueId: ctx.issue.id } : {}),
      };
      // Fan-out para todos os dispositivos do usuário (o digest já faz assim).
      for (const r of recs) await sendPush(r, payload);
      return;
    }
    case 'k86.screen':
      keyboard.notify({ type: 'summary', title: cfg.title || '', subtitle: cfg.subtitle || '' });
      return;
    case 'sound.play':
      // Efeito local (alto-falantes da máquina que roda o Bluemine), como o K86.
      soundNotify.play(cfg.sound || 'alert');
      return;
    case 'talk.send':
      await talkStore.sendTalkMessage(rec.uid, cfg.roomToken, cfg.message);
      return;
    case 'talk.change_status':
      await talkStore.setUserStatus(rec.uid, {
        statusType: cfg.statusType || 'dnd',
        message: cfg.message || '',
      });
      return;
    case 'issue.update': {
      const id = ctx.issue?.id;
      if (!id) return;
      const fields = {};
      if (cfg.status_id) fields.status_id = Number(cfg.status_id);
      if (cfg.assigned_to_id)
        fields.assigned_to_id = cfg.assigned_to_id === 'me' ? rec.uid : Number(cfg.assigned_to_id);
      if (cfg.priority_id) fields.priority_id = Number(cfg.priority_id);
      if (cfg.due_date) fields.due_date = cfg.due_date;
      if (Object.keys(fields).length === 0) return;
      await redmineWrite(rec, id, { issue: fields });
      return;
    }
    case 'issue.comment': {
      const id = ctx.issue?.id;
      if (!id || !cfg.body) return;
      await redmineWrite(rec, id, { issue: { notes: String(cfg.body) } });
      return;
    }
    case 'issue.assign_next': {
      // Round-robin: escolhe o próximo da lista e avança o índice (durável, por nó).
      const users = (Array.isArray(cfg.users) ? cfg.users : []).map(Number).filter((n) => n > 0);
      if (users.length === 0) return;
      const state = getState(rec.uid);
      const idx = Number(state.roundRobin[node.id]) || 0;
      const pick = users[idx % users.length];
      if (!test) {
        state.roundRobin[node.id] = (idx + 1) % users.length;
        saveState();
      }
      ctx.assigned = { id: pick }; // disponível como {{assigned.id}}
      const id = ctx.issue?.id;
      if (!id) return; // sem tarefa (ou teste): escolheu, mas não há onde escrever
      await redmineWrite(rec, id, { issue: { assigned_to_id: pick } });
      return;
    }
    case 'issue.link_issues': {
      const id = ctx.issue?.id;
      const target = Number(cfg.targetIssueId);
      if (!id || !target) return;
      const relationType = String(cfg.relationType || 'relates');
      await redmineClient(rec).post(`/issues/${id}/relations.json`, {
        relation: { issue_to_id: target, relation_type: relationType },
      });
      return;
    }
    case 'time.log_timer': {
      // 1ª execução: marca o início. 2ª: calcula o delta e aponta as horas reais.
      // Estado durável por nó+tarefa (cronômetros independentes por tarefa).
      const id = ctx.issue?.id;
      if (!id) return;
      const state = getState(rec.uid);
      const key = `${node.id}:${id}`;
      const startedAt = state.timers[key];
      const now = Date.now();
      if (!startedAt) {
        if (!test) {
          state.timers[key] = now;
          saveState();
        }
        ctx.timer = { started: true, hours: 0 };
        return;
      }
      const hours = Math.round(((now - startedAt) / 3600000) * 100) / 100;
      if (!test) {
        delete state.timers[key];
        saveState();
      }
      ctx.timer = { started: false, hours };
      if (hours <= 0 || !cfg.activity_id) return;
      const entry = {
        issue_id: id,
        hours,
        activity_id: Number(cfg.activity_id),
        spent_on: localYmd(new Date()),
      };
      if (cfg.comments) entry.comments = toLatin1Safe(String(cfg.comments));
      await redmineClient(rec).post('/time_entries.json', { time_entry: entry });
      return;
    }
    case 'webhook': {
      if (!cfg.url) return;
      // SSRF: a URL vem do usuário. Só http(s), e os agentes com lookup seguro
      // bloqueiam IPs internos/loopback/metadata — inclusive após redirect.
      let target;
      try {
        target = new URL(String(cfg.url));
      } catch {
        throw new Error('URL de webhook inválida');
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error(`Protocolo não permitido no webhook: ${target.protocol}`);
      }
      const method = String(cfg.method || 'POST').toLowerCase();
      const headers = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};
      let data = cfg.body;
      if (typeof data === 'string' && data.trim().startsWith('{')) {
        try {
          data = JSON.parse(data);
        } catch {
          /* mantém como texto */
        }
      }
      // Retry com backoff curto em falhas TRANSIENTES (rede/timeout, 5xx, 429):
      // absorve blips do destino. 4xx não é retentado — não vai se resolver sozinho.
      let res;
      try {
        res = await httpWithRetry({
          method,
          url: target.toString(),
          headers,
          data,
          timeout: 10000,
          maxRedirects: 3,
          validateStatus: () => true, // deixa o status virar contexto, não exceção
          ...safeAgents(),
        });
      } catch (e) {
        // Sem resposta (rede/timeout) após os retries → transiente: não pune o
        // workflow (não conta no fail-streak), o destino pode voltar.
        throw Object.assign(new Error(`webhook sem resposta: ${e.message}`), { transient: true });
      }
      // Disponibiliza para os nós seguintes: {{webhook.status}}, {{webhook.body}}.
      ctx.webhook = { status: res.status, body: res.data };
      if (res.status >= 400) {
        // 429/5xx = instabilidade do destino (transiente); 4xx = erro real da regra.
        const transient = res.status === 429 || res.status >= 500;
        throw Object.assign(new Error(`webhook respondeu ${res.status}`), { transient });
      }
      return;
    }
    case 'email.send': {
      if (!cfg.to) return;
      await zimbra.sendMessage(reqShim(rec), {
        to: cfg.to,
        subject: cfg.subject || '',
        text: cfg.text || '',
      });
      return;
    }
    case 'ai.generate': {
      if (!cfg.prompt) return;
      const prov = providerFor(rec.uid);
      if (!prov) {
        console.warn('[workflow] ai.generate: IA não configurada p/ uid', rec.uid);
        ctx.ai = { text: '' };
        return;
      }
      const text = await ai.aiComplete(prov.provider, prov.key, {
        system:
          'Você é um assistente que gera textos curtos e objetivos para automações de tarefas.',
        user: String(cfg.prompt),
        maxTokens: 800,
        uid: rec.uid,
      });
      // Disponibiliza o resultado para os nós seguintes via {{ai.text}}.
      ctx.ai = { text: text || '' };
      return;
    }
    case 'ai.classify': {
      const labels = (Array.isArray(cfg.labels) ? cfg.labels : []).map(String).filter(Boolean);
      if (!cfg.prompt || labels.length === 0) return;
      const prov = providerFor(rec.uid);
      if (!prov) {
        console.warn('[workflow] ai.classify: IA não configurada p/ uid', rec.uid);
        ctx.ai = { text: '', label: '' };
        return;
      }
      const raw = await ai.aiComplete(prov.provider, prov.key, {
        system:
          `Classifique a entrada em EXATAMENTE um destes rótulos: ${labels.join(', ')}. ` +
          'Responda apenas com o rótulo escolhido, sem pontuação nem explicação.',
        user: String(cfg.prompt),
        maxTokens: 20,
        uid: rec.uid,
      });
      const norm = String(raw || '')
        .trim()
        .toLowerCase();
      const label = labels.find((l) => l.toLowerCase() === norm);
      ctx.ai = { text: String(raw || '').trim(), label: label || '' };
      // Sem match: é um erro real (respeita o onError do nó) — melhor falhar alto
      // do que ramificar silenciosamente pelo "falso".
      if (!label) throw new Error(`IA devolveu "${raw}", fora dos rótulos [${labels.join(', ')}]`);
      return;
    }
    case 'ai.extract_data': {
      if (!cfg.prompt) return;
      const prov = providerFor(rec.uid);
      if (!prov) {
        console.warn('[workflow] ai.extract_data: IA não configurada p/ uid', rec.uid);
        ctx.ai = { ...(ctx.ai || {}), data: {} };
        return;
      }
      const fields = (Array.isArray(cfg.fields) ? cfg.fields : [])
        .map((f) => String(f).trim())
        .filter(Boolean);
      const keys = fields.length
        ? `com EXATAMENTE estas chaves: ${fields.join(', ')}`
        : 'com as chaves relevantes';
      const raw = await ai.aiComplete(prov.provider, prov.key, {
        system:
          `Extraia informações da entrada e responda SOMENTE com um objeto JSON válido ${keys}. ` +
          'Sem markdown, sem cercas de código, sem explicação. Use null quando um campo não existir.',
        user: String(cfg.prompt),
        maxTokens: 600,
        uid: rec.uid,
      });
      // Disponibiliza {{ai.data.<chave>}} para os nós seguintes.
      ctx.ai = { ...(ctx.ai || {}), data: parseJsonLoose(raw) || {} };
      return;
    }
    case 'ai.summarize': {
      const prov = providerFor(rec.uid);
      if (!prov) {
        console.warn('[workflow] ai.summarize: IA não configurada p/ uid', rec.uid);
        ctx.ai = { ...(ctx.ai || {}), summary: '' };
        return;
      }
      let input = '';
      if ((cfg.source || 'comments') === 'comments' && ctx.issue?.id) {
        try {
          const { data } = await redmineClient(rec).get(`/issues/${ctx.issue.id}.json`, {
            params: { include: 'journals' },
          });
          input = (data.issue.journals || [])
            .filter((j) => j.notes && String(j.notes).trim())
            .map((j) => `${j.user?.name || ''}: ${j.notes}`)
            .join('\n\n');
        } catch (e) {
          console.warn('[workflow] ai.summarize: falha ao ler journals:', e.message);
        }
      } else {
        input = String(cfg.text || '');
      }
      if (!input.trim()) {
        ctx.ai = { ...(ctx.ai || {}), summary: '' };
        return;
      }
      const text = await ai.aiComplete(prov.provider, prov.key, {
        system:
          'Resuma o conteúdo a seguir em português, de forma concisa e objetiva. ' +
          'Use bullet points quando fizer sentido.',
        user: input,
        maxTokens: 600,
        uid: rec.uid,
      });
      // Disponibiliza {{ai.summary}} para os nós seguintes.
      ctx.ai = { ...(ctx.ai || {}), summary: text || '' };
      return;
    }
    case 'totp.fetch': {
      // Busca a semente TOTP no cofre (DPAPI) e gera o código atual. Sem serviço
      // e com exatamente uma conta cadastrada, usa essa conta.
      const service = String(cfg.service || '')
        .trim()
        .toLowerCase();
      const accounts = getTotp(rec.uid);
      const acct =
        accounts.find((a) => String(a.name).trim().toLowerCase() === service) ||
        (!service && accounts.length === 1 ? accounts[0] : null);
      if (!acct) {
        console.warn('[workflow] totp.fetch: conta não encontrada:', cfg.service);
        ctx.totp = { code: '' };
        return;
      }
      // Disponibiliza {{totp.code}} para os nós seguintes.
      ctx.totp = { code: generateTOTP(acct.secret) };
      return;
    }
    case 'issue.create': {
      if (!cfg.project_id || !cfg.subject) return;
      const issue = { project_id: Number(cfg.project_id), subject: String(cfg.subject) };
      if (cfg.tracker_id) issue.tracker_id = Number(cfg.tracker_id);
      if (cfg.description) issue.description = String(cfg.description);
      if (cfg.priority_id) issue.priority_id = Number(cfg.priority_id);
      if (cfg.assigned_to_id)
        issue.assigned_to_id = cfg.assigned_to_id === 'me' ? rec.uid : Number(cfg.assigned_to_id);
      if (cfg.due_date) issue.due_date = cfg.due_date;
      // "Subtarefa da tarefa do evento" — só quando o gatilho produz uma tarefa.
      if (cfg.parent === 'event' && ctx.issue?.id) issue.parent_issue_id = ctx.issue.id;

      const body = { issue };
      sanitizeIssueBody(body);
      const { data } = await redmineClient(rec).post('/issues.json', body);
      // Disponibiliza {{created.id}} / {{created.subject}} para os nós seguintes.
      ctx.created = { id: data?.issue?.id, subject: data?.issue?.subject };
      return;
    }
    case 'time.log': {
      const issueId = cfg.issue === 'id' ? Number(cfg.issue_id) : ctx.issue?.id;
      const hours = Number(cfg.hours);
      if (!issueId || !hours || !cfg.activity_id) return;
      const entry = {
        issue_id: issueId,
        hours,
        activity_id: Number(cfg.activity_id),
        spent_on: cfg.spent_on || localYmd(new Date()),
      };
      if (cfg.comments) entry.comments = toLatin1Safe(String(cfg.comments));
      await redmineClient(rec).post('/time_entries.json', { time_entry: entry });
      return;
    }
    default:
      console.warn('[workflow] ação desconhecida:', node.type);
  }
}

// Registra a execução no run log (resumo + resultado por ação). Não persiste se
// nada rodou (sem ações no grafo). Cap nas ações (uma varredura pode acionar
// muitas tarefas — não deixa uma entrada crescer sem limite).
function recordRun(uid, w, trigger, mode, eventType, run) {
  if (!run || run.actions.length === 0) return;
  workflowRuns.record(uid, {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    workflowId: w.id,
    at: Date.now(),
    mode, // 'auto' | 'manual'
    trigger: trigger.type,
    event: eventType,
    ok: run.actions.every((a) => a.ok),
    actions: run.actions.slice(0, 50),
    ...(run.truncated ? { truncated: run.truncated } : {}),
    ...(run.nodes ? { nodes: run.nodes } : {}), // rastro p/ pintar o canvas
    ...(run.context ? { context: run.context } : {}), // "sobre o quê" rodou
  });
}

// Rótulo curto do que disparou o workflow (mostrado no histórico).
function contextLabel(ctx) {
  if (ctx?.issue?.id) return `#${ctx.issue.id} ${ctx.issue.subject || ''}`.trim();
  if (ctx?.message?.text) {
    const who = ctx.message.actor ? `${ctx.message.actor}: ` : '';
    return `${who}${ctx.message.text}`.slice(0, 80);
  }
  return '';
}

// Item 1 — avisa (push) quando um workflow é auto-desativado, para não morrer
// em silêncio. Sem inscrição push (só sessão), fica só no run log.
async function notifyAutoPaused(w, rec, sendPush, subscriptions) {
  try {
    const recs = pushRecsFor(rec, subscriptions);
    const payload = {
      title: '⚠️ Automação desativada',
      body: `"${w.name}" foi desativada após ${MAX_FAIL_STREAK} falhas seguidas. Abra Automações para revisar.`,
      tag: `wf-paused-${w.id}`,
      url: '/workflows',
    };
    for (const r of recs) await sendPush(r, payload);
  } catch (e) {
    console.warn('[workflow] falha ao avisar auto-pausa:', e.message);
  }
}

// Requisição HTTP com retry em falhas transientes (rede/timeout, 429, 5xx).
// Backoff curto e limitado — o tick não pode ficar preso: no pior caso soma
// ~1.6s por webhook. 4xx (exceto 429) não é retentado.
const WEBHOOK_RETRIES = 2;
const WEBHOOK_BACKOFF_MS = [400, 1200];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpWithRetry(config) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await axios(config);
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt < WEBHOOK_RETRIES) {
        await sleep(WEBHOOK_BACKOFF_MS[attempt]);
        continue;
      }
      return res; // 2xx/3xx, 4xx, ou transiente já sem tentativas
    } catch (e) {
      // Erro de rede/timeout (sem resposta): transiente.
      if (attempt < WEBHOOK_RETRIES) {
        await sleep(WEBHOOK_BACKOFF_MS[attempt]);
        continue;
      }
      throw e;
    }
  }
}

// Cliente Redmine autenticado a partir das credenciais do usuário (headless).
function redmineClient(rec) {
  return axios.create({
    baseURL: rec.url,
    headers: {
      ...buildAuthHeaders(rec.key || '', rec.username || '', rec.password || ''),
      'Content-Type': 'application/json',
    },
  });
}

async function redmineWrite(rec, issueId, body) {
  sanitizeIssueBody(body); // guarda latin1 (mesma do fluxo normal de escrita)
  await redmineClient(rec).put(`/issues/${issueId}.json`, body);
}

// Para notify: se o rec não é uma inscrição (ex.: teste manual via req), procura
// uma inscrição push do mesmo usuário.
// TODAS as inscrições push do usuário (celular + desktop). Se o `rec` veio de uma
// sessão de login (teste manual), ele não tem `subscription` — aí procuramos as
// inscrições dele na lista.
function pushRecsFor(rec, subscriptions) {
  const mine = (subscriptions || []).filter((s) => s.uid === rec.uid && s.subscription);
  if (mine.length > 0) return mine;
  return rec.subscription ? [rec] : [];
}

// Shim de `req` para o zimbra.sendMessage (que só usa req p/ resolver credenciais).
function reqShim(rec) {
  return {
    headers: {
      'x-redmine-url': rec.url,
      'x-redmine-key': rec.key || '',
      'x-redmine-user': rec.username || '',
      'x-redmine-pass': rec.password || '',
    },
  };
}

// Marca a execução SÓ quando alguma ação de fato rodou. Uma varredura em que
// nenhuma tarefa passou no filtro não é "uma execução" — contar inflaria o
// runCount e faria o "rodou há X min" mentir. Não persiste: quem chama agrupa a
// gravação (workflows.json é reescrito inteiro, cifrado).
function touchWorkflow(w, run) {
  if (!run || run.actions.length === 0) return false;
  w.lastRunAt = Date.now();
  w.runCount = (w.runCount || 0) + 1;
  return true;
}

// Auto-pausa: um workflow quebrado (ex.: webhook morto, sala do Talk apagada)
// tentaria e falharia a cada tick, para sempre. Após N falhas DURAS seguidas
// desativa (falha transiente não conta). A DECISÃO é pura (nextFailStreak, em
// lib/workflowRules, testada); aqui só aplicamos os efeitos.
// Devolve { stateChanged, paused } para o chamador saber o que persistir.
const MAX_FAIL_STREAK = 5;

function trackFailure(uid, state, w, run) {
  const current = state.failStreak[w.id] || 0;
  const { streak, pause, changed } = nextFailStreak(current, run?.actions, MAX_FAIL_STREAK);
  if (!changed) return { stateChanged: false, paused: false };

  if (streak === 0) delete state.failStreak[w.id];
  else state.failStreak[w.id] = streak;

  if (pause) {
    w.enabled = false;
    console.warn(`[workflow] "${w.name}" desativada após ${MAX_FAIL_STREAK} execuções falhando`);
    workflowRuns.record(uid, {
      id: `${Date.now()}-auto`,
      workflowId: w.id,
      at: Date.now(),
      mode: 'auto',
      trigger: 'system',
      event: 'auto_paused',
      ok: false,
      actions: [
        {
          type: 'system.paused',
          ok: false,
          error: `Desativada após ${MAX_FAIL_STREAK} execuções falhando`,
        },
      ],
    });
  }
  return { stateChanged: true, paused: pause };
}

// ── teste manual (POST /workflows/:id/run) ──────────────────────────────────
// Executa o grafo com um contexto de EXEMPLO, ignorando filtros, para validar as
// ações sem esperar um evento real. issue.id=0 (falsy) faz issue.update/comment
// virarem no-op — o teste não escreve em tarefas reais.
async function runWorkflowManual(uid, w, rec, sendPush, subscriptions) {
  const trigger = w.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) return;
  const ctx = sampleContext(trigger, uid);
  const run = { actions: [] };
  await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { bypassFilters: true, run });
  if (touchWorkflow(w, run)) saveWorkflows();
  recordRun(uid, w, trigger, 'manual', trigger.type, run);
}

// ── execução manual REAL (POST /workflows/:id/trigger) ──────────────────────
// Diferente do "Testar" (/run): RESPEITA os filtros e EXECUTA as ações de verdade
// — é o gatilho `workflow.manual`, disparado por um botão na UI. Se vier um
// `issueId` (lançado a partir de um card), busca a tarefa e a injeta no contexto;
// sem ele, roda sem tarefa (ações de issue viram no-op, como em qualquer gatilho
// que não produz tarefa). Honra nós de Espera absorvendo o pending no estado.
async function runWorkflowNow(uid, w, rec, sendPush, subscriptions, { issueId } = {}) {
  const trigger = w.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) return;

  let issue = null;
  if (issueId) {
    try {
      const { data } = await redmineClient(rec).get(`/issues/${issueId}.json`);
      issue = data.issue;
    } catch (e) {
      console.warn(
        '[workflow] runWorkflowNow: falha ao buscar issue',
        issueId,
        e.response?.status || e.message,
      );
    }
  }

  const ctx = {
    issue,
    room: null,
    message: null,
    event: { type: 'workflow.manual' },
    user: { id: uid },
    now: nowIso(),
  };
  const run = { actions: [] };
  await runGraph(w, trigger, ctx, rec, sendPush, subscriptions, { run });

  const state = getState(uid);
  if (absorbPending(state, run)) saveState();
  if (touchWorkflow(w, run)) saveWorkflows();
  recordRun(uid, w, trigger, 'manual', 'workflow.manual', run);
}

// ── prévia da varredura (POST /workflows/:id/preview) ───────────────────────
// Avalia as CONDIÇÕES contra as tarefas reais, sem executar nenhuma ação. É o
// inverso do "Testar" (que ignora filtros e executa as ações).
//
// Não toca o estado: nada de scheduleDue (mutaria lastScheduleRuns) nem de
// detectIssueEvents (mutaria o snapshot). Também ignora `scanFired` — a prévia
// responde "o que casa agora", não "o que ainda não foi avisado".
const PREVIEW_LIST_LIMIT = 50;

async function previewScan(uid, w, rec) {
  const trigger = w.nodes.find((n) => n.kind === 'trigger');
  if (!trigger || trigger.type !== 'issue.scan') {
    throw Object.assign(new Error('Prévia disponível apenas para o gatilho de varredura'), {
      statusCode: 400,
      isSafe: true,
    });
  }

  const { collectPushState } = require('./push');
  const issuesData = await collectPushState(
    rec.url,
    rec.key || '',
    rec.username || '',
    rec.password || '',
  );
  const cfg = trigger.config || {};
  const scoped = scanIssues(issuesData, cfg.scope);

  const matched = []; // lista (truncada para a UI)
  let matchedCount = 0; // total de tarefas que casam
  let indeterminate = 0;

  for (const issue of scoped) {
    const ctx = {
      issue,
      room: null,
      message: null,
      event: { type: 'issue.scan' },
      user: { id: uid },
      now: nowIso(),
    };
    const run = { actions: [] };
    await runGraph(w, trigger, ctx, rec, null, null, { dryRun: true, run });
    if (run.indeterminate) indeterminate++;
    if (run.actions.length === 0) continue;
    matchedCount++;
    if (matched.length < PREVIEW_LIST_LIMIT) {
      matched.push({
        id: issue.id,
        subject: issue.subject,
        actions: [...new Set(run.actions.map((a) => a.type))],
        indeterminate: !!run.indeterminate,
      });
    }
  }

  return {
    scopeCount: scoped.length,
    matchedCount,
    indeterminate,
    cap: scanCap(cfg),
    matched,
  };
}

function sampleContext(trigger, uid) {
  return {
    issue: {
      id: 0,
      subject: '[Exemplo] Tarefa de teste',
      status: { id: 0, name: 'Exemplo' },
      project: { id: 0, name: 'Projeto Exemplo' },
      priority: { id: 0, name: 'Normal' },
      tracker: { id: 0, name: 'Tarefa' },
      assigned_to: { id: uid, name: 'Você' },
    },
    room: { token: '', name: 'Sala Exemplo' },
    message: { text: 'mensagem de exemplo', actor: 'Fulano', id: 0, mention: false },
    comment: { text: 'comentário de exemplo', author: 'Fulano', authorId: 0 },
    email: {
      id: 0,
      subject: '[Exemplo] Assunto do e-mail',
      from: 'fulano@exemplo.com',
      fromName: 'Fulano',
      snippet: 'trecho do e-mail de exemplo',
      date: 0,
    },
    event: {
      type: trigger.type,
      fromStatus: 0,
      toStatus: 0,
      category: 'assigned',
      newAssignee: uid,
    },
    ai: { text: '', label: '', summary: '', data: {} },
    webhook: { status: 0, body: null },
    created: { id: 0, subject: '' },
    assigned: { id: uid },
    timer: { started: false, hours: 0 },
    totp: { code: '000000' },
    user: { id: uid },
    now: nowIso(),
  };
}

// ── utils ───────────────────────────────────────────────────────────────────
// (as regras puras — fieldValue/evalRule/scheduleDue/scanIssues — vivem em
//  lib/workflowRules.js, onde são cobertas por testes.)
const nowIso = () => new Date().toISOString();

// Parse tolerante do JSON devolvido pela IA: remove cercas ```json e, se ainda
// não parsear, tenta o primeiro { ... último }. Devolve null se não der.
function parseJsonLoose(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(s);
  } catch {
    /* tenta recortar o objeto abaixo */
  }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch {
      /* desiste */
    }
  }
  return null;
}

function resolveMessageText(msg) {
  if (!msg) return '';
  if (msg.message === '{file}') {
    const f = msg.messageParameters?.file;
    return f?.name ? `📎 ${f.name}` : '📎 Arquivo';
  }
  return String(msg.message || '').replace(/\{([\w-]+)\}/g, (_, k) => {
    const p = msg.messageParameters?.[k];
    return p?.name ? `@${p.name}` : k;
  });
}

// runGraph é exportado para teste de integração da caminhada no grafo (filter/
// branch/wait/rastro) — usa ações no-op (k86) para não tocar a rede.
module.exports = { tick, runWorkflowManual, runWorkflowNow, previewScan, runGraph };
