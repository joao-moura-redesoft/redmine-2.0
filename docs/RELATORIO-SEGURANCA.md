# Relatório de Segurança — Bluemine

**Documento para avaliação e aprovação de uso corporativo**

| | |
|---|---|
| **Sistema** | Bluemine — painel de produtividade integrado ao Redmine |
| **Versão do relatório** | 1.2 |
| **Data** | 30/06/2026 |
| **Classificação** | Interno |
| **Modelo de implantação** | Aplicativo desktop (.exe), 1 instância por usuário, execução local |

> **Revisão 1.1** — incorpora uma segunda passada de revisão de segurança sobre todo o código (incluindo integrações Talk/DokuWiki/Zimbra) e as correções de hardening aplicadas em sequência: cofre que recusa gravar segredos em texto puro, resistência a prompt-injection na IA, guarda anti-SSRF no login do Talk, escopamento correto do rate-limit e higiene de versionamento. Detalhes na seção 10.
>
> **Revisão 1.2** — terceira passada de revisão (varredura 100% do código) e incorporação de uma revisão crítica externa do relatório. Eliminou a credencial em variável global do proxy de mídia do DokuWiki (resolução agora por-usuário), fechou o vetor de SSRF do DokuWiki fixando o host no wiki corporativo e adicionou **validação de cabeçalho Host (anti DNS-rebinding)**. Corrige a afirmação sobre auditoria de dependências e a imprecisão de que "as credenciais nunca saem da máquina", esclarece a defesa de CSRF, a finalidade do rate-limit, a meta de ativação da CSP em modo `enforce` e a natureza de autoavaliação do documento. Detalhes na seção 10.2.

---

## 1. Sumário executivo

O Bluemine é um aplicativo de produtividade que centraliza, em uma única interface, o acesso às ferramentas que a equipe já utiliza: gestão de tarefas (Redmine), e-mail (Zimbra), arquivos e chat (Nextcloud), wiki corporativa (DokuWiki), videochamadas (Jitsi) e autenticação em duas etapas (TOTP). Ele **não substitui nem reconfigura** nenhum desses sistemas — apenas consome as APIs existentes usando as **mesmas credenciais e permissões** que o usuário já possui.

Do ponto de vista de segurança, o ponto mais relevante é o **modelo de implantação**: cada usuário roda a própria cópia do programa **localmente, na própria máquina**, e o componente de servidor escuta **exclusivamente no endereço local (`127.0.0.1`)**. **Não há servidor central, não há banco de dados compartilhado e nenhuma porta é exposta à rede.** Isso elimina, por construção, as classes de risco mais críticas em aplicações web (exposição de superfície de ataque na rede, vazamento entre usuários, comprometimento centralizado).

As credenciais e segredos do usuário **não são armazenados fora da máquina nem enviados a terceiros**: ficam **cifrados em repouso** localmente com a tecnologia nativa do Windows (DPAPI), vinculada à conta Windows do próprio usuário. Em uso, eles trafegam **apenas para os serviços de destino legítimos** (Redmine, Zimbra, Nextcloud, DokuWiki), sobre canais cifrados (HTTPS) — como em qualquer cliente desses sistemas. A única exceção é o recurso opcional de IA (seção 4.3).

**Recomendação:** o sistema está adequado para uso corporativo no modelo descrito. Há um único ponto que exige **decisão/política da empresa**: o uso opcional de provedores de Inteligência Artificial externos (seção 4.3). As demais pendências são de baixo risco e estão documentadas com plano de tratamento (seção 7).

---

## 2. Descrição do sistema e finalidade

O Bluemine é uma camada de produtividade ("front-end unificado") sobre sistemas corporativos já homologados. Suas funções:

- **Gestão de tarefas**: quadro Kanban, sprints, busca, comentários e lançamento de horas no **Redmine**.
- **E-mail e calendário**: leitura e envio via **Zimbra** (protocolo SOAP/HTTPS).
- **Arquivos e mensagens**: navegação no Drive e chat via **Nextcloud (Talk/Files)**.
- **Documentação**: leitura da **wiki corporativa (DokuWiki)**.
- **Reuniões**: videochamadas via **Jitsi**, com transcrição/resumo opcional por IA.
- **Assistente de IA** (opcional): resumos, rascunhos e consultas, usando chave configurada pelo próprio usuário.
- **Cofre TOTP**: geração de códigos de autenticação em duas etapas.

