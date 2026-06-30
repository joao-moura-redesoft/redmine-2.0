# Bluemine — Guia de Centralização para Servidor Único Multiusuário

**Documento técnico de planejamento**

| | |
|---|---|
| **Objetivo** | Avaliar e detalhar o que é preciso para migrar o Bluemine do modelo atual (executável local por usuário) para um **servidor central único** acessado por todos os usuários |
| **Público** | Desenvolvimento e Infraestrutura/SRE |
| **Status** | Planejamento — nenhuma das mudanças abaixo está implementada |
| **Relacionado** | [RELATORIO-SEGURANCA.md](RELATORIO-SEGURANCA.md) (seção 10.1 — checklist de hardening para centralização) |

> **Resumo executivo:** centralizar o Bluemine **não é uma mudança de configuração — é uma re-arquitetura**. O modelo atual extrai sua segurança da própria topologia (1 exe por usuário, loopback, segredos cifrados com DPAPI atada à conta Windows). Ao consolidar tudo num servidor, **todas essas premissas caem simultaneamente** e o sistema passa a depender de controles que hoje são inertes. Há **dois bloqueadores estruturais** — substituir o cofre DPAPI e abandonar o armazenamento em arquivos JSON — além de uma **revisão de segurança obrigatória** porque o modelo de ameaça se inverte.

---

## 1. A inversão do modelo de ameaça

Hoje o relatório de segurança (seção 3.2) afirma, com razão, que "o risco é estruturalmente baixo". Essa afirmação **depende inteiramente** da topologia local. No servidor central, a tabela abaixo mostra o que muda:

| Premissa do modelo atual | No servidor central |
|---|---|
| Sem servidor central → sem ponto único de comprometimento | **Torna-se o ponto único**: comprometer 1 host = comprometer todos os usuários |
| Segredos não ficam concentrados num só lugar | O servidor passa a **guardar a senha/token do Redmine + credenciais AD de todos** |
| O "atacante" é o próprio usuário, na própria máquina | Um usuário autenticado pode atacar **a infraestrutura interna e os dados dos demais usuários** |
| DPAPI (escopo CurrentUser) cifra os segredos | DPAPI **não existe** num serviço Linux/sem sessão interativa — precisa ser substituída |
| Tráfego em loopback, nada exposto | Superfície de rede real: TLS, WAF, DDoS, egress controlado |
| Rate-limit/força-bruta são marginais | Passam a ser **defesas de fronteira de verdade** |

**Consequência prática:** a base de dados centralizada vira um alvo de alto valor (credenciais + conteúdo corporativo de todos). Isso exige, no mínimo, **pentest externo antes de produção** e revisão de conformidade (LGPD).

---

## 2. Mudanças de Desenvolvimento (código)

Prioridades: **P0** = bloqueador (não sobe sem); **P1** = controle que hoje é inerte e passa a ser obrigatório; **P2** = operação/maturidade.

### 2.1. 🔴 P0 — Bloqueadores estruturais

#### 2.1.1. Substituir o cofre DPAPI por criptografia de servidor
- **Hoje:** [server/lib/secureStore.js](../server/lib/secureStore.js) cifra com `System.Security.Cryptography.ProtectedData` (DPAPI, escopo `CurrentUser`) via PowerShell. Fora do Windows / sem sessão interativa, isso **não funciona** — o código cai para `ALLOW_PLAINTEXT_SECRETS=1`, ou seja, **segredos em texto puro no disco**.
- **O que fazer:**
  - Introduzir uma camada de cifragem independente de SO: **envelope encryption** com uma **chave-mestra (DEK/KEK)** guardada em **KMS/secret manager** (HashiCorp Vault, AWS KMS, Azure Key Vault) — nunca no código nem na imagem.
  - **Preferencialmente cifrar por usuário** (chave derivada por `redmineUserId`), para que o vazamento do armazenamento não exponha todos os segredos de uma vez.
  - Abstrair a interface de `secureStore` (`readJsonSecure`/`writeJsonSecure`) para suportar back-ends plugáveis: `dpapi` (local) e `kms`/`envelope` (servidor).
- **Impacto:** alto. É o coração da postura de segurança.

