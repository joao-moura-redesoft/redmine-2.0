# Implementação: Motor de Automações ("Automações") no Bluemine

> **Este documento é autocontido.** Foi escrito para um agente/dev **sem contexto prévio**
> do projeto. Contém o objetivo, a arquitetura, os blocos de código já existentes que devem ser
> reutilizados (com caminhos e assinaturas), as lacunas a construir (com o padrão a seguir), e um
> plano por fases com verificação. Leia inteiro antes de começar.

---

## 1. O que é o projeto (Bluemine)

Bluemine é um app desktop/web que serve como "hub" de um time de dev, construído **em cima do
Redmine** (API REST), integrando também **Nextcloud Talk** (chat), **Zimbra** (e-mail via SOAP) e a
telinha de um teclado **Attack Shark K86** (via HID). Roda como um `.exe` (Node SEA) na máquina de
cada usuário, mas o código é um app web normal.

**Stack e layout do repo** (raiz do projeto):
- `server/` — Node + **Express**. Entrypoint `server/index.js` → monta `server/app.js` e sobe workers
  de background (polling). Rotas em `server/routes/`, lógica em `server/services/`, utilitários em
  `server/lib/`.
- `client/` — **React 18 + Vite + TypeScript + TailwindCSS**, estado de servidor via
  **@tanstack/react-query**, ícones `lucide-react`, roteamento `react-router-dom`. Componentes em
  `client/src/components/`, hooks em `client/src/hooks/`, chamadas de API em `client/src/api/`.
- Idioma do código/UI: **português do Brasil** (comentários e strings em PT-BR).

**Autenticação (importante):** o cliente loga e recebe um cookie `session_id`. No servidor, o
`authMiddleware` (`server/middleware/auth.js`) lê esse cookie e **injeta headers** na requisição:
`x-redmine-url`, e `x-redmine-key` OU (`x-redmine-user` + `x-redmine-pass`). Praticamente todo o
servidor lê essas credenciais desses headers via `req`. O **`uid`** usado como chave em todos os
stores é o **id numérico do usuário no Redmine** (`getMyUserId(req)`).

**Modelo "por usuário":** há um `.exe` por usuário e um loop de polling server-side (`push.js`) que
mantém uma lista de **assinaturas de Web Push** — uma por usuário — cada uma carregando as
credenciais Redmine daquele usuário. Isso é a espinha dorsal para rodar automações **por usuário**.

---

## 2. Objetivo

Um **motor de automação totalmente customizável** estilo **n8n / CRM Twenty**, mas para o Bluemine:
o usuário define **gatilho → condições → ações** num **editor visual de grafo** (React Flow).

Exemplos: "quando uma tarefa entra em *Pendente Teste*, comenta e avisa no Talk"; "quando chega
menção no Talk, manda e-mail"; "toda manhã às 8h, notifica um resumo".

**Decisões já batidas (não reabrir):**
- **Builder = grafo visual** com **React Flow** (`@xyflow/react`), estilo n8n. (Não é formulário linear.)
- **Escopo = por usuário.** Cada pessoa define regras que disparam nos SEUS eventos e rodam com as
  credenciais dela. Sem "identidade de serviço" nem regras compartilhadas do time (fica pra futuro).
- **Gatilhos v1 (todos):** `issue.created` (nova/atribuída/para-revisão/monitorada), `issue.status_changed`,
  `issue.assigned_changed`, `talk.message` / `talk.mention`, `schedule` (cron simples).
- **Ações v1 (todas):** `notify` (Web Push) + `k86.screen` (telinha do teclado), `talk.send`,
  `issue.update`, `issue.comment`, `webhook` (POST HTTP), `email.send`.

---

## 3. Modelo de dados (grafo, adaptado do Twenty)

```ts
Workflow = {
  id: string;
  name: string;
  enabled: boolean;
  nodes: Node[];                 // inclui exatamente 1 nó com kind:'trigger'
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount?: number;
}
Node = {
  id: string;
  kind: 'trigger' | 'filter' | 'action';
  type: string;                  // ex.: 'issue.status_changed', 'talk.send', 'issue.comment'
  config: Record<string, unknown>;
  position: { x: number; y: number };  // posição no canvas
  nextIds: string[];             // arestas do grafo (ids dos próximos nós)
}
```
- **Exatamente 1 nó `trigger`** por workflow. As arestas vivem em `nextIds` (padrão do Twenty).
- **v1:** cadeias + fan-out simples (executar cada `nextId`). **Sem** multi-parent join, loops ou
  if-else no v1 (Fase 3).
