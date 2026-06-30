# Bluemine

**Painel de produtividade que unifica, numa única interface, as ferramentas que o time já usa** — tarefas (Redmine), e-mail (Zimbra), arquivos e chat (Nextcloud Talk/Files), wiki corporativa (DokuWiki), videochamadas (Jitsi), 2FA (TOTP) e um assistente de IA opcional.

O Bluemine **não substitui nem reconfigura** nenhum desses sistemas — apenas consome as APIs existentes usando **as mesmas credenciais e permissões** que o usuário já possui.

> **Modelo de implantação atual:** aplicativo desktop (`.exe`), **uma instância por usuário**, executando localmente e escutando apenas em `127.0.0.1`. Não há servidor central nem banco compartilhado. Para uma eventual centralização, veja [docs/CENTRALIZACAO-SERVIDOR-UNICO.md](docs/CENTRALIZACAO-SERVIDOR-UNICO.md).

---

## Funcionalidades

- **Gestão de tarefas (Redmine):** quadro Kanban, sprints, lista/calendário de issues, busca global, comentários, lançamento de horas, campos customizados, filtros salvos, throughput/burndown.
- **E-mail (Zimbra):** leitura e envio via SOAP/HTTPS, anexos, imagens inline.
- **Arquivos e chat (Nextcloud):** navegação no Drive (WebDAV/OCS), upload/download, lixeira, compartilhamento; chat (Talk) com emoji, menções, threads de issue, presença, recibos.
- **Wiki corporativa (DokuWiki):** busca e leitura de páginas.
- **Reuniões (Jitsi):** videochamada em PiP no Kanban, com transcrição/resumo opcional por IA.
- **Cofre TOTP:** geração de códigos 2FA (sementes guardadas cifradas no servidor).
- **Assistente de IA (opcional):** resumos, rascunhos de nota/resposta, avaliação de complexidade, detecção de ambiguidades, standup/retrospectiva e chat agêntico. Suporta **Anthropic, OpenAI e Google Gemini**; chave fornecida pelo próprio usuário.
- **Notificações:** in-app, do navegador e **Web Push** (com a aba fechada), via polling no servidor.

---

## Arquitetura

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Cliente (React + Vite)      │        │  Sistemas corporativos        │
│  SPA renderizada localmente  │        │  Redmine · Zimbra · Nextcloud │
└──────────────┬──────────────┘        │  DokuWiki · Jitsi · (IA)      │
               │ HTTP loopback          └───────────────▲──────────────┘
               ▼ (/api)                                  │ HTTPS (creds do usuário)