Em todos os casos, o Bluemine atua **com a identidade e as permissões do próprio usuário** — ele não possui privilégios elevados nem credenciais de serviço próprias nos sistemas de origem.

---

## 3. Arquitetura e modelo de ameaça

### 3.1. Componentes

- **Cliente** (interface): aplicação web (React) renderizada localmente.
- **Servidor local** (Node.js/Express): empacotado dentro do mesmo executável; faz a ponte autenticada com os sistemas corporativos.

### 3.2. Por que o risco é estruturalmente baixo

| Característica | Implicação de segurança |
|---|---|
| Servidor escuta só em `127.0.0.1` | Nenhuma exposição na rede corporativa ou internet; inacessível de outras máquinas |
| 1 instância por usuário, sem servidor central | Não há ponto único de comprometimento nem acesso cruzado entre usuários |
| Sem banco de dados compartilhado | Dados de cada usuário ficam apenas na máquina dele |
| Usa as credenciais/permissões do próprio usuário | O app não pode acessar nada além do que o usuário já acessa |

### 3.3. Fronteiras de confiança

O Bluemine confia nos sistemas corporativos de origem (Redmine, Zimbra, Nextcloud, DokuWiki) e os acessa por seus canais oficiais (HTTPS/SOAP/API REST). Conteúdo recebido desses sistemas (descrições de tarefas, e-mails, páginas de wiki) é tratado como **dado não confiável** e passa por sanitização antes de ser exibido (seção 5.2).

---

## 4. Tratamento de dados e privacidade

### 4.1. Credenciais e segredos

- Credenciais (usuário/senha ou token do Redmine, credenciais AD para wiki/e-mail, sementes TOTP, chaves de IA) são guardadas em um **cofre no lado servidor, cifrado em repouso** via **Windows DPAPI (escopo CurrentUser)** — só a conta Windows logada, naquela máquina, consegue decifrar.
- O cliente **nunca recebe os segredos de volta** — apenas indicadores de status ("configurado/não configurado") e códigos derivados.
- **Garantia reforçada**: o cofre foi configurado para **nunca gravar segredos em texto puro**. Se a criptografia nativa estiver indisponível, a operação é **recusada** em vez de degradar a proteção.

### 4.2. Dados em trânsito

- A comunicação com os sistemas corporativos usa os protocolos seguros dos próprios sistemas (HTTPS para Zimbra/Nextcloud/Redmine conforme configuração do ambiente).
- O tráfego entre interface e servidor local ocorre **dentro da própria máquina** (loopback), não trafegando pela rede.

### 4.3. ⚠️ Provedores de IA externos (requer decisão da empresa)

O recurso de IA é **opcional e desativado por padrão** — só funciona se o usuário configurar manualmente uma chave de API de um provedor (**Anthropic, OpenAI ou Google Gemini**). Quando ativado:

- Conteúdo de tarefas, comentários, e — no caso de transcrição de reuniões — **áudio de reuniões** é enviado ao provedor de IA escolhido para processamento.
- A chave de API é fornecida e custeada pelo usuário/empresa e fica no cofre cifrado local.

**Ponto de governança:** o envio de conteúdo corporativo a um serviço de IA de terceiros deve estar alinhado à **política de dados e privacidade (LGPD)** da empresa. Recomenda-se que a empresa defina explicitamente: (a) se o uso de IA é permitido; (b) quais provedores são autorizados; (c) se há restrição quanto ao tipo de dado (ex.: proibir transcrição de reuniões com dados sensíveis). O recurso pode permanecer **totalmente desligado** sem afetar as demais funções do app.

### 4.4. Telemetria

O aplicativo **não envia telemetria** nem dados de uso para o desenvolvedor ou terceiros. As únicas conexões de saída são para os sistemas corporativos configurados e, se habilitado, para o provedor de IA escolhido.

---

## 5. Controles de segurança implementados

### 5.1. Autenticação e sessão