- **Nó `filter`** = condições: `config = { op: 'and'|'or', rules: [{ field, operand, value }] }`.
  Se não passar, **para o ramo**. Campos: `project`, `tracker`, `status`, `priority`, `assignee`,
  `subject` (contém), custom fields. Operadores: `eq`, `neq`, `contains`, `in`, `changed_to`, etc.
- **Variáveis `{{ }}`:** ações podem referenciar o contexto do evento, ex.:
  `"{{message.actor}} disse: {{message.text}}"`, `"#{{issue.id}} {{issue.subject}}"`.
  Contexto = `{ issue, room, message, event, user, now }`.

### Config por tipo de nó (v1)
| Nó | `type` | `config` |
|---|---|---|
| Gatilho | `issue.created` | `{ category?: 'assigned'|'review'|'monitored' }` |
| Gatilho | `issue.status_changed` | `{ from?: statusId, to?: statusId }` |
| Gatilho | `issue.assigned_changed` | `{ toMe?: boolean }` |
| Gatilho | `talk.message` | `{ roomToken?: string, mentionsOnly?: boolean }` |
| Gatilho | `schedule` | `{ hour: number, minute: number }` (diário) ou `{ everyMinutes: number }` |
| Filtro | `filter` | `{ op, rules[] }` |
| Ação | `notify` | `{ title, body }` |
| Ação | `k86.screen` | `{ title, subtitle }` |
| Ação | `talk.send` | `{ roomToken, message }` |
| Ação | `issue.update` | `{ status_id?, assigned_to_id?, priority_id?, due_date? }` |
| Ação | `issue.comment` | `{ body }` |
| Ação | `webhook` | `{ url, method, headers?, body? }` |
| Ação | `email.send` | `{ to, subject, text }` |

---

## 4. Blocos JÁ EXISTENTES para reutilizar (caminhos + assinaturas)

> Confirmados por exploração do código. **Reaproveite ao máximo — não reescreva o que já existe.**

### 4.1 Fonte de eventos + gancho do loop — `server/services/push.js`
- `startPushPolling()` sobe os `setInterval`s de polling. **Já existe** um
  `setInterval(runDigests, 5*60*1000)` (o "digest diário") — **copie esse padrão** para adicionar
  `setInterval(() => workflowEngine.tick(subscriptions, sendPush), INTERVALO)`.
- `subscriptions` (array, no escopo do módulo): cada item (`rec`) tem
  `{ endpoint, subscription, url, key, username, password, seen:{assigned,review,monitored}, uid,
  talkPrefs, talkSeen:{[roomToken]:lastMsgId}, updatedAt, digestDate }`. **`rec` já contém as
  credenciais Redmine + `uid`** → dá para agir headless sem `req`.
- `collectPushState(url, key, username, password)` → `{ issues: Map<id,issueObj>, seen:{assigned:[ids],
  review:[ids], monitored:[ids]} }`. Traz os **objetos completos das issues** do usuário (assigned /
  review / monitored). Use para snapshot de campos.
- `pollTalkGroup({ auth, recs })` → detecta mensagens novas por sala. Padrão do cliente Talk cru
  (reutilizar em `sendTalkMessage`):
  ```js
  const talkClient = axios.create({
    baseURL: auth.url,
    auth: { username: auth.user, password: auth.token },
    headers: { 'OCS-APIRequest': 'true', Accept: 'application/json' },
  });
  ```
  `resolveMessageTextServer(msg)` resolve o texto de uma mensagem do Talk.
- `sendPush(rec, payload)` — envia Web Push (trata 404/410). **É interno** (`module.exports` só expõe
  `getVapidPublicKey, subscribe, unsubscribe, startPushPolling`). **AÇÃO: exportar `sendPush`** (ou
  passá-lo ao engine como parâmetro). Payload: `{ title, body, tag, url, ...custom }`.