┌─────────────────────────────────────────────────────┴──────────────┐
│  Servidor local (Node.js + Express)  —  empacotado no mesmo .exe      │
│  • Ponte autenticada com os sistemas de origem                       │
│  • Cofre de segredos cifrado em repouso (Windows DPAPI, CurrentUser) │
│  • Escuta só em 127.0.0.1                                            │
└─────────────────────────────────────────────────────────────────────┘
```

- **Cliente:** React 18 + TypeScript + Vite + Tailwind; React Query para dados; TipTap (editor), DOMPurify (sanitização), Jitsi SDK, dnd-kit, lucide-react.
- **Servidor:** Node.js + Express; `helmet`, `cors`, `cookie-parser`; `axios`, `fast-xml-parser`; `web-push`; SDKs `@anthropic-ai/sdk` e `openai`.
- **Empacotamento:** o frontend compilado é embutido no executável do backend via `pkg` (alvo `node18-win-x64`), gerando um único `bluemine.exe`.
- **Segredos:** senhas, tokens, chaves de IA e sementes TOTP ficam **somente no servidor**, cifrados com DPAPI; o cliente recebe apenas indicadores de status e códigos derivados. Detalhes em [docs/RELATORIO-SEGURANCA.md](docs/RELATORIO-SEGURANCA.md).

---

## Estrutura do projeto

```
.
├── server/                 # Backend Node/Express
│   ├── index.js            # Entry point (sobe app + worker de push)
│   ├── app.js              # Monta Express: middlewares, rotas, SPA
│   ├── routes/             # Rotas /api (auth, issues, ai, talk, mail, drive, wiki, ...)
│   ├── services/           # Lógica e stores por-usuário (ai, push, talk, *Store)
│   ├── lib/                # secureStore (DPAPI), session, ssrfGuard, redmine, totp...
│   ├── middleware/         # auth, rateLimit
│   ├── zimbra.js           # Integração Zimbra (SOAP)
│   └── dokuwiki.js         # Integração DokuWiki (scraping HTTPS)
├── client/                 # Frontend React + Vite
│   └── src/
│       ├── api/            # Clientes HTTP (redmine, talk, mail, drive, ...)
│       ├── components/     # UI (KanbanBoard, IssueModal, TalkChat, MailView, ...)
│       ├── hooks/          # React Query hooks e lógica de UI
│       └── utils/          # Helpers (markdown↔textile, configs, etc.)
├── scripts/                # Build de ícone e utilitários; scripts/dev/ (diagnóstico)
├── docs/                   # Documentação (segurança, centralização)
├── build_exe.ps1           # Gera o bluemine.exe
├── start.ps1               # Sobe server + client em dev e abre o navegador
├── docker-compose.yml      # Ambiente de dev em container
└── package.json            # Scripts e deps do servidor
```

---

## Pré-requisitos

- **Node.js 20 LTS** (o pipeline roda em Node 20; o `.exe` é empacotado com base node18).
- **Windows** para o uso pleno do cofre DPAPI. Em outros SOs, o boot funciona, mas a cifragem em repouso cai para um modo que **recusa** gravar segredos sem `ALLOW_PLAINTEXT_SECRETS=1` (ver variáveis abaixo).
- Acesso aos sistemas corporativos (Redmine, e — conforme uso — Zimbra/Nextcloud/DokuWiki/Jitsi).

---

## Como rodar (desenvolvimento)

Instale as dependências (raiz e cliente):

```bash
npm install
npm install --prefix client
```

### Opção A — script único (Windows)

```powershell
./start.ps1
```
Sobe o backend (`:3001`) e o frontend Vite (`:5173`) e abre o navegador.

### Opção B — npm

```bash
npm run dev
```
Usa `concurrently` para rodar `npm run server` (backend) e `npm run client` (Vite) juntos.

Ou separadamente:
```bash
npm run server                 # backend em :3001
npm run dev --prefix client    # frontend em :5173
```

### Opção C — Docker (dev)

```bash
docker compose up
```
Expõe `:3001` (backend) e `:5173` (frontend) com hot-reload. Ver [docker-compose.yml](docker-compose.yml) e [Dockerfile.dev](Dockerfile.dev).

No modo dev, acesse **http://localhost:5173**. Em produção (exe), tudo é servido pelo backend em **http://127.0.0.1:3001**.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta do servidor. |
| `HOST` | `127.0.0.1` | Interface de escuta. Use `0.0.0.0` apenas num cenário de servidor central (ver doc de centralização). |
| `ALLOWED_HOSTS` | — | Hosts extras aceitos no cabeçalho `Host` (anti DNS-rebinding). O loopback já é liberado por padrão. |
| `COOKIE_SECURE` | `0` | `1` para marcar o cookie de sessão como `secure` (HTTPS). |
| `CSP_ENFORCE` | `0` | `1` ativa a CSP em modo de bloqueio (hoje em report-only). |
| `DOKUWIKI_HOST` | `wiki.redesoft.com.br` | Host do DokuWiki corporativo (host fixo, não controlável pelo cliente). |
| `ALLOW_PLAINTEXT_SECRETS` | — | `1` permite gravar segredos em texto puro quando o DPAPI está indisponível (apenas dev fora do Windows; assume o risco conscientemente). |

> O host de e-mail (Zimbra) tem padrão `email.redesoft.org` e é configurável na própria interface.

---

## Build do executável

No Windows, com as dependências instaladas:

```powershell
./build_exe.ps1
```

O script: gera os ícones, compila o frontend (`client`), copia o `dist` para `server/dist`, e empacota tudo num único **`bluemine.exe`** na raiz (via `pkg`, alvo `node18-win-x64`), gravando o ícone no binário. Basta distribuir o `.exe` — ele embute frontend + backend.

---

## Scripts úteis

**Raiz (servidor):**
```bash
npm run dev       # server + client juntos (concurrently)
npm run server    # só o backend
npm run client    # só o frontend (Vite)
npm run lint      # ESLint
npm run format    # Prettier
```

**Cliente (`client/`):**
```bash
npm run build     # tsc + vite build
npm run preview   # serve o build localmente
npm run lint      # ESLint do front
```

---

## Segurança

A postura de segurança e os controles implementados estão descritos em **[docs/RELATORIO-SEGURANCA.md](docs/RELATORIO-SEGURANCA.md)** (cofre DPAPI, sanitização XSS com DOMPurify, anti-SSRF, validação de Host anti-rebinding, rate-limiting, anti prompt-injection da IA, etc.).

Destaques do modelo local:
- Segredos cifrados em repouso (DPAPI, escopo CurrentUser) e **nunca devolvidos ao cliente**.
- Servidor escuta só no loopback; cabeçalho `Host` validado contra DNS-rebinding.
- Conteúdo de terceiros (tarefas, e-mails, wiki) é tratado como dado não confiável e sanitizado antes da exibição.

Para mover isto a um **servidor central multiusuário**, há mudanças estruturais de dev e infra documentadas em **[docs/CENTRALIZACAO-SERVIDOR-UNICO.md](docs/CENTRALIZACAO-SERVIDOR-UNICO.md)**.

---

## Documentação

- [docs/RELATORIO-SEGURANCA.md](docs/RELATORIO-SEGURANCA.md) — relatório de segurança e controles.
- [docs/CENTRALIZACAO-SERVIDOR-UNICO.md](docs/CENTRALIZACAO-SERVIDOR-UNICO.md) — guia de centralização (dev + infra).
- [scripts/dev/README.md](scripts/dev/README.md) — scripts de diagnóstico contra a API do Redmine.

---

## Qualidade de código

- **ESLint + Prettier** (raiz e cliente).
- Pipeline com **CodeQL** (SAST), **Gitleaks** (varredura de segredos), `npm audit` e **Dependabot** (ver `.github/workflows/`).

---

## Licença

Software interno. Distribuição por canal controlado de TI.