#### 2.1.2. Migrar os arquivos JSON para um banco de dados
- **Hoje:** todos os stores são **um objeto em memória + reescrita do arquivo inteiro** a cada operação, sem lock nem transação:
  - [server/services/secretsStore.js](../server/services/secretsStore.js) (`save()` reescreve `secrets.json` inteiro)
  - [server/services/notesStore.js](../server/services/notesStore.js)
  - `boardsStore.js`, `sprintsStore.js`, `talkStore.js`
  - [server/lib/session.js](../server/lib/session.js) (`sessionsMap` + `sessions.json`)
- **Problema:** com vários usuários simultâneos há **lost updates** (duas requisições leem→modificam→reescrevem o arquivo todo) e risco de **corrupção**; com mais de 1 processo/réplica, a corrupção é praticamente garantida.
- **O que fazer:**
  - Adotar **PostgreSQL** (gerenciado) com transações e índices por `user_id`.
  - Migrar os 6 stores. **Vantagem:** os dados **já são chaveados por `redmineUserId`** (`{ [userId]: ... }`), então o modelo lógico multiusuário já existe — falta a camada de persistência transacional.
  - Tratar concorrência (transações/optimistic locking) nas escritas de notas, boards e sprints.
- **Impacto:** alto.

#### 2.1.3. Sessões em store externo + política de expiração
- **Hoje:** [server/lib/session.js](../server/lib/session.js) mantém sessões num `Map` em memória persistido em arquivo; o cookie de API key dura **10 anos** ([server/routes/auth.js:42](../server/routes/auth.js#L42)).
- **O que fazer:**
  - Mover sessões para **Redis** (ou DB), permitindo escala horizontal.
  - **Rotacionar o id de sessão no login**; aplicar **expiração idle + absoluta** razoáveis.
  - Ligar `cookie secure` (`COOKIE_SECURE=1`) — já previsto na config ([auth.js:48](../server/routes/auth.js#L48)).

#### 2.1.4. Repensar o armazenamento da credencial do usuário
- **Hoje:** no login usuário/senha, o servidor **guarda a senha** (Redmine/AD) para reusar nas integrações (Zimbra/DokuWiki via Basic). Centralizar = manter as senhas de todos.
- **O que fazer:**
  - Preferir **tokens de API/OAuth** revogáveis em vez de senha reutilizável.
  - Idealmente, colocar **SSO/OIDC** na frente, de modo que o servidor **nunca veja a senha** do usuário.

### 2.2. 🟠 P1 — Controles hoje inertes que passam a ser obrigatórios

#### 2.2.1. Autorização / IDOR (maior superfície nova de risco)
- Com **um processo servindo vários usuários reais**, todo acesso chaveado por `uid` precisa **validar a posse** do recurso. Hoje confia-se em `getMyUserId(req)` ([server/lib/redmine.js](../server/lib/redmine.js)).
- **O que fazer:** auditar cada rota que recebe id/caminho (notas, boards, sprints, secrets, anexos do Redmine/Zimbra, Drive) e garantir que **um usuário não acesse recurso de outro**. Adicionar testes de autorização.

#### 2.2.2. SSRF / egress — de defesa-em-profundidade a controle crítico
- O argumento atual "é o próprio usuário atacando a própria máquina" **deixa de valer**: um usuário pode mirar a infra interna.
- **O que fazer:** revisar **todo** fetch server-side que toca host/URL derivada de input — `safeAgents` (preview de link, login do Talk em [server/routes/talk.js](../server/routes/talk.js)) e o host fixo do DokuWiki ([server/dokuwiki.js](../server/dokuwiki.js)) passam a ser **críticos**. Garantir bloqueio de faixas internas inclusive na resolução de DNS e em redirects.

#### 2.2.3. CSRF com token dedicado
- Hoje a defesa é `SameSite=Lax` + CORS de loopback + validação de Host + ausência de escrita via GET (ver [RELATORIO-SEGURANCA.md](RELATORIO-SEGURANCA.md) seção 5.1).
- **O que fazer:** exposto na rede, **adicionar token anti-CSRF** (double-submit ou sincronizador) nas rotas de escrita.

#### 2.2.4. Rate-limit compartilhado, por-usuário e `trust proxy`
- [server/middleware/rateLimit.js](../server/middleware/rateLimit.js) é **por-IP em memória**. Atrás de proxy, todos os IPs colapsam no IP do proxy.
- **O que fazer:** store **compartilhado (Redis)**; `app.set('trust proxy', …)`; limites **por-usuário** além de por-IP; **teto de custo de IA por usuário** (chamadas a Anthropic/OpenAI custam dinheiro — ver [server/routes/ai.js](../server/routes/ai.js)); revisar limites de upload (Drive aceita **500 MB** em [server/routes/drive.js](../server/routes/drive.js), áudio Whisper **80 MB** em [server/routes/ai.js](../server/routes/ai.js)).

#### 2.2.5. Worker de background único
- O polling de Web Push roda dentro do `index.js` e itera **todas** as inscrições num loop global, mantendo credenciais em claro no array em memória ([server/services/push.js](../server/services/push.js), `pollPush`).
- **O que fazer:** extrair para **um worker dedicado (1 réplica)** separado das instâncias web; senão, N réplicas web = notificações duplicadas e N loops concorrentes.

#### 2.2.6. Cabeçalhos e CORS para ambiente exposto
- **CSP em modo `enforce`** (`CSP_ENFORCE=1`) após validar Jitsi/Wiki/Drive — hoje em report-only ([server/app.js](../server/app.js)).
- **CORS por configuração** (não a allowlist fixa de localhost — [server/app.js:53](../server/app.js#L53)).
- **`ALLOWED_HOSTS`** apontando para o domínio real (a validação de Host anti-rebinding já existe e suporta isso — [server/app.js](../server/app.js)).
- **HSTS** ligado quando em HTTPS.

### 2.3. 🟡 P2 — Operação e maturidade
- **Logs/auditoria** sem segredos; trilha de auditoria de ações sensíveis (lançar horas, alterar dados, acessar segredos).
- **Health/readiness endpoints**, *graceful shutdown*, timeouts de request.
- **Configuração 100% por env/secret manager** — nada de `vapid.json`, `teams.json`, `push-subscriptions.json` no disco da imagem.
- **Métricas e tracing** por usuário/rota para diagnóstico e detecção de abuso.

---

## 3. Infraestrutura

| Camada | Necessidade |
|---|---|
| **TLS / borda** | Certificado real + **reverse proxy** (nginx/Caddy/ALB), HSTS, `trust proxy`. Hoje o servidor é HTTP puro em loopback. |
| **Gestão de segredos** | **KMS/Vault** para a chave-mestra de cifragem, chaves VAPID e (idealmente) os segredos por-usuário. |
| **Banco de dados** | **PostgreSQL gerenciado** (RDS/Azure DB/Cloud SQL) com backups e *point-in-time recovery*. |
| **Cache / sessão** | **Redis** para sessões, rate-limit distribuído e cache de `getMyUserId`. |
| **Execução** | Container (Docker) + orquestração (K8s/ECS): **web escalável horizontalmente** + **1 worker de push**, *health checks*, autoscaling. |
| **Rede** | Ingress restrito (**WAF**, proteção DDoS); **egress controlado** para Redmine/Zimbra/Nextcloud/DokuWiki/provedores de IA; **segmentação** para a API não alcançar endpoints de metadados internos (reforça o anti-SSRF). |
| **Observabilidade** | Logs centralizados (sem segredos), métricas, alertas; idealmente **SIEM** para a base que agora concentra dados sensíveis. |
| **Identidade** | **SSO/OIDC** na frente é o ideal — remove a senha do caminho. |
| **HA / DR** | Múltiplas réplicas, backups testados, plano de recuperação de desastre. |
| **Compliance / LGPD** | Dados de todos concentrados → alvo de alto valor: **pentest externo obrigatório**, política de retenção, **DPA** com provedores de IA, controle de acesso de operadores, residência de dados. |

---

## 4. Migração de dados

Os artefatos locais por-máquina **não migram diretamente** — são blobs DPAPI atados à conta Windows de cada usuário e, na prática, **inúteis em outro host**:

- `secrets.json`, `sessions.json`, `talk.json` — cifrados com DPAPI; **não decifráveis** no servidor. Os usuários **reconfiguram** segredos (AD, chaves de IA, TOTP) e refazem login.
- `notes.json`, `boards.json`, `sprints.json` — dados pessoais por-usuário; se houver desejo de preservar, exigem um **utilitário de exportação rodado na máquina do usuário** (onde o DPAPI ainda decifra) → importação no Postgres central. Caso contrário, começam vazios.
- `vapid.json`, `push-subscriptions.json` — recriados no servidor; inscrições de push são refeitas pelos navegadores.

**Recomendação:** tratar a centralização como **novo começo de dados** (com reconfiguração pelos usuários), a menos que haja requisito explícito de preservar notas/boards/sprints — nesse caso, planejar o exportador local antes.

---

## 5. Roadmap sugerido (fases)

**Fase 0 — Fundação de dados e segredos (P0)**
1. Abstrair `secureStore` e implementar back-end de **envelope encryption + KMS**.
2. Modelar e migrar os stores para **PostgreSQL** (transações, índices por usuário).
3. **Sessões em Redis** com rotação e expiração.

**Fase 1 — Segurança de fronteira (P0/P1)**
4. Repensar credencial do usuário (**tokens/OIDC**, evitar guardar senha).
5. **Autorização/IDOR**: auditoria + testes em todas as rotas por-usuário.
6. **CSRF token**, `trust proxy`, **rate-limit em Redis** por-usuário + teto de custo de IA.
7. Reavaliar **SSRF/egress** como crítico.

**Fase 2 — Operação (P1/P2)**
8. **Worker de push** dedicado (1 réplica).
9. **CSP enforce**, CORS por config, `ALLOWED_HOSTS`, HSTS.
10. Observabilidade, auditoria, health checks, config por secret manager.

**Fase 3 — Infra e liberação**
11. TLS/WAF, Postgres+Redis gerenciados, container/orquestração, HA/DR.
12. **Pentest externo** + revisão LGPD → liberação.

---

## 6. Checklist consolidado

**Bloqueadores (P0)**
- [ ] Cofre de segredos independente de SO (KMS/envelope), idealmente por-usuário
- [ ] Persistência transacional (PostgreSQL) substituindo os arquivos JSON
- [ ] Sessões em Redis + rotação + expiração idle/absoluta + `cookie secure`
- [ ] Modelo de credencial do usuário revisto (tokens/OIDC; evitar senha reutilizável)

**Controles obrigatórios na rede (P1)**
- [ ] Auditoria de autorização/IDOR em todas as rotas por-usuário
- [ ] SSRF/egress revisado como controle crítico (não defesa-em-profundidade)
- [ ] Token anti-CSRF nas rotas de escrita
- [ ] Rate-limit compartilhado, por-usuário, `trust proxy`, teto de custo de IA
- [ ] Worker de push único e separado das instâncias web
- [ ] CSP `enforce`, CORS por config, `ALLOWED_HOSTS`, HSTS

**Operação (P2)**
- [ ] Logs/auditoria sem segredos; trilha de ações sensíveis
- [ ] Health/readiness, graceful shutdown, timeouts
- [ ] Configuração via env/secret manager (sem arquivos de segredo na imagem)

**Infra**
- [ ] TLS + reverse proxy + WAF/DDoS
- [ ] KMS/Vault, PostgreSQL gerenciado, Redis
- [ ] Container/orquestração, HA, backups testados, DR
- [ ] Observabilidade/SIEM
- [ ] SSO/OIDC (recomendado)
- [ ] Pentest externo + revisão LGPD antes de produção

---

## 7. Veredito

Centralizar é **um projeto, não um ajuste de configuração**. O caminho crítico é dominado por dois itens estruturais — **substituir o DPAPI** e **sair dos arquivos JSON** — somados à **inversão do modelo de ameaça**, que torna obrigatórios controles hoje inertes (autorização/IDOR, SSRF, CSRF, rate-limit distribuído) e exige **revisão de segurança independente** antes da liberação. A boa notícia: os dados já são modelados por usuário e parte do hardening de fronteira já foi iniciada (validação de Host anti-rebinding, host fixo do DokuWiki, escopamento de rate-limit), o que reduz o caminho. Ainda assim, é um esforço significativo de dev + infra, e **não deve ser tratado como uma simples flag de implantação**.

---

*Documento de planejamento elaborado pela equipe de desenvolvimento do Bluemine. Complementa o [RELATORIO-SEGURANCA.md](RELATORIO-SEGURANCA.md) (seção 10.1).*