- Sessão baseada em **cookie `HttpOnly`** (inacessível a scripts) com política **`SameSite=Lax`**.
- **CSRF**: a defesa combina `SameSite=Lax` (o navegador não envia o cookie de sessão em POST/PUT/DELETE cross-site), **CORS restrito** a origens de loopback, **ausência de endpoints que alterem estado via GET** e a **validação de Host** descrita em 5.2. Tokens anti-CSRF dedicados não são usados hoje por serem redundantes neste modelo, mas ficam recomendados como pré-requisito caso o app passe a ser exposto fora do loopback (seção 10.1).
- **Proteção contra força bruta** no login (limite de tentativas por janela de tempo).
- Logout encerra e remove a sessão no servidor.
- Suporte a `cookie secure` (HTTPS) já preparado via configuração, para um eventual cenário de servidor central.

### 5.2. Proteção contra ataques web (OWASP)

| Risco | Controle |
|---|---|
| **XSS (Cross-Site Scripting)** | Todo conteúdo HTML de terceiros (Markdown de tarefas, wiki, assistente) é **sanitizado com DOMPurify** antes da exibição |
| **SSRF (Server-Side Request Forgery)** | Os pontos que buscam URLs informadas pelo usuário (pré-visualização de links e o fluxo de login do Nextcloud Talk) validam o esquema (`http(s)`) e bloqueiam acesso a **endereços internos/privados** (incl. faixas de metadados de nuvem), inclusive em redirecionamentos. As integrações de host fixo (DokuWiki) não aceitam o host vindo do cliente — o destino é sempre o servidor corporativo configurado, e os fetches não seguem redirecionamentos |
| **Path Traversal** | Caminhos de arquivos (Drive) descartam sequências `..` antes do uso |
| **Injeção (XML/SOAP)** | A integração de e-mail usa serialização estruturada (JSON-SOAP), sem concatenação de strings |
| **Clickjacking** | Cabeçalhos `X-Frame-Options`/`frame-ancestors` restringem o embute da aplicação |
| **DNS rebinding / Host header** | O servidor **rejeita (403)** qualquer requisição cujo cabeçalho `Host` não seja o loopback (`localhost`/`127.0.0.1`/`::1`). Isso neutraliza ataques de *DNS rebinding*, em que uma página externa faz o navegador da vítima resolver um domínio do atacante para `127.0.0.1` para alcançar a API local. Hosts adicionais (cenário central) são liberados explicitamente via `ALLOWED_HOSTS` |
| **Vazamento de erro** | Mensagens de erro ao usuário são saneadas; detalhes técnicos/stack traces não são expostos |

### 5.3. Cabeçalhos de segurança

