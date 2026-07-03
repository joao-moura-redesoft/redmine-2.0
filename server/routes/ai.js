// IA — endpoints de geração de prompt, resumos, rascunhos, chat agêntico e análises.
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();

// Executa uma ferramenta do chat OU, se for de escrita (dangerous), NÃO executa:
// registra a ação em `pendingActions` para o cliente confirmar. Isso impede que
// uma injeção de prompt em conteúdo de terceiros dispare escritas sozinha.
async function gateOrExec(name, args, ctx, pendingActions) {
  if (isDangerousTool(name)) {
    pendingActions.push({
      id: crypto.randomUUID(),
      tool: name,
      args,
      label: describeAction(name, args),
    });
    return {
      status: 'pending_confirmation',
      message:
        'Ação de escrita NÃO executada: requer confirmação explícita do usuário na interface.',
    };
  }
  return execChatTool(name, args, ctx);
}
const { makeRedmine, buildAuthHeaders, getMyUserId } = require('../lib/redmine');
const handle = require('../lib/handle');
const { createRateLimiter } = require('../middleware/rateLimit');
const {
  Anthropic,
  makeOpenAIClient,
  chatModel,
  resolveUserName,
  buildIssueContext,
  getAICredentials,
  getOpenAIKey,
  MAX_ATTACH_BYTES,
  fetchAttachmentBase64,
  imageBlock,
  aiComplete,
  transcribeAudio,
  PROMPT_SYSTEM,
  PROMPT_TEMPLATE,
  CHAT_TOOLS,
  CHAT_SYSTEM,
  execChatTool,
  isDangerousTool,
  describeAction,
} = require('../services/ai');
const aiUsage = require('../services/aiUsageStore');
const { REDMINE_CF, REDMINE_STATUS, AI_MODELS } = require('../lib/config');

// Limita o uso dos endpoints de IA: cada chamada custa dinheiro e bate em APIs
// externas (Anthropic/OpenAI/Gemini). Janela generosa o suficiente para uso
// normal de um usuário, mas que corta loops/abuso.
const aiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60, // ~1 req/s sustentado: folga para uso normal (painéis de IA em rajada), ainda corta loop/abuso
  message: 'Muitas requisições de IA em pouco tempo. Aguarde um instante e tente novamente.',
});
// IMPORTANTE: escopar ao prefixo '/ai'. Este router é montado em '/api' junto com
// os demais (talk, mail, jitsi...). Um `router.use(aiLimiter)` sem path rodaria
// para TODA requisição /api que passa por aqui antes de cair no router seguinte,
// fazendo o talk/mail/jitsi consumir o contador de IA e tomar 429 indevido.
router.use('/ai', aiLimiter);

// Uso/custo de IA do usuário atual (tokens acumulados por provider e por dia).
router.get(
  '/ai/usage',
  handle(async (req, res) => {
    const uid = await getMyUserId(req);
    res.json(aiUsage.summary(uid));
  }),
);

// Transcreve o áudio de uma reunião (Whisper/OpenAI) e gera um resumo estruturado
// com o provider de IA preferido. Recebe o áudio como corpo binário (express.raw).
// As chaves de IA vêm do cofre cifrado server-side (por usuário), não de headers.
//   x-meeting-title, x-meeting-participants → contexto opcional
router.post(
  '/ai/transcribe-summarize',
  express.raw({ type: () => true, limit: '80mb' }),
  handle(async (req, res) => {
    const openaiKey = await getOpenAIKey(req);
    if (!openaiKey)
      return res.status(400).json({
        error:
          'Transcrição requer uma chave da OpenAI (Whisper). Configure-a em Configurações → IA.',
      });
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'áudio vazio' });

    const filename = decodeURIComponent(req.headers['x-filename'] || 'meeting.webm');
    const mime = req.headers['x-content-type'] || req.headers['content-type'] || 'audio/webm';
    const title = decodeURIComponent(req.headers['x-meeting-title'] || 'Reunião');
    const participants = decodeURIComponent(req.headers['x-meeting-participants'] || '');

    const transcript = await transcribeAudio(openaiKey, req.body, filename, mime);
    if (!transcript)
      return res.json({
        transcript: '',
        summary: 'Não foi possível extrair fala do áudio (silêncio ou áudio não compartilhado).',
      });

    // Resumo com o provider preferido (Claude por padrão).
    const { provider, key, uid } = await getAICredentials(req);
    let summary = '';
    if (key) {
      summary = await aiComplete(provider, key, {
        uid,
        system:
          'Você é um assistente que resume reuniões de um time de desenvolvimento de software. Responda em português do Brasil, em markdown, de forma objetiva.',
        user: `Resuma a transcrição da reunião abaixo. Use exatamente estas seções (omita uma seção se não houver conteúdo):

## 📋 Resumo
[2-4 frases do que foi discutido]

## ✅ Decisões
[bullets das decisões tomadas]

## 📌 Ações / Pendências
[bullets no formato "- [responsável, se citado] ação"]

## ⚠️ Pontos de atenção
[riscos, dúvidas em aberto — ou omita]

Não invente nada que não esteja na transcrição. Se a transcrição for curta/ruidosa, diga isso.

Reunião: ${title}
${participants ? `Participantes: ${participants}` : ''}

Transcrição:
${transcript.slice(0, 24000)}`,
        maxTokens: 900,
        fast: false,
      });
    }

    res.json({ transcript, summary });
  }),
);