### 4.2 Redmine (escrever headless) — `server/lib/`
- `server/lib/redmine.js`: `buildAuthHeaders(key, username, password)`, `makeRedmine(req)`,
  `getMyUserId(req)` (GET `/users/current.json`, cacheado por credencial → devolve `uid`).
- Padrão de cliente Redmine a partir do `rec` (já usado em `push.js` e `services/digest.js`):
  ```js
  const client = axios.create({
    baseURL: rec.url,
    headers: { ...buildAuthHeaders(rec.key, rec.username, rec.password), 'Content-Type': 'application/json' },
  });
  ```
- `server/lib/pagination.js`: `fetchAllIssues(redmineClient, params)`, `fetchAllPages(...)`,
  `mapLimit(items, limit, fn)`.
- Atualizar / comentar issue: `client.put('/issues/{id}.json', { issue: { status_id, notes, ... } })`.
  Ver `server/routes/issues.js` (rota `PUT /issues/:id`, ~linha 368) para a forma exata; **reutilize
  `sanitizeIssueBody`** (proteção latin1 do Redmine) ao escrever.

### 4.3 Talk — `server/services/talkStore.js`
- `getTalkAuth(uid)` → `{ url, user, token }` (credenciais do Talk daquele usuário, headless).
- **LACUNA:** não há helper de ENVIO reutilizável (só a rota que precisa de `req`). Criar
  `sendTalkMessage(uid, token, text)` usando o cliente cru acima + 
  `POST /ocs/v2.php/apps/spreed/api/v1/chat/${token}?format=json` com body `{ message: text }`.

### 4.4 Telinha K86 — `server/services/keyboardNotify.js`
- `notify(spec)` — fire-and-forget, no-op se `K86_ENABLED != 1`. Spec: `{ type, title, subtitle, tag }`
  ou `{ type:'summary', title, subtitle, chips:[{text,color}] }`. Exports: `{ notify, hhmm, ENABLED }`.

### 4.5 E-mail (Zimbra) — `server/zimbra.js`
- `sendMessage(req, { to, cc, subject, text, html, inReplyTo })` → `mailSoap(req, 'urn:zimbraMail',
  'SendMsgRequest', { m })`. `mailSoap` só usa `req` para `resolveMailCreds(req)`, que lê
  `x-redmine-user`/`x-redmine-pass` (headers) OU `getAd(uid)` do cofre de segredos.
- **LACUNA (headless):** sintetizar um `req`-shim a partir do `rec`:
  `{ headers: { 'x-redmine-url': rec.url, 'x-redmine-user': rec.username, 'x-redmine-pass': rec.password } }`
  e chamar `sendMessage(shim, {...})`. (Se o usuário autentica por API key em vez de user/pass, e-mail
  pode não ter credencial — tratar como no-op com log.)

### 4.6 IA (Fase 3) — `server/services/ai.js` + `server/services/digest.js`
- `aiComplete(provider, key, { system, user|userContent, maxTokens, fast, uid })` → texto.
- `providerFor(uid)` (em `digest.js`) → `{ provider, key }` do cofre (`secretsStore.getAi(uid)`).

### 4.7 Persistência — `server/lib/secureStore.js` + `server/services/notesStore.js`
- `secureStore`: `dataFile(name)` (caminho no `DATA_DIR`), `readJsonSecure(file, fallback)`,
  `writeJsonSecure(file, data, { requireEncryption })` (DPAPI por usuário; `requireEncryption:true`
  lança em vez de gravar texto puro), `DATA_DIR`.
- **Template de store por-uid: `server/services/notesStore.js`** (arquivo `{ [uid]: T[] }`). Copie a
  estrutura para `workflowStore.js`, mas com **`requireEncryption: true`** (regras podem embutir
  URLs/segredos). Funções tipo `userNotes(uid)`, `saveNotes()`, `removeNote(uid, id)`.

### 4.8 Registro de rotas — `server/app.js`
- Bloco sequencial `app.use('/api', require('./routes/X'))`. O `authMiddleware` é montado no meio;
  **rotas novas autenticadas vão DEPOIS dele** (junto com `issues`, `notes`, etc.).

### 4.9 Cliente — fatia vertical a clonar (feature "Notes")
- `client/src/api/client.ts` → `createAuthedClient()` (axios `baseURL:'/api'`, `withCredentials:true`,
  dispara evento `auth-expired` em 401). **Use em toda api nova.**