Aplicados via **Helmet**: `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, **Content Security Policy (CSP)** definida (status na seção 7), entre outros.

### 5.4. Resistência a manipulação de IA (prompt injection)

O assistente de IA opera majoritariamente em **modo de leitura**. As únicas duas ações de escrita possíveis (criar nota pessoal no app e lançar horas na própria conta) são **restritas ao próprio usuário** e o sistema foi instruído a **ignorar comandos embutidos em conteúdo de terceiros** (tarefas, e-mails, wiki), tratando-os como dado e não como instrução.

### 5.5. Controle de taxa (rate limiting)

Aplicado nos endpoints sensíveis (login, chamadas de IA e pré-visualização de links) para conter abuso e laços descontrolados. Cada limite é **escopado à sua funcionalidade** — o limite de IA conta apenas as rotas de IA, sem afetar as demais áreas do app.

> **Finalidade no modelo atual:** como o servidor atende apenas ao loopback, o rate-limit **não** é uma defesa contra atacante de rede (que não alcança a porta). Seu papel aqui é conter **laços acidentais** e **abuso involuntário** (ex.: um painel de IA em rajada, uma extensão malcomportada) e, sobretudo, **limitar custo** das chamadas de IA. A proteção anti-força-bruta do login só se torna uma barreira relevante contra terceiros num eventual cenário de servidor central.

---

## 6. Práticas de desenvolvimento seguro

- **Análise estática de segurança (SAST)**: **GitHub CodeQL** configurado para rodar em cada alteração e semanalmente. *Nota:* a publicação dos resultados depende da habilitação do **Code Scanning** nas configurações do repositório (recurso de repositório/GitHub Advanced Security) — pendência administrativa, não de código.
- **Varredura de segredos**: **Gitleaks** no pipeline (ativo e passando), para impedir commit acidental de credenciais.
- **Auditoria de dependências**: `npm audit` no pipeline (raiz e cliente), falhando em vulnerabilidades de severidade alta/crítica. **Estado atual:** dependências de runtime (raiz) com **0 vulnerabilidades**. No cliente, restam pendências de severidade moderada/alta em **ferramentas de build** (`esbuild`/`vite`) que afetam apenas o servidor de desenvolvimento — **não são empacotadas no executável distribuído** e não têm exposição em produção. A atualização (que envolve major do Vite) está no backlog de manutenção.
- **Atualização de dependências**: **Dependabot** habilitado.
- **Build e linters**: pipeline de build e lint (ESLint/Prettier) verde, executando em **Node 20 LTS**.
- **Higiene de repositório**: dados de runtime e arquivos com credenciais estão excluídos do versionamento (`.gitignore`); nenhum segredo é versionado (confirmado por inspeção).

---

## 7. Riscos residuais e plano de tratamento

| # | Risco residual | Severidade | Situação / Tratamento |
|---|---|---|---|
| 1 | **Uso de IA externa** envia conteúdo a terceiros | Depende da política | Recurso **opcional e desligado por padrão**; requer decisão formal da empresa (seção 4.3) |
| 2 | **CSP em modo de monitoramento** (registra, ainda não bloqueia) | Baixa | A sanitização DOMPurify já protege contra XSS. **Meta de ativação (`enforce`):** validar os módulos Jitsi/Wiki/Drive na próxima release empacotada e então ligar a flag `CSP_ENFORCE=1` — alvo definido como condição de liberação geral, não item em aberto indefinido |
| 3 | **Sessão de longa duração** (modo token) | Baixa | Aceitável no modelo local (máquina do próprio usuário, sob controle do SO); pode ser encurtada se desejado |
| 4 | **Tráfego local em HTTP** (loopback) | Baixa | Tráfego não sai da máquina; HTTPS só é necessário em eventual cenário de servidor central, já previsto na configuração |
| 5 | **Dependências de build do cliente** (`esbuild`/`vite`) | Baixa | Afetam apenas o servidor de desenvolvimento; **não são empacotadas no executável**. Atualização no backlog de manutenção |
| 6 | **Saneamento de entrada na busca do Drive** | Baixa | ✅ **Corrigido (rev. 1.2)**: a consulta de busca agora escapa caracteres especiais de XML (`<`, `>`, `&`, `"`, `'`) antes de compor a requisição WebDAV. |

Nenhum dos riscos residuais é classificado como **médio ou alto** no modelo de implantação atual.

---

## 8. Recomendações de uso seguro (para a empresa)

1. **Definir a política de IA** (permitir/negar; provedores autorizados; restrições de conteúdo) antes da liberação geral — ver seção 4.3.
2. **Restringir a execução a máquinas corporativas gerenciadas**, com a proteção do Windows (DPAPI) e controle de acesso do SO ativos, pois é a base da cifragem dos segredos.
3. **Manter os sistemas de origem sobre HTTPS** (Redmine/Zimbra/Nextcloud), já que o Bluemine herda a segurança de transporte desses canais.
4. Tratar o executável como software interno: **distribuir por canal controlado** de TI.
5. **Garantir que as máquinas corporativas impeçam a execução de processos não autorizados sob a conta do usuário** — a DPAPI (escopo CurrentUser) protege os segredos contra outros usuários/máquinas, mas não contra código malicioso rodando sob a mesma conta Windows; controles de endpoint (EDR/AppLocker/least privilege) reforçam essa fronteira.
6. **Considerar uma revisão técnica independente (auditoria/pentest)** antes da liberação geral — ver a nota sobre autoavaliação na seção 9.

---

## 9. Conclusão