// Gera o prompt completo seguindo o template da skill gerar-prompt-tarefa.
router.post(
  '/ai/generate-prompt',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    // Busca imagens dos anexos para enviar inline ao modelo (multimodal).
    // Limite: imagens ≤ 5 MB, no máximo 5 por issue (custo/latência).
    const redmineUrl = req.headers['x-redmine-url'] || '';
    const redmineKey = req.headers['x-redmine-key'] || '';
    const redmineUser = req.headers['x-redmine-user'] || '';
    const redminePass = req.headers['x-redmine-pass'] || '';
    const redmineAuthHeaders = buildAuthHeaders(redmineKey, redmineUser, redminePass);
    const hasRedmineAuth = !!(redmineUrl && (redmineKey || (redmineUser && redminePass)));
    const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    const imageAttachments = (issue.attachments || [])
      .filter(
        (a) =>
          imageTypes.includes(a.content_type?.toLowerCase()) &&
          (a.filesize || 0) <= MAX_ATTACH_BYTES,
      )
      .slice(0, 5);

    const fetchedImages = [];
    if (hasRedmineAuth) {
      for (const att of imageAttachments) {
        const img = await fetchAttachmentBase64(
          redmineUrl,
          redmineAuthHeaders,
          att.id,
          att.filename,
        );
        if (img) fetchedImages.push({ ...img, filename: att.filename });
      }
    }

    // Resolve o ID do revisor (CF 210) para nome antes de montar o contexto.
    const redmineClient = makeRedmine(req);
    const rawRevisorId =
      (issue.custom_fields || []).find((f) => f.id === REDMINE_CF.reviewer)?.value || '';
    const revisorName = await resolveUserName(redmineClient, rawRevisorId);

    const inlineNames = new Set(fetchedImages.map((i) => i.filename));
    const textContent = PROMPT_TEMPLATE(buildIssueContext(issue, inlineNames, revisorName));

    // Monta conteúdo: texto do template + imagens inline com instrução explícita antes de cada uma.
    // Monta conteúdo multimodal: instrução de descrição fica IMEDIATAMENTE antes de cada imagem
    // para o modelo associar claramente qual imagem descrever.
    const userContent =
      fetchedImages.length === 0
        ? textContent
        : [
            { type: 'text', text: textContent },
            {
              type: 'text',
              text: `\n\n---\nOs ${fetchedImages.length} anexo(s) de imagem desta tarefa seguem abaixo. Para cada um, você DEVE incluir uma subseção "### <nome>" dentro de "## Anexos" do prompt gerado com descrição visual completa e factual.`,
            },
            ...fetchedImages.flatMap((img) => [
              {
                type: 'text',
                text: `\n### ${img.filename}\nOLHE com atenção para a imagem abaixo e descreva factualmente: (1) que tela/módulo do sistema está sendo exibida, (2) todos os textos visíveis na tela, especialmente mensagens de erro — transcrever LITERALMENTE, (3) campos preenchidos e seus valores, (4) o que está destacado, selecionado ou anotado. Esta descrição vai para "## Anexos" do prompt:`,
              },
              imageBlock(provider, img.base64, img.mediaType),
            ]),
          ];

    if (fetchedImages.length > 0) {
      console.log(`[ai] ${fetchedImages.length} imagem(ns) enviada(s) inline para ${provider}`);
    }

    const prompt = await aiComplete(provider, key, {
      uid,
      system: PROMPT_SYSTEM,
      userContent,
      maxTokens: 2048,
    });

    res.json({ prompt });
  }),
);