- `client/src/api/notes.ts` → CRUD tipado (`fetchNotes/createNote/updateNote/deleteNote`, tipos
  `Note`/`NotePatch`, gerador de id `newNoteId()`). **Clone para `api/workflows.ts`.**
- `client/src/hooks/useNotes.ts` → react-query `useNotes()` + mutations com optimistic
  (`onMutate`/`onError` rollback na key `['notes']`). **Clone para `useWorkflows.ts`.**
- `client/src/routes` em `client/src/App.tsx` — registrar aba nova (ver §6.4).
- Modais/forms de referência: `client/src/components/TemplatesModal.tsx`, `SettingsModal.tsx`.
  Dropdown compacto reutilizável: `client/src/components/inline/InlineSelect.tsx`.

---

## 5. O que estudar do Twenty (para portar o núcleo)

Repo local: `C:\Users\joao.moura\Documents\GitHub\twenty\twenty-main`. **Não copie a arquitetura
inteira** (grafo multi-parent, filas, iterators, ~114 arquivos de React Flow — desnecessário). Porte
só o núcleo leve:
- **Resolvedor de variáveis** `packages/twenty-shared/src/utils/variable-resolver.ts` (~90 linhas):
  `resolveInput(input, context)` faz deep-walk; tokens `{{ ... }}` (regex `/{{([^{}]+)}}/g`) são
  avaliados contra o `context` (ex.: `{{step.field.sub}}`). Se a string é só um token → devolve o
  valor cru/tipado; senão interpola (JSON.stringify em objetos). **Porte para
  `server/lib/variableResolver.js`**, com `context = { issue, room, message, event, user, now }`.
- **Modelo de filtro** `packages/twenty-shared/src/types/StepFilters.ts`: `StepFilterGroup {id,
  logicalOperator:AND|OR, ...}`, `StepFilter {id, stepOutputKey, operand, value, stepFilterGroupId}`.
  No v1 basta uma **lista plana de regras com um `op` AND/OR no topo** (aninhamento na Fase 3).
- **Conceito do executor**: `getWorkflowRunContext` = `{ [stepId]: resultado }`; caminha `nextStepIds`;
  `if-else` roteia ramo; `filter` passa/para. (Nosso executor v1 é uma versão sequencial disso.)

---

## 6. Implementação por fases

### FASE 1 — Definir automações (store + CRUD + builder visual)
Objetivo: cadastrar/editar/ativar workflows num canvas React Flow e persistir. **Sem execução ainda.**

**Server**
1. `server/services/workflowStore.js` — clone de `notesStore.js`, arquivo
   `dataFile('workflows.json')`, shape `{ [uid]: Workflow[] }`, `writeJsonSecure(..., {requireEncryption:true})`.
   Funções: `listWorkflows(uid)`, `upsertWorkflow(uid, wf)`, `deleteWorkflow(uid, id)`.
2. `server/routes/workflows.js` — Express router:
   - `GET /workflows` → `listWorkflows(await getMyUserId(req))`.
   - `POST /workflows` → cria (gera id, timestamps).
   - `PUT /workflows/:id` → atualiza.
   - `DELETE /workflows/:id`.
   - (`POST /workflows/:id/run` fica pra Fase 2.)
   - uid sempre via `getMyUserId(req)`.
3. Registrar em `server/app.js` **depois do authMiddleware**: `app.use('/api', require('./routes/workflows'));`

**Client**
1. Instalar dep: `cd client && npm install @xyflow/react`.
2. `client/src/api/workflows.ts` — clone de `api/notes.ts` (tipos `Workflow`/`Node` do §3;
   `fetchWorkflows/createWorkflow/updateWorkflow/deleteWorkflow`, `newId()`).
3. `client/src/hooks/useWorkflows.ts` — clone de `useNotes.ts` (query `['workflows']` + mutations
   optimistic).
4. `client/src/components/WorkflowsView.tsx` — lista de automações: nome, toggle `enabled`, resumo do
   gatilho, nº de nós, `lastRunAt`; botão "Nova automação"; abre o editor.