No modelo de implantação adotado — **executável local por usuário, sem exposição de rede, sem servidor central, usando as credenciais e permissões já existentes do usuário** — o Bluemine apresenta uma **postura de segurança adequada para uso corporativo**. Os controles cobrem as principais classes de risco de aplicações web (XSS, SSRF, força bruta, injeção, vazamento de erro), os segredos são **cifrados em repouso e só trafegam, sobre canais cifrados, para os serviços de destino legítimos** (nunca para terceiros nem para armazenamento externo), e o ciclo de desenvolvimento conta com **análise estática, auditoria de dependências e varredura de segredos automatizadas**.

A única questão que demanda **deliberação corporativa** é o uso opcional de provedores de IA externos, que pode ser autorizado sob política ou simplesmente mantido desativado.

> **Natureza deste documento (autoavaliação):** este relatório foi elaborado e revisado **pela própria equipe de desenvolvimento**, apoiado em ferramentas automatizadas (CodeQL, `npm audit`, Gitleaks) e em três passadas de revisão manual de código. Ele **não substitui** uma auditoria independente ou um teste de penetração por terceiros. Recomenda-se que a área de Segurança da Informação trate este material como ponto de partida e, conforme a criticidade percebida, solicite uma revisão externa do código-fonte antes da liberação em produção.

**Parecer:** recomenda-se a **aprovação para uso**, condicionada à (a) definição da política de IA (seção 4.3), (b) às recomendações de uso seguro (seção 8) e (c) à avaliação, pela área de Segurança, da conveniência de uma revisão independente (acima).

---

## 10. Revisão de segurança realizada (rev. 1.1)

Foi conduzida uma revisão de segurança de código sobre toda a base, com varredura específica de padrões de risco (injeção de comando, `eval`, SQL, path traversal, SSRF, XSS, segredos hardcoded) e leitura das integrações (Redmine, Zimbra, Nextcloud Talk/Drive, DokuWiki). Resultados:

**Confirmado correto:**
- Nenhum segredo trafega para o `localStorage` do navegador — apenas metadados não sensíveis (URL, usuário, host) e preferências de interface; senhas, chaves e tokens ficam exclusivamente no cofre cifrado server-side.
- Nenhum segredo hardcoded no código.
- Sem execução de comando do sistema com entrada do usuário, sem SQL, sem leitura/escrita de arquivo guiada por caminho do usuário.
- Autorização das funções pessoais (notas, quadros, sprints) isolada por usuário; integrações delegam a autorização aos sistemas de origem, sempre com as credenciais do próprio usuário.

**Correções aplicadas nesta revisão:**
1. Cofre de segredos passou a **recusar** gravação em texto puro caso a criptografia nativa falhe (antes havia degradação silenciosa).
2. Reforço **anti prompt-injection** no assistente de IA (conteúdo de terceiros é tratado como dado, nunca como comando).
3. **Guarda anti-SSRF** adicionada ao fluxo de login do Nextcloud Talk (validação de esquema + bloqueio de IPs internos).
4. **Rate-limit de IA escopado** corretamente, evitando que afetasse outras áreas (Talk/e-mail).
5. Remoção de endpoints de depuração e de dados de runtime do versionamento.

### 10.1. Checklist de hardening para uma eventual centralização

Os itens abaixo são **inertes no modelo atual** (exe local, loopback, 1 usuário por processo) e só se tornam relevantes **se** o projeto for futuramente consolidado em um **servidor central multiusuário**. Ficam registrados como pré-requisitos para essa transição:

- [ ] Ativar **HTTPS** e o atributo `secure` do cookie de sessão (já preparado via configuração).
- [ ] Aplicar **CSP em modo de bloqueio** (`enforce`) após validação funcional (hoje em monitoramento).
- [ ] Substituir o rate-limit por-IP em memória por um **store compartilhado** e configurar `trust proxy`.
- [x] Eliminar o último padrão de **credencial em variável global** (proxy de mídia do DokuWiki) em favor de resolução por usuário. *(feito na rev. 1.2)*
- [x] Restringir por **allowlist de host** o destino do DokuWiki (host fixo, sem aceitar host do cliente). Login do Talk continua coberto pela guarda anti-SSRF. *(DokuWiki feito na rev. 1.2)*
- [ ] Revisar a **política de expiração de sessão** (hoje longa, adequada ao uso local).

---

## 10.2. Revisão de segurança realizada (rev. 1.2)