// Resumo dos journals — destila o histórico em bullets.
router.post(
  '/ai/summarize-history',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const notes = (issue.journals || [])
      .filter((j) => j.notes?.trim())
      .map((j) => `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${j.notes.trim()}`)
      .join('\n\n');

    if (!notes) return res.json({ summary: 'Sem comentários no histórico desta tarefa.' });

    const summary = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um assistente de desenvolvimento de software. Responda em português do Brasil.',
      user: `Resuma o histórico de comentários abaixo em bullets (•), destacando: o que foi feito, problemas encontrados, decisões tomadas e pendências. Seja direto. Máximo 8 bullets.

Tarefa: #${issue.id} — ${issue.subject}
Status atual: ${issue.status?.name}

Histórico:
${notes}`,
      maxTokens: 500,
      fast: true,
    });

    res.json({ summary });
  }),
);

// Rascunho de nota para postar no journal.
router.post(
  '/ai/draft-note',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const cf = (id) => (issue.custom_fields || []).find((f) => f.id === id)?.value || '';
    const branch = cf(REDMINE_CF.branch);
    const lastNote = (issue.journals || []).filter((j) => j.notes?.trim()).slice(-1)[0];

    const draft = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um desenvolvedor do ERP B2click (frontend Delphi, backend Java 21). Escreva em português do Brasil, tom técnico e direto. Gere APENAS o texto da nota, sem título nem formatação extra.',
      user: `Gere um rascunho de nota de atualização para o journal desta tarefa. O desenvolvedor quer registrar progresso. Deve ser objetivo (2-4 parágrafos curtos), mencionar o que foi feito e próximos passos. Não invente detalhes técnicos — baseie-se no contexto.

Tarefa: #${issue.id} — ${issue.subject}
Status: ${issue.status?.name}
${branch ? `Branch: ${branch}` : ''}
${lastNote ? `Último comentário (${lastNote.created_on?.slice(0, 10)}): ${lastNote.notes?.trim().slice(0, 300)}` : ''}`,
      maxTokens: 350,
      fast: true,
    });

    res.json({ draft });
  }),
);

// Rascunho de resposta ao cliente — tom de suporte, baseado no histórico do chamado.
router.post(
  '/ai/draft-reply',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue, instruction } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const history = (issue.journals || [])
      .filter((j) => j.notes?.trim())
      .slice(-6)
      .map(
        (j) =>
          `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${j.notes.trim().slice(0, 500)}`,
      )
      .join('\n\n');

    const reply = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um analista de suporte da B2click respondendo a um cliente em um chamado. Escreva em português do Brasil, com tom cordial, profissional e claro. Trate o cliente com respeito. Seja conciso e objetivo, sem jargão técnico interno nem detalhes de implementação. Gere APENAS o texto da resposta, pronto para enviar.',
      user: `Escreva uma resposta para o cliente neste chamado.${instruction ? ` Objetivo da resposta: ${instruction}.` : ''} Baseie-se no histórico; não invente prazos ou fatos que não estejam no contexto. Se faltar informação, peça educadamente o que for necessário.

Chamado: #${issue.id} — ${issue.subject}
Status: ${issue.status?.name}

Histórico recente:
${history || '(sem mensagens anteriores)'}`,
      maxTokens: 500,
      fast: true,
    });

    res.json({ reply });
  }),
);

