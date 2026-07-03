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
| `SSRF_WHITELIST` | — | Lista separada por vírgulas de domínios/IPs internos permitidos na proteção SSRF (ex: `drive.b2click.com,192.168.0.10`). |
| `ALLOW_LOCAL_SSRF` | — | `1` desabilita completamente a proteção SSRF contra IPs locais/privados (use com cautela). |
| `BLUEMINE_NO_WINDOW` | — | `1` impede o app de abrir a janela automaticamente ao iniciar (você abre o endereço no navegador na mão). |
| `LOG_LEVEL` | `info` | Nível mínimo do log estruturado (`debug`\|`info`\|`warn`\|`error`). Segredos são sempre redigidos. |
| `LOG_FILE` / `LOG_TO_FILE` | `bluemine.log` / `1` | Arquivo de log (alimenta o export de diagnóstico) e liga/desliga (`0`) a gravação em disco. |
| `UPDATE_GITHUB_REPO` | — | `owner/repo` para usar **GitHub Releases** como canal de auto-update (a Action de release publica o `.exe` + `SHA256SUMS`). Vazio = recurso inerte. |
| `UPDATE_GITHUB_TOKEN` | — | PAT read-only escopado ao repo, **necessário se o repositório for privado** (baixa o release e o asset autenticado). Público: deixe vazio. |
| `UPDATE_GITHUB_ASSET` | auto | Nome do asset `.exe` no release (por padrão detecta o primeiro `*.exe`). |
| `UPDATE_MANIFEST_URL` | — | Alternativa ao GitHub para ambiente **restrito/air-gapped**: URL interna de um manifesto JSON `{version,url,sha256,notes}`. Se `UPDATE_GITHUB_REPO` estiver setado, tem precedência sobre este. |
| `AI_LOCAL_BASE_URL` | `http://127.0.0.1:11434/v1` | Endpoint OpenAI-compatible do provider de IA **local** (Ollama/vLLM/LM Studio). |
| `AI_MODEL_LOCAL` | `llama3.1` | Modelo usado pelo provider de IA local. Os demais modelos/campos custom do Redmine também são configuráveis por env (ver [server/lib/config.js](server/lib/config.js)). |

> Ao iniciar o `bluemine.exe`, o app abre sozinho numa janela dedicada (Edge em *app mode*, sem barra de endereço; se não houver Edge, cai no navegador padrão). Se o exe já estiver rodando, um novo duplo-clique apenas traz a janela de volta em vez de subir outra instância.

> O host de e-mail (Zimbra) tem padrão `email.redesoft.org` e é configurável na própria interface.

**Uso com o executável:** Para configurar essas variáveis ao rodar a versão compilada, crie um arquivo chamado exatamente `.env` na mesma pasta onde está o `bluemine.exe`. O aplicativo irá ler as configurações automaticamente ao iniciar (use o arquivo `.env.example` como base).

---

## Build do executável

No Windows, com as dependências instaladas:

```powershell
./build_exe.ps1
```

O script: gera os ícones, compila o frontend (`client`), copia o `dist` para `server/dist`, e empacota tudo num único **`bluemine.exe`** na raiz (via `pkg`, alvo `node18-win-x64`), gravando o ícone no binário. Basta distribuir o `.exe` — ele embute frontend + backend.

### Build via Node SEA (recomendado — sem Node 18)

O `pkg` prende o binário ao **Node 18 (EOL)**. O pipeline alternativo usa **Node SEA** (Single Executable Applications) com o binário do **Node LTS instalado na máquina de build (≥ 20)**:

```powershell
./build_exe_sea.ps1
```

O script compila o frontend, **embute a SPA no bundle** (`scripts/embed-dist.cjs`), faz o *bundle* do servidor num único `.cjs` (`esbuild`), gera o blob SEA, copia o binário do Node, injeta o blob (`postject`) e grava o ícone — produzindo um `bluemine.exe` **realmente single-file** (frontend + backend embutidos). Assine o binário (`signtool`) antes de distribuir. O `build_exe.ps1` (pkg) segue disponível como fallback.

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