Terceira passada de revisão, com varredura de 100% do código (servidor e cliente), verificação independente das afirmações da rev. 1.1 e **incorporação das observações de uma revisão crítica externa do relatório**. Foco em segredos, XSS, SSRF, CSRF, DNS rebinding, injeção, autorização e tratamento de credenciais.

**Confirmado correto (reverificado):**
- **XSS**: todos os pontos que injetam HTML de terceiros (Markdown de tarefas, assistente de IA, wiki) passam por **DOMPurify** antes da renderização.
- **Segredos no cliente**: o `localStorage` guarda apenas metadados não sensíveis (URL, usuário, host); senhas, chaves de IA e sementes TOTP existem somente no cofre cifrado server-side e **nunca** são devolvidos ao cliente (os endpoints de status retornam apenas indicadores booleanos; o TOTP retorna o código já calculado, não a semente).
- **Criptografia em repouso (DPAPI)**: a invocação nativa usa um script fixo com a entrada passada por canal de dados (stdin), **sem concatenação de entrada do usuário** — sem superfície de injeção de comando.
- **SSRF**: a guarda de bloqueio de IPs internos cobre os pontos que buscam URLs do usuário (preview de links, login do Talk), inclusive em redirecionamentos.
- **Path traversal**: os caminhos do Drive descartam segmentos `..`/`.` antes de compor a URL WebDAV.
- **Autorização da IA**: as chaves vêm do cofre por-usuário; as únicas ações de escrita do assistente (criar nota pessoal e lançar horas) são restritas à conta do próprio usuário, e o conteúdo de terceiros é tratado como dado, não comando.

**Correções aplicadas nesta revisão:**
1. **DokuWiki — credencial em variável global eliminada.** O proxy de mídia (`/wiki/media`) passou a resolver as credenciais **por usuário** a partir da sessão, removendo a variável de módulo que retinha as credenciais do último usuário (risco de vazamento cruzado em um eventual cenário multiusuário).
2. **DokuWiki — vetor de SSRF fechado.** O host de destino deixou de ser influenciável pelo cliente e passou a ser **fixo no servidor corporativo configurado** (allowlist de host); os fetches de conteúdo **não seguem redirecionamentos**, impedindo desvio para endereços internos.
3. **Documentação de dependências corrigida.** Esclarecido que as pendências do cliente são de **ferramentas de build** (não empacotadas no executável distribuído).
4. **Proteção anti DNS-rebinding (validação de Host).** O servidor passou a **rejeitar (403)** requisições cujo cabeçalho `Host` não seja o loopback, fechando o vetor em que uma página externa usa *DNS rebinding* para alcançar a API local. Hosts adicionais para cenário central são liberados via `ALLOWED_HOSTS` (seção 5.2).
5. **Correção de imprecisão de redação.** A afirmação "as credenciais nunca saem da máquina" foi ajustada: os segredos **não são armazenados fora da máquina nem enviados a terceiros**, mas **trafegam, sobre HTTPS, para os serviços de destino legítimos** durante a autenticação — como em qualquer cliente desses sistemas (seções 1 e 9).
6. **Saneamento de entrada na busca do Drive.** O termo de busca e o identificador de usuário passaram a ser **escapados como XML** antes de comporem o corpo das requisições WebDAV SEARCH, eliminando a possibilidade de injeção de XML na consulta.

**Pontos da revisão externa endereçados também por esclarecimento (sem mudança de código):**
- **CSRF**: explicitada a defesa em camadas (`SameSite=Lax` + CORS de loopback + ausência de escrita via GET + validação de Host); tokens dedicados ficam como pré-requisito de centralização (seção 5.1).
- **CSP**: definida uma **meta de ativação do modo `enforce`** como condição de liberação geral (seção 7).
- **Rate-limiting**: esclarecida sua finalidade limitada no modelo loopback (seção 5.5).
- **Autoavaliação**: registrada a recomendação de **revisão independente/pentest** antes da produção (seções 8 e 9).

**Itens de baixo risco registrados para tratamento (seção 7):** atualização das ferramentas de build do cliente (`esbuild`/`vite`).

---

*Documento elaborado pela equipe de desenvolvimento do Bluemine. Disponível para esclarecimentos e para uma revisão técnica detalhada mediante solicitação da área de Segurança da Informação.*