// ── Chat Redmine (assistente conversacional) ────────────────────────────────
// Loop agêntico de tool-use: a IA escolhe ferramentas, o servidor executa no
// Redmine (via makeRedmine) e devolve os resultados até a IA responder.
// As ferramentas são majoritariamente de LEITURA; as ÚNICAS de escrita são
// `criar_nota` (nota local do app) e `lancar_horas` (time entry no Redmine),
// ambas restritas à conta do próprio usuário. O CHAT_SYSTEM instrui o modelo a
// ignorar instruções vindas de conteúdo de tarefas/e-mails/wiki (anti prompt-injection).
router.post(
  '/ai/chat',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0)
      return res.status(400).json({ error: 'messages obrigatório' });

    const redmine = makeRedmine(req);
    const ctx = { redmine, req };
    const trace = [];
    // Ações de escrita propostas pelo modelo, NÃO executadas: devolvidas ao
    // cliente para confirmação explícita (ver /ai/confirm-action).
    const pendingActions = [];
    const MAX_STEPS = 8;

    if (provider === 'anthropic') {
      const client = new Anthropic({ apiKey: key });
      const tools = CHAT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
      const convo = messages.map((m) => ({ role: m.role, content: m.content }));
      for (let step = 0; step < MAX_STEPS; step++) {
        const resp = await client.messages.create({
          model: AI_MODELS.anthropic.default,
          max_tokens: 1500,
          system: CHAT_SYSTEM,
          tools,
          messages: convo,
        });
        aiUsage.record(uid, provider, aiUsage.usageFrom(resp));
        const toolUses = resp.content.filter((b) => b.type === 'tool_use');
        if (toolUses.length === 0) {
          const text = resp.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
          return res.json({ reply: text, trace, pendingActions });
        }
        convo.push({ role: 'assistant', content: resp.content });
        const results = [];
        for (const tu of toolUses) {
          trace.push({ tool: tu.name, args: tu.input });
          const out = gateOrExec(tu.name, tu.input, ctx, pendingActions);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(await out).slice(0, 8000),
          });
        }
        convo.push({ role: 'user', content: results });
      }
      return res.json({
        reply: 'Não consegui concluir a consulta em tempo hábil. Tente reformular.',
        trace,
        pendingActions,
      });
    }

    if (provider === 'openai' || provider === 'gemini') {
      const client = makeOpenAIClient(provider, key);
      const tools = CHAT_TOOLS.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.input_schema },
      }));
      const convo = [
        { role: 'system', content: CHAT_SYSTEM },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ];
      for (let step = 0; step < MAX_STEPS; step++) {
        const resp = await client.chat.completions.create({
          model: chatModel(provider),
          max_tokens: 1500,
          messages: convo,
          tools,
        });
        aiUsage.record(uid, provider, aiUsage.usageFrom(resp));
        const msg = resp.choices[0].message;
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          return res.json({ reply: (msg.content || '').trim(), trace, pendingActions });
        }
        convo.push(msg);
        for (const tc of msg.tool_calls) {
          let args = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}');
          } catch {
            /* ignore */
          }
          trace.push({ tool: tc.function.name, args });
          const out = await gateOrExec(tc.function.name, args, ctx, pendingActions);
          convo.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
      }
      return res.json({
        reply: 'Não consegui concluir a consulta em tempo hábil. Tente reformular.',
        trace,
        pendingActions,
      });
    }

    return res.status(400).json({ error: `provider desconhecido: ${provider}` });
  }),
);

// Confirmação explícita de uma ação de escrita proposta pelo chat de IA.
// O gate de /ai/chat NÃO executa escritas; elas só rodam aqui, disparadas por um
// clique do usuário autenticado — este endpoint é o controle de segurança contra
// prompt-injection. Só ferramentas marcadas como `dangerous` são aceitas.
router.post(
  '/ai/confirm-action',
  handle(async (req, res) => {
    const { tool, args } = req.body || {};
    if (!tool || !isDangerousTool(tool))
      return res.status(400).json({ error: 'Ação não confirmável.' });
    const out = await execChatTool(tool, args || {}, { redmine: makeRedmine(req), req });
    if (out && out.erro) return res.status(502).json({ error: out.erro });
    res.json({ ok: true, result: out });
  }),
);

// Daily standup — gera texto de standup a partir das tarefas abertas.
router.post(
  '/ai/standup',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issues } = req.body;
    if (!Array.isArray(issues) || issues.length === 0) {
      return res.json({ standup: 'Nenhuma tarefa aberta encontrada.' });
    }

    const list = issues
      .slice(0, 25)
      .map((i) => `- #${i.id} [${i.status?.name}] ${i.subject}`)
      .join('\n');

    const standup = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um assistente de daily standup para um time de desenvolvimento. Responda em português do Brasil.',
      user: `Com base nas tarefas abaixo, gere um texto de daily standup no formato:

**Ontem:** [o que provavelmente foi trabalhado com base nos status]
**Hoje:** [o que planejo fazer — foque nas tarefas em andamento e pendências imediatas]
**Impedimentos:** [bloqueios evidentes, ou "Nenhum"]

Use primeira pessoa. Seja conciso. Cite IDs das tarefas relevantes.

Minhas tarefas:
${list}`,
      maxTokens: 400,
      fast: true,
    });

    res.json({ standup });
  }),
);