5. `client/src/components/workflow/WorkflowEditor.tsx` — **canvas React Flow** (`import { ReactFlow,
   Background, Controls, ... } from '@xyflow/react'` + `import '@xyflow/react/dist/style.css'`):
   - Renderiza `nodes` (mapeando `Node.position` → React Flow nodes; `nextIds` → edges).
   - Tipos de nó customizados (trigger / filter / action) — ver `nodes/*` abaixo.
   - Paleta para adicionar nó; conectar arestas (onConnect → atualiza `nextIds`); selecionar nó abre
     **painel lateral de config** (form por `type`).
   - Salvar serializa `nodes` (config + position + nextIds) e chama `updateWorkflow`.
6. `client/src/components/workflow/nodes/*` — componentes visuais de nó + forms de config por `type`
   (usar `InlineSelect` para status/prioridade/responsável/sala; carregar listas via hooks já
   existentes: `useStatuses`, `usePriorities`, `useProjectMembers`/`useAllMembers`, `useProjects`,
   `useTrackers` em `client/src/hooks/useRedmine.ts`; salas do Talk via a api de Talk existente).
7. Aba **"Automações"** em `client/src/App.tsx`:
   - Adicionar `'workflows'` à union `Tab`.
   - Adicionar entrada de nav `{ id:'workflows', label:'Automações', icon:<Workflow size={15}/> }`
     (ícone `Workflow` do lucide) no grupo "Ferramentas" (array `ids:[...]`).
   - Adicionar `<Route path="/workflows" element={<WorkflowsView onIssueClick={openIssue} />} />`.

**Verificação Fase 1:** `cd client && npx tsc --noEmit && npm run build`; `node --check` nos arquivos
server; subir `node server/index.js`, logar, montar um grafo (trigger → filter → ação), salvar,
recarregar a página e confirmar que persistiu; ativar/desativar.

### FASE 2 — Executar (engine no loop de polling)
Objetivo: detectar eventos, avaliar condições, disparar ações.

**Server**
1. `server/lib/variableResolver.js` — portar `resolveInput({{}})` do Twenty (§5).
2. `server/services/workflowState.js` — `dataFile('workflow-state.json')`, por uid:
   `{ issues:{[id]:{status_id,priority_id,assigned_to_id,journalCount}}, firedKeys:string[], lastScheduleRuns:{[nodeId]:number} }`.
   Helpers: `getState(uid)`, `saveState(uid, state)`. `firedKeys` = dedup (ex.:
   `"${wfId}:${nodeId}:${issueId}:${newStatusId}"`).
3. **Helpers de ação novos** (lacunas):
   - `sendTalkMessage(uid, token, text)` em `talkStore.js` (ou novo `talkSend.js`) — §4.3.
   - E-mail headless via `req`-shim do `rec` — §4.5.
   - **Exportar `sendPush`** de `push.js` — §4.1.
4. `server/services/workflowEngine.js`:
   - `async function tick(subscriptions, sendPush)`:
     - Agrupar `subscriptions` por `uid` (um `rec` por usuário basta para credenciais).
     - Para cada uid com ≥1 workflow **ativo**:
       - **Detecção de issues**: `collectPushState(rec...)` → objetos das issues; comparar campos com
         `workflowState.issues` → emitir eventos: `created` (id novo), `status_changed` (status_id
         mudou; inclui from/to), `assigned_changed`, `updated` (journalCount subiu). Atualizar snapshot.
       - **Detecção Talk**: reusar o padrão de `pollTalkGroup` (ou ler `rec.talkSeen`) → eventos
         `talk.message`/`talk.mention`.
       - **schedule**: para cada trigger `schedule`, checar horário vs `lastScheduleRuns[nodeId]` →
         emitir `schedule`.
     - Para cada evento, para cada workflow ativo cujo nó `trigger.type` casa o evento e o config bate
       (ex.: `to === statusId`): montar `context` = `{ issue, room, message, event, user, now }`;
       **caminhar o grafo** a partir do trigger (`nextIds`):
       - nó `filter` → avaliar `config` contra o contexto; se falhar, **parar o ramo**.
       - nó `action` → `execAction(node, context, rec)` resolvendo `{{}}` com o variableResolver.
       - seguir `nextIds`.
     - Dedup via `firedKeys` (não disparar 2x o mesmo evento/ação).
   - `execAction(node, ctx, rec)` — switch por `node.type`:
     - `notify` → `sendPush(rec, { title, body })`.
     - `k86.screen` → `keyboardNotify.notify({ type:'summary', title, subtitle })`.
     - `talk.send` → `sendTalkMessage(rec.uid, config.roomToken, resolved.message)`.
     - `issue.update` → PUT `/issues/{ctx.issue.id}.json` com os campos (via cliente do `rec`).
     - `issue.comment` → PUT `/issues/{ctx.issue.id}.json` `{ issue:{ notes: resolved.body } }`
       (usar `sanitizeIssueBody`).
     - `webhook` → `axios({ method, url, headers, data: body })`.
     - `email.send` → `zimbra.sendMessage(reqShim(rec), { to, subject, text })`.
   - Envolver cada ação em try/catch (uma ação falha não derruba o tick).
