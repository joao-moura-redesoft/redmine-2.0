# Relatório de Segurança — Bluemine

**Documento para avaliação e aprovação de uso corporativo**

| | |
|---|---|
| **Sistema** | Bluemine — painel de produtividade integrado ao Redmine |
| **Versão do relatório** | 1.0 |
| **Data** | 30/06/2026 |
| **Classificação** | Interno |
| **Modelo de implantação** | Aplicativo desktop (.exe), 1 instância por usuário, execução local |

---

## 1. Sumário executivo

O Bluemine é um aplicativo de produtividade que centraliza, em uma única interface, o acesso às ferramentas que a equipe já utiliza: gestão de tarefas (Redmine), e-mail (Zimbra), arquivos e chat (Nextcloud), wiki corporativa (DokuWiki), videochamadas (Jitsi) e autenticação em duas etapas (TOTP). Ele **não substitui nem reconfigura** nenhum desses sistemas — apenas consome as APIs existentes usando as **mesmas credenciais e permissões** que o usuário já possui.

Do ponto de vista de segurança, o ponto mais relevante é o **modelo de implantação**: cada usuário roda a própria cópia do programa **localmente, na própria máquina**, e o componente de servidor escuta **exclusivamente no endereço local (`127.0.0.1`)**. **Não há servidor central, não há banco de dados compartilhado e nenhuma porta é exposta à rede.** Isso elimina, por construção, as classes de risco mais críticas em aplicações web (exposição de superfície de ataque na rede, vazamento entre usuários, comprometimento centralizado).

As credenciais e segredos do usuário **nunca saem da máquina** e são **armazenados cifrados em repouso** com a tecnologia nativa do Windows (DPAPI), vinculada à conta Windows do próprio usuário.

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

- Sessão baseada em **cookie `HttpOnly`** (inacessível a scripts) com política **`SameSite=Lax`** (mitiga CSRF).
- **Proteção contra força bruta** no login (limite de tentativas por janela de tempo).
- Logout encerra e remove a sessão no servidor.
- Suporte a `cookie secure` (HTTPS) já preparado via configuração, para um eventual cenário de servidor central.

### 5.2. Proteção contra ataques web (OWASP)

| Risco | Controle |
|---|---|
| **XSS (Cross-Site Scripting)** | Todo conteúdo HTML de terceiros (Markdown de tarefas, wiki, assistente) é **sanitizado com DOMPurify** antes da exibição |
| **SSRF (Server-Side Request Forgery)** | O recurso de pré-visualização de links bloqueia acesso a **endereços internos/privados** (incl. faixas de metadados de nuvem), inclusive em redirecionamentos |
| **Path Traversal** | Caminhos de arquivos (Drive) descartam sequências `..` antes do uso |
| **Injeção (XML/SOAP)** | A integração de e-mail usa serialização estruturada (JSON-SOAP), sem concatenação de strings |
| **Clickjacking** | Cabeçalhos `X-Frame-Options`/`frame-ancestors` restringem o embute da aplicação |
| **Vazamento de erro** | Mensagens de erro ao usuário são saneadas; detalhes técnicos/stack traces não são expostos |

### 5.3. Cabeçalhos de segurança

Aplicados via **Helmet**: `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, **Content Security Policy (CSP)** definida (status na seção 7), entre outros.

### 5.4. Resistência a manipulação de IA (prompt injection)

O assistente de IA opera majoritariamente em **modo de leitura**. As únicas duas ações de escrita possíveis (criar nota pessoal no app e lançar horas na própria conta) são **restritas ao próprio usuário** e o sistema foi instruído a **ignorar comandos embutidos em conteúdo de terceiros** (tarefas, e-mails, wiki), tratando-os como dado e não como instrução.

### 5.5. Controle de taxa (rate limiting)

Aplicado nos endpoints sensíveis (login e chamadas de IA) para conter abuso e laços descontrolados.

---

## 6. Práticas de desenvolvimento seguro

- **Análise estática de segurança (SAST)**: **GitHub CodeQL** roda em cada alteração e semanalmente.
- **Auditoria de dependências**: `npm audit` no pipeline, falhando em vulnerabilidades de severidade alta/crítica.
- **Atualização de dependências**: **Dependabot** habilitado.
- **Varredura de segredos**: **Gitleaks** no pipeline, para impedir commit acidental de credenciais.
- **Linters e formatação** padronizados.
- **Estado atual das dependências**: **0 vulnerabilidades conhecidas** reportadas pela auditoria.
- **Higiene de repositório**: dados de runtime e arquivos com credenciais estão excluídos do versionamento (`.gitignore`); nenhum segredo é versionado.

---

## 7. Riscos residuais e plano de tratamento

| # | Risco residual | Severidade | Situação / Tratamento |
|---|---|---|---|
| 1 | **Uso de IA externa** envia conteúdo a terceiros | Depende da política | Recurso **opcional e desligado por padrão**; requer decisão formal da empresa (seção 4.3) |
| 2 | **CSP em modo de monitoramento** (registra, ainda não bloqueia) | Baixa | A sanitização DOMPurify já protege contra XSS; o bloqueio total da CSP será ativado após validação funcional com Jitsi/Wiki/Drive |
| 3 | **Sessão de longa duração** (modo token) | Baixa | Aceitável no modelo local (máquina do próprio usuário, sob controle do SO); pode ser encurtada se desejado |
| 4 | **Tráfego local em HTTP** (loopback) | Baixa | Tráfego não sai da máquina; HTTPS só é necessário em eventual cenário de servidor central, já previsto na configuração |

Nenhum dos riscos residuais é classificado como **médio ou alto** no modelo de implantação atual.

---

## 8. Recomendações de uso seguro (para a empresa)

1. **Definir a política de IA** (permitir/negar; provedores autorizados; restrições de conteúdo) antes da liberação geral — ver seção 4.3.
2. **Restringir a execução a máquinas corporativas gerenciadas**, com a proteção do Windows (DPAPI) e controle de acesso do SO ativos, pois é a base da cifragem dos segredos.
3. **Manter os sistemas de origem sobre HTTPS** (Redmine/Zimbra/Nextcloud), já que o Bluemine herda a segurança de transporte desses canais.
4. Tratar o executável como software interno: **distribuir por canal controlado** de TI.

---

## 9. Conclusão

No modelo de implantação adotado — **executável local por usuário, sem exposição de rede, sem servidor central, usando as credenciais e permissões já existentes do usuário** — o Bluemine apresenta uma **postura de segurança adequada para uso corporativo**. Os controles cobrem as principais classes de risco de aplicações web (XSS, SSRF, força bruta, injeção, vazamento de erro), os segredos são **cifrados em repouso e nunca trafegam para fora da máquina**, e o ciclo de desenvolvimento conta com **análise estática, auditoria de dependências e varredura de segredos automatizadas**.

A única questão que demanda **deliberação corporativa** é o uso opcional de provedores de IA externos, que pode ser autorizado sob política ou simplesmente mantido desativado.

**Parecer:** recomenda-se a **aprovação para uso**, condicionada à definição da política de IA (seção 4.3) e às recomendações de uso seguro (seção 8).

---

*Documento elaborado pela equipe de desenvolvimento do Bluemine. Disponível para esclarecimentos e para uma revisão técnica detalhada mediante solicitação da área de Segurança da Informação.*