// Retrospectiva semanal — resumo das entregas da semana + em andamento + riscos.
router.post(
  '/ai/weekly-digest',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { open = [], completed = [] } = req.body;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const doneThisWeek = completed.filter((i) => {
      const d = i.closed_on || i.updated_on;
      return d && new Date(d).getTime() >= weekAgo;
    });

    if (doneThisWeek.length === 0 && open.length === 0) {
      return res.json({ digest: 'Nenhuma atividade na última semana.' });
    }

    const fmt = (arr) =>
      arr
        .slice(0, 30)
        .map((i) => `- #${i.id} [${i.status?.name}] ${i.subject}`)
        .join('\n');
    const inProgress = open.filter((i) => /andamento|progress/i.test(i.status?.name || ''));

    const digest = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um assistente que escreve retrospectivas semanais para um desenvolvedor de um time de software. Responda em português do Brasil, em markdown.',
      user: `Escreva uma retrospectiva semanal concisa e útil com base nas tarefas abaixo. Use exatamente estas seções:

## ✅ Entregue esta semana
[liste as concluídas com IDs; se vazio, "Nada concluído nesta semana."]

## 🔄 Em andamento
[tarefas em andamento e o que falta]

## ⚠️ Riscos e bloqueios
[infira riscos pelos status — tarefas paradas, muitas pendências, nada concluído — ou "Nenhum aparente"]

## 🎯 Foco sugerido para a próxima semana
[2-4 bullets priorizando o que destravar primeiro]

Seja específico e cite IDs. Não invente dados além do que está nas listas.

Concluídas nos últimos 7 dias (${doneThisWeek.length}):
${fmt(doneThisWeek) || '(nenhuma)'}

Em andamento (${inProgress.length}):
${fmt(inProgress) || '(nenhuma)'}

Demais tarefas abertas (${open.length}):
${fmt(open) || '(nenhuma)'}`,
      maxTokens: 700,
      fast: false,
    });

    res.json({ digest });
  }),
);

// Avaliação de complexidade — o modelo avalia o quão complexa é a tarefa com base
// nos requisitos descritos. Não inventa horas: dá um nível qualitativo + raciocínio
// + fatores de risco. Muito mais honesto e útil do que um número fabricado.
router.post(
  '/ai/assess-complexity',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const cf = (id) => (issue.custom_fields || []).find((f) => f.id === id)?.value || '';
    const impacto = cf(REDMINE_CF.impact);
    const numReqs = (issue.children || []).length; // subtarefas como proxy de escopo
    const rejections = (issue.journals || []).filter((j) =>
      j.details?.some(
        (d) =>
          d.property === 'attr' &&
          d.name === 'status_id' &&
          d.new_value === String(REDMINE_STATUS.pendingFix),
      ),
    ).length;

    const result = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um tech lead experiente no ERP B2click (frontend Delphi, backend Java 21 legado). Responda APENAS com JSON válido, sem markdown.',
      user: `Avalie a complexidade desta tarefa de desenvolvimento. Retorne um JSON com:
- "level": um de "Baixa" | "Média" | "Alta" | "Muito Alta"
- "reasoning": string (2-3 frases) explicando por que este nível, citando os aspectos mais relevantes da descrição
- "risks": array de strings (2-5 itens) listando os principais fatores de risco ou pontos de atenção
- "roughHours": string com faixa aproximada de esforço (ex: "4-8h", "2-5 dias") — deixe claro que é uma estimativa bruta baseada apenas na descrição

Considere: número de requisitos listados, módulos afetados, integrações (PDV/retaguarda), novidade da funcionalidade, clareza dos requisitos.

Tarefa: #${issue.id} — ${issue.subject}
Tracker: ${issue.tracker?.name || ''}
${impacto ? `Impacto (módulos): ${impacto}` : ''}
${numReqs > 0 ? `Subtarefas: ${numReqs}` : ''}
${rejections > 0 ? `Voltou da revisão ${rejections}x (histórico de correções)` : ''}

Descrição:
${(issue.description || '(sem descrição)').slice(0, 1500)}`,
      maxTokens: 400,
      fast: false,
    });

    try {
      res.json(JSON.parse(result));
    } catch {
      res.json({ level: '?', reasoning: result, risks: [], roughHours: '?' });
    }
  }),
);