5. Hook no loop: em `push.js` `startPushPolling`, adicionar
   `setInterval(() => workflowEngine.tick(subscriptions, sendPush), 60*1000);` (ou reusar o tick do
   digest). Passar `sendPush` já que é interno.
6. `POST /workflows/:id/run` em `routes/workflows.js` — executa o grafo do workflow com um **contexto
   de exemplo** (issue/mensagem fake) para testar ações isoladamente, sem esperar evento real.

**Verificação Fase 2:** subir dev; criar workflows e testar:
- `schedule` (`everyMinutes:1`) → `k86.screen`/`notify`: ver disparar em ~1 min.
- `issue.status_changed` (to = Pendente Teste) + `filter` (project = X) → `issue.comment`/`talk.send`:
  mover uma tarefa no Redmine e ver a ação rodar.
- `talk.message` → `notify`: mandar mensagem numa sala e ver disparar.
- `POST /workflows/:id/run` para testar ações sem evento real.
- **Dedup:** deixar o tick rodar 2x e confirmar que a mesma ação não repete.
- **Variáveis:** ação `issue.comment` com body `"{{message.actor}} disse: {{message.text}}"` → conferir
  a substituição.

### FASE 3 — Polir (depois do v1 validado)
- Histórico de execução (run log) — persistir cada disparo e mostrar na UI.
- Nó `if-else` (ramificação com 2 saídas) — estende o graph walk.
- Ação `ai.generate` (usa `aiComplete` + `providerFor(uid)`) — texto p/ comentário/notificação.
- Mais operadores de condição; grupos de filtro aninhados; tratamento de erro por nó
  (continue-on-failure); botão "rodar agora" na UI.
- (Futuro maior) automações **compartilhadas do time** com identidade de serviço + polling team-wide.

---

## 7. Riscos / cuidados
- **Não bloquear o event loop**: o `tick` roda no processo do servidor; use `mapLimit` para
  concorrência controlada em chamadas ao Redmine/Talk (padrão já em `lib/pagination.js`).
- **Dedup é obrigatório**: sem `firedKeys`, um gatilho de status pode redisparar a cada poll enquanto
  a issue permanecer no estado. Marcar o evento como disparado assim que a ação roda.
- **Escrita no Redmine respeita workflow**: mudar status pode falhar por transição não permitida —
  logar e seguir (não derrubar o tick). Reusar `sanitizeIssueBody`.
- **`sendPush` é interno** no `push.js`: exportar com cuidado (ele já faz pruning de inscrição
  expirada — manter esse comportamento).
- **`K86_ENABLED` / e-mail podem estar ausentes**: ações `k86.screen`/`email.send` devem ser no-op
  graciosos quando a integração não está configurada.
- **Segredos**: `workflows.json` com `requireEncryption:true` (regras podem conter URLs de webhook,
  destinatários de e-mail, etc.).

## 8. Definition of Done (v1)
- Aba "Automações" com editor visual (React Flow) que cria/edita/ativa workflows e persiste por usuário.
- Os 4 gatilhos e as 7 ações funcionando, com condições (`filter`) e variáveis `{{}}`.
- Execução no loop de polling, com dedup, sem quebrar os demais workers.
- `npx tsc --noEmit` + `npm run build` no client passam; `node --check` nos arquivos server passa;
  fluxos de verificação das Fases 1 e 2 confirmados manualmente.