// Checklist de revisão para o revisor (status Pendente Revisão).
router.post(
  '/ai/review-checklist',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const cf = (id) => (issue.custom_fields || []).find((f) => f.id === id)?.value || '';
    const impacto = cf(REDMINE_CF.impact);
    const branch = cf(REDMINE_CF.branch);

    const lastDevNotes = (issue.journals || [])
      .filter((j) => j.notes?.trim())
      .slice(-3)
      .map((j) => `- ${j.notes.trim().slice(0, 300)}`)
      .join('\n');

    const checklist = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um revisor de software experiente no ERP B2click (frontend Delphi, backend Java 21). Responda em português do Brasil.',
      user: `Gere um checklist de revisão de código para a tarefa abaixo. Cada item deve ser uma pergunta ou verificação concreta que o revisor deve checar. Use formato markdown com checkboxes: "- [ ] Verificar que...". Entre 6 e 12 itens. Baseie nos requisitos descritos e no impacto informado.

Tarefa: #${issue.id} — ${issue.subject}
${branch ? `Branch: ${branch}` : ''}
${impacto ? `Impacto (módulos afetados): ${impacto}` : ''}

Descrição:
${(issue.description || '').slice(0, 1500)}

${lastDevNotes ? `Notas do desenvolvedor:\n${lastDevNotes}` : ''}`,
      maxTokens: 600,
      fast: false,
    });

    res.json({ checklist });
  }),
);

// Sugestão de campos para nova issue com base no título e descrição.
router.post(
  '/ai/suggest-fields',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { subject, description, trackers, priorities } = req.body;
    if (!subject) return res.status(400).json({ error: 'subject obrigatório' });

    const trackerList = (trackers || []).map((t) => `${t.id}: ${t.name}`).join(', ');
    const priorityList = (priorities || []).map((p) => `${p.id}: ${p.name}`).join(', ');

    const IMPACTO_OPTS =
      'JAVA, B2CLICK, B2CLICKPAF, ROTEADORPDV, AUTOMACAO, B2CLICKPOS, B2CLICKPAY (pode combinar com +)';

    const result = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um assistente de triagem de tarefas do ERP B2click. Responda APENAS com JSON válido, sem markdown.',
      user: `Com base no título e descrição da tarefa abaixo, sugira os campos mais adequados. Retorne um JSON com:
- "tracker_id": número do tracker mais adequado (ou null se incerto)
- "priority_id": número da prioridade mais adequada (ou null se incerto)
- "impacto": string com o valor de impacto (ou null se incerto)
- "reasoning": string curta (1 frase) explicando as escolhas

Trackers disponíveis: ${trackerList || '(não informados)'}
Prioridades disponíveis: ${priorityList || '(não informadas)'}
Opções de impacto: ${IMPACTO_OPTS}

Título: ${subject}
Descrição: ${(description || '').slice(0, 500)}`,
      maxTokens: 200,
      fast: true,
    });

    try {
      res.json(JSON.parse(result));
    } catch {
      res.json({ tracker_id: null, priority_id: null, impacto: null, reasoning: result });
    }
  }),
);

// Revisão de nota antes de postar no journal.
router.post(
  '/ai/review-note',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { noteText, issueSubject, issueStatus } = req.body;
    if (!noteText) return res.status(400).json({ error: 'noteText obrigatório' });

    const feedback = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um revisor técnico de notas de progresso de software. Responda em português do Brasil. Seja direto e conciso.',
      user: `Revise a nota de journal abaixo e aponte em 2-4 bullets (•) o que poderia ser melhorado: informações faltando, pontos ambíguos, ou aspectos importantes não mencionados. Se a nota estiver boa, diga "✓ Nota clara e completa." sem bullets.

Contexto da tarefa: ${issueSubject || '(não informado)'} [${issueStatus || ''}]

Nota a revisar:
${noteText.slice(0, 1000)}`,
      maxTokens: 250,
      fast: true,
    });

    res.json({ feedback });
  }),
);

// Detector de requisitos ambíguos — aponta o que está incompleto ou contraditório
// antes do dev começar, evitando retrabalho e ping-pong de revisão.
router.post(
  '/ai/detect-ambiguities',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const redmineUrl = req.headers['x-redmine-url'] || '';
    const redmineKey = req.headers['x-redmine-key'] || '';
    const redmineUser = req.headers['x-redmine-user'] || '';
    const redminePass = req.headers['x-redmine-pass'] || '';
    const redmineAuthHeaders = buildAuthHeaders(redmineKey, redmineUser, redminePass);
    const hasRedmineAuth = !!(redmineUrl && (redmineKey || (redmineUser && redminePass)));

    // Separa anexos por tipo
    const imageTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    const textTypes = [
      'text/plain',
      'text/csv',
      'application/sql',
      'application/json',
      'text/html',
      'text/xml',
      'application/xml',
    ];
    const attachments = issue.attachments || [];

    const imageAtts = attachments
      .filter(
        (a) =>
          imageTypes.includes(a.content_type?.toLowerCase()) &&
          (a.filesize || 0) <= MAX_ATTACH_BYTES,
      )
      .slice(0, 3);
    const isTextFile = (a) => {
      const ct = a.content_type?.toLowerCase() || '';
      return (
        textTypes.some((t) => ct.includes(t)) ||
        ct.startsWith('text/') ||
        /\.(txt|log|sql|csv|json|xml|md)$/i.test(a.filename || '')
      );
    };
    const textAtts = attachments
      .filter((a) => isTextFile(a) && (a.filesize || 0) <= 80 * 1024)
      .slice(0, 4);
    const largeTextAtts = attachments.filter((a) => isTextFile(a) && (a.filesize || 0) > 80 * 1024);
    const otherAtts = attachments.filter(
      (a) => !imageAtts.find((x) => x.id === a.id) && !textAtts.find((x) => x.id === a.id),
    );

    // Busca imagens base64
    const fetchedImages = [];
    if (hasRedmineAuth) {
      for (const att of imageAtts) {
        const img = await fetchAttachmentBase64(
          redmineUrl,
          redmineAuthHeaders,
          att.id,
          att.filename,
        );
        if (img) fetchedImages.push({ ...img, filename: att.filename });
      }
    }

    // Busca conteúdo de arquivos de texto
    const textContents = [];
    if (hasRedmineAuth) {
      for (const att of textAtts) {
        try {
          const resp = await axios.get(
            `${redmineUrl}/attachments/download/${att.id}/${encodeURIComponent(att.filename)}`,
            { headers: redmineAuthHeaders, responseType: 'text', maxContentLength: 80 * 1024 },
          );
          textContents.push({ filename: att.filename, content: resp.data.slice(0, 4000) });
        } catch (e) {
          console.warn(`[ambiguities] falha ao buscar texto ${att.filename}:`, e.message);
        }
      }
    }

    // Monta texto base do prompt
    let userText = `Analise os requisitos abaixo e identifique pontos ambíguos, incompletos ou contraditórios que podem causar retrabalho. Retorne um JSON com:
- "hasIssues": boolean — true se encontrou problemas
- "ambiguities": array de objetos com:
  - "trecho": string — o trecho exato da descrição ou do anexo que está ambíguo (copiar literal)
  - "problema": string — por que isso é ambíguo ou incompleto
  - "pergunta": string — a pergunta que o dev deveria fazer antes de codar

Se os requisitos estiverem claros e completos, retorne hasIssues: false e ambiguities: [].

Tarefa: #${issue.id} — ${issue.subject}
Tracker: ${issue.tracker?.name || ''}

Descrição:
${(issue.description || '(sem descrição)').slice(0, 2000)}`;

    if (textContents.length > 0) {
      userText += '\n\n--- ANEXOS DE TEXTO ---';
      for (const tc of textContents) {
        userText += `\n\n### ${tc.filename}\n${tc.content}`;
      }
    }
    if (largeTextAtts.length > 0) {
      userText += `\n\n⚠ Arquivos de texto grandes (não lidos automaticamente por exceder 80 KB):\n`;
      userText += largeTextAtts
        .map(
          (a) =>
            `- ${a.filename} (${Math.round((a.filesize || 0) / 1024)} KB) — considere mencionar o conteúdo relevante na descrição da tarefa`,
        )
        .join('\n');
    }
    if (otherAtts.length > 0) {
      userText += `\n\nOutros anexos presentes (não lidos): ${otherAtts.map((a) => `${a.filename} (${a.content_type})`).join(', ')}`;
    }
    if (fetchedImages.length > 0) {
      userText += `\n\nImagens em anexo (${fetchedImages.length}): ${fetchedImages.map((i) => i.filename).join(', ')} — analise-as como parte dos requisitos visuais.`;
    }

    // Monta conteúdo: texto + imagens inline
    const userContent =
      fetchedImages.length === 0
        ? userText
        : [
            { type: 'text', text: userText },
            ...fetchedImages.flatMap((img) => [
              { type: 'text', text: `\n### Imagem: ${img.filename}` },
              imageBlock(provider, img.base64, img.mediaType),
            ]),
          ];

    if (fetchedImages.length > 0 || textContents.length > 0) {
      console.log(
        `[ambiguities] ${fetchedImages.length} imagem(ns), ${textContents.length} texto(s) incluído(s)`,
      );
    }

    const result = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um analista de requisitos sênior no ERP B2click (frontend Delphi, backend Java 21). Responda APENAS com JSON válido, sem markdown.',
      userContent,
      maxTokens: 800,
      fast: false,
    });

    try {
      res.json(JSON.parse(result));
    } catch {
      res.json({ hasIssues: false, ambiguities: [], raw: result });
    }
  }),
);

// Sugestão de nota de versão seguindo o padrão B2click:
// (MÓDULO OPERACIONAL\ SUBMÓDULO\ TELA) O que foi feito
// O caminho do menu vem da própria descrição (sempre citada nas issues do ERP).
router.post(
  '/ai/suggest-version-note',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const cf = (id) => (issue.custom_fields || []).find((f) => f.id === id)?.value || '';
    const currentNote = cf(REDMINE_CF.versionNote); // Nota de versão atual

    const lastNotes = (issue.journals || [])
      .filter((j) => j.notes?.trim())
      .slice(-3)
      .map((j) => `[${j.created_on?.slice(0, 10)}] ${j.notes.trim().slice(0, 300)}`)
      .join('\n');

    const result = await aiComplete(provider, key, {
      uid,
      system:
        'Você é um desenvolvedor do ERP B2click. Responda APENAS com JSON válido, sem markdown.',
      user: `Gere uma sugestão de Nota de Versão para esta tarefa seguindo EXATAMENTE o padrão B2click:

PADRÃO: (CAMINHO DO MENU NO ERP) Descrição concisa do que foi alterado/adicionado/corrigido

Exemplos reais do padrão:
- (MODULO OPERACIONAL\\ PRODUTOS\\ A. PRODUTOS aba DADOS NAS FILIAIS) Foi adicionado o parâmetro NAO_USAR_ALIQUOTAS_IBPT para Lei 12.741
- (MODULO PADRÃO\\ CONFIGURAÇÃO\\ G. CONFIGURAÇÃO DE PDV) Adicionado novo parâmetro NÃO USAR ALÍQUOTAS DO IBPT
- (MODULO VENDAS\\ VENDAS\\ C. CONSULTA DE PEDIDO DE VENDA) Corrigido erro no envio de e-mail pelo [F6]

Regras:
- O caminho do menu DEVE vir da descrição da tarefa (ela sempre cita onde é a mudança, como "Em MODULO X\\ Y\\ Z...")
- Use \\ como separador no caminho
- A descrição deve ser curta (1 frase), no passado ("Foi adicionado", "Adicionado", "Corrigido", "Implementado")
- Se há múltiplas telas afetadas, gere uma nota por tela (retorne array)

Retorne JSON com:
- "notes": array de strings — uma nota por tela/mudança
- "reasoning": string — como você extraiu o caminho do menu e o que foi feito

${currentNote && currentNote !== '*' ? `Nota atual (para referência de estilo): ${currentNote}` : ''}

Tarefa: #${issue.id} — ${issue.subject}

Descrição:
${(issue.description || '').slice(0, 2000)}

${lastNotes ? `Histórico recente:\n${lastNotes}` : ''}`,
      maxTokens: 500,
      fast: false,
    });

    try {
      res.json(JSON.parse(result));
    } catch {
      res.json({ notes: [], reasoning: result });
    }
  }),
);

// Resumo rápido de 1 linha — para o card do Kanban.
router.post(
  '/ai/quick',
  handle(async (req, res) => {
    const { provider, key, uid } = await getAICredentials(req);
    if (!key)
      return res
        .status(400)
        .json({ error: 'Nenhuma chave de IA configurada (Configurações → IA)' });

    const { issue } = req.body;
    if (!issue) return res.status(400).json({ error: 'issue obrigatória' });

    const oneLiner = await aiComplete(provider, key, {
      uid,
      system: 'Você é um assistente de software. Responda em português do Brasil.',
      user: `Em no máximo 12 palavras, descreva o estado atual desta tarefa:
Tarefa: ${issue.subject}
Status: ${issue.status?.name}
Descrição: ${(issue.description || '').slice(0, 300)}

Retorne APENAS a frase, sem aspas, sem ponto final.`,
      maxTokens: 80,
      fast: true,
    });

    res.json({ oneLiner });
  }),
);

module.exports = router;
