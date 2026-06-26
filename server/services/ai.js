// IA — abstração de provider (Anthropic/OpenAI/Gemini), prompts, e ferramentas do chat agêntico.
// A key é configurada por usuário no cliente e enviada via header; o servidor é só proxy.
// Gemini reaproveita o SDK da OpenAI via endpoint compatível (suporta vision e tool-calling).
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// Endpoint OpenAI-compatible do Gemini (Google AI Studio).
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

// Cria um client compatível com a API da OpenAI. Para o Gemini, aponta o baseURL
// para o endpoint do Google — o resto da chamada (chat.completions, tools, vision) é idêntico.
function makeOpenAIClient(provider, key) {
  if (provider === 'gemini') return new OpenAI({ apiKey: key, baseURL: GEMINI_BASE_URL });
  return new OpenAI({ apiKey: key });
}

// Modelo a usar para o chat agêntico (tool-use) por provider.
// Gemini Pro exige billing habilitado (no free tier dá 429 com limit: 0).
function chatModel(provider) {
  return provider === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-4o';
}
const doku = require('../dokuwiki');
const zimbra = require('../zimbra');
const { getMyUserId } = require('../lib/redmine');
const { userNotes, saveNotes } = require('./notesStore');

// Resolve um ID de usuário do Redmine para o nome completo.
// Retorna o próprio valor se não for um ID numérico ou se a chamada falhar.
async function resolveUserName(redmine, value) {
  if (!value || !/^\d+$/.test(String(value).trim())) return value;
  try {
    const { data } = await redmine.get(`/users/${value}.json`);
    const u = data.user;
    return u ? `${u.firstname} ${u.lastname}`.trim() : value;
  } catch { return value; }
}

// inlineImageNames: set de filenames já enviados inline — excluídos da lista de texto
// para não confundir o modelo (ele já vê as imagens, não precisa do metadado duplicado).
// revisorName: nome já resolvido (passado pelo endpoint para evitar async aqui).
function buildIssueContext(issue, inlineImageNames = new Set(), revisorName = '') {
  const cf = (id) => (issue.custom_fields || []).find(f => f.id === id)?.value || '';
  const branch    = cf(140);
  const revisor   = revisorName || cf(210);
  const notaVersao = cf(213);
  const impacto   = cf(229);
  const previsao  = cf(228);

  const journalLines = (issue.journals || [])
    .filter(j => j.notes?.trim() || j.details?.some(d => d.property === 'attr' && d.name === 'status_id'))
    .slice(-8)
    .map(j => {
      const st = j.details?.find(d => d.property === 'attr' && d.name === 'status_id');
      const parts = [];
      if (st) parts.push(`mudou status → ${st.new_value}`);
      if (j.notes?.trim()) parts.push(j.notes.trim().slice(0, 400));
      return `[${j.created_on?.slice(0, 10)}] ${j.user?.name || '?'}: ${parts.join(' | ')}`;
    }).join('\n');

  // Separa anexos: os que vão inline (imagens já enviadas) vs os demais (listados em texto).
  const otherAttachments = (issue.attachments || [])
    .filter(a => !inlineImageNames.has(a.filename))
    .map(a => `- ${a.filename} (${a.content_type}, ${Math.round((a.filesize || 0) / 1024)}KB)`)
    .join('\n');

  const inlineNote = inlineImageNames.size > 0
    ? `\nImagens enviadas inline (${inlineImageNames.size}): ${[...inlineImageNames].join(', ')}`
    : '';

  return [
    `Tarefa: #${issue.id} — ${issue.subject}`,
    `Status: ${issue.status?.name} | Prioridade: ${issue.priority?.name} | Projeto: ${issue.project?.name}`,
    branch     && `Branch: ${branch}`,
    revisor    && `Revisor: ${revisor}`,
    impacto    && `Impacto: ${impacto}`,
    notaVersao && `Nota de versão: ${notaVersao}`,
    previsao   && `Previsão revisão: ${previsao}`,
    '',
    'Descrição:',
    (issue.description || '(sem descrição)').slice(0, 2000),
    journalLines && `\nHistórico:\n${journalLines}`,
    inlineNote,
    otherAttachments && `\nOutros anexos (não disponíveis inline):\n${otherAttachments}`,
  ].filter(Boolean).join('\n');
}

// Resolve provider + key do cofre cifrado server-side (por usuário do Redmine).
// Precedência do provider: Claude > OpenAI > Gemini (igual ao cliente antigo).
async function getAICredentials(req) {
  const { getMyUserId } = require('../lib/redmine');
  const { getAi } = require('./secretsStore');
  let ai = {};
  try {
    const uid = await getMyUserId(req);
    if (uid) ai = getAi(uid) || {};
  } catch { /* sem chaves no cofre */ }
  let provider = 'anthropic';
  if (ai.anthropic) provider = 'anthropic';
  else if (ai.openai) provider = 'openai';
  else if (ai.gemini) provider = 'gemini';
  return { provider, key: ai[provider] || '' };
}

// Chave da OpenAI especificamente (Whisper/transcrição), do cofre.
async function getOpenAIKey(req) {
  const { getMyUserId } = require('../lib/redmine');
  const { getAi } = require('./secretsStore');
  try {
    const uid = await getMyUserId(req);
    return (uid ? getAi(uid).openai : '') || '';
  } catch { return ''; }
}

// Busca um anexo do Redmine e devolve { base64, mediaType } ou null se falhar/muito grande.
const MAX_ATTACH_BYTES = 5 * 1024 * 1024; // 5 MB
async function fetchAttachmentBase64(redmineUrl, authHeaders, attachId, filename) {
  try {
    const resp = await axios.get(
      `${redmineUrl}/attachments/download/${attachId}/${encodeURIComponent(filename)}`,
      { headers: authHeaders, responseType: 'arraybuffer', maxContentLength: MAX_ATTACH_BYTES }
    );
    return {
      base64: Buffer.from(resp.data).toString('base64'),
      mediaType: resp.headers['content-type']?.split(';')[0].trim() || 'image/jpeg',
    };
  } catch (e) {
    console.warn(`[ai] falha ao buscar anexo ${filename}:`, e.message);
    return null;
  }
}

// Bloco de imagem no formato do provider.
function imageBlock(provider, base64, mediaType) {
  if (provider === 'anthropic') {
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
  }
  // OpenAI / Gemini (endpoint compatível)
  return { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } };
}

// Chama o modelo correto e retorna o texto gerado.
// `userContent` aceita array multimodal (texto + imagens); `user` aceita string simples.
async function aiComplete(provider, key, { system, user, userContent, maxTokens = 2048, fast = false }) {
  const content = userContent ?? user;

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    const model = fast ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
    const msg = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });
    return msg.content[0]?.text?.trim() || '';
  }

  if (provider === 'openai' || provider === 'gemini') {
    const client = makeOpenAIClient(provider, key);
    const hasImages = Array.isArray(content) && content.some(c => c.type === 'image_url');
    // OpenAI: sobe para gpt-4o quando há imagens (o mini ignora a instrução de descrever).
    // Gemini: flash no modo rápido, pro caso contrário (Pro exige billing habilitado).
    const model = provider === 'gemini'
      ? (fast ? 'gemini-3.5-flash' : 'gemini-3.1-pro-preview')
      : ((hasImages && !fast) ? 'gpt-4o' : 'gpt-4o-mini');
    const msg = await client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    });
    return msg.choices[0]?.message?.content?.trim() || '';
  }

  throw new Error(`provider desconhecido: ${provider}`);
}

// Transcreve áudio via OpenAI Whisper. Recebe um Buffer e devolve o texto.
// Só OpenAI por enquanto (Anthropic não transcreve; o endpoint compatível do
// Gemini não expõe /audio/transcriptions).
async function transcribeAudio(key, buffer, filename = 'meeting.webm', mime = 'audio/webm') {
  const client = new OpenAI({ apiKey: key });
  const file = await OpenAI.toFile(buffer, filename, { type: mime });
  const resp = await client.audio.transcriptions.create({ file, model: 'whisper-1' });
  return (resp.text || '').trim();
}

const PROMPT_SYSTEM = `Você é um assistente especializado no ERP B2click (frontend Delphi, backend Java 21 com sintaxe legada).
Gere prompts autocontidos em Markdown para serem colados em outra sessão de Claude Code.
Responda APENAS com o conteúdo Markdown, sem explicações extras.`;

const PROMPT_TEMPLATE = (context) => `Com base nos dados abaixo, gere um prompt Markdown autocontido seguindo EXATAMENTE esta estrutura:

# Prompt — Tarefa #<ID> (<PRIORIDADE> — <STATUS>)

> Cole o bloco abaixo no Claude Code de destino. O Claude não tem acesso ao Redmine — todo o contexto está aqui.

---

## Contexto do Sistema
<descrição técnica do projeto — usar "ERP cliente-servidor da B2click. Frontend em Delphi, backend em Java 21 com sintaxe legada." e ajustar se o Impacto indicar tecnologia específica>

## Branch
<se há branch preenchida: "Branch existente (não criar nova): \`<branch>\`"; se não há: "Branch a criar: \`#<ID padded 6>-MAS-joao-<slug do assunto>\`">
<se há Revisor preenchido, adicionar: "Revisor: <nome>">
<se há Nota de Versão, citar>
<se há Impacto, citar>

## O Problema
<descrição da issue — preservar informações técnicas, não resumir demais>

## Comentários da revisão *(apenas se status = Pendente Correção — omitir seção caso contrário)*
> <citar literalmente a nota do revisor que voltou a tarefa>

## Histórico relevante *(apenas se houver notas técnicas relevantes no journal — omitir se vazio)*
<citar literalmente comentários técnicos do journal>

## Anexos *(apenas se houver anexos — omitir se vazio)*
<Para cada imagem recebida inline: crie uma subseção "### filename.png" com descrição factual completa — UI visível, textos na tela, mensagens de erro transcritas literalmente, campos e valores. O Claude de destino não terá acesso às imagens originais.>
<Para outros arquivos (PDFs, ZIPs, vídeos): mencione nome + tamanho e instrua o Claude de destino a solicitar o arquivo ao usuário.>

## Hipóteses Técnicas
<3-5 hipóteses inferidas do problema, marcadas como hipótese>

## Sua Tarefa
1. <passo numerado começando por checkout/criação de branch>
2. ...
<incluir: apresentar levantamento ANTES de mudar código para tarefas complexas ou Pendente Correção>
<última etapa: avisar usuário ao terminar para ele atualizar o Redmine>

## Critérios de aceite
- <bullets concretos e verificáveis>

---

DADOS DA TAREFA:
${context}`;

// Remove tags HTML e normaliza espaços — usado para entregar conteúdo de wiki
// como texto puro para a IA (mais barato e legível que HTML).
function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Resume uma mensagem do Zimbra (formato slimMessage) para a IA.
function slimMail(m) {
  const de = m.from?.name && m.from.name !== m.from.address ? `${m.from.name} <${m.from.address}>` : (m.from?.address || '?');
  return { id: m.id, de, assunto: m.subject, data: m.date ? new Date(m.date).toISOString() : null, lido: !m.unread, anexo: !!m.hasAttachment, trecho: (m.snippet || '').slice(0, 200) };
}

const CHAT_TOOLS = [
  // ── Redmine: tarefas, projetos, horas ─────────────────────────────────
  {
    name: 'buscar_tarefas',
    description: 'Busca tarefas (issues) do Redmine por texto livre (assunto, número, palavra-chave). Use para localizar tarefas.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'texto a buscar' } }, required: ['query'] },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get('/search.json', { params: { q: a.query, issues: 1, limit: 15 } });
      return (data.results || []).map(x => ({ id: x.id, titulo: x.title, atualizado: x.datetime }));
    },
  },
  {
    name: 'listar_minhas_tarefas',
    description: 'Lista as tarefas atribuídas ao usuário atual. status opcional: open (padrão), closed ou *.',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'closed', '*'] } } },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get('/issues.json', { params: { assigned_to_id: 'me', status_id: a.status || 'open', limit: 50 } });
      return (data.issues || []).map(i => ({ id: i.id, assunto: i.subject, status: i.status?.name, projeto: i.project?.name, prioridade: i.priority?.name, atualizado: i.updated_on }));
    },
  },
  {
    name: 'detalhes_tarefa',
    description: 'Detalhes de uma tarefa pelo ID, incluindo descrição e os últimos comentários do histórico.',
    input_schema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
    run: async (a, { redmine }) => {
      const { data } = await redmine.get(`/issues/${a.id}.json`, { params: { include: 'journals,attachments' } });
      const i = data.issue;
      const comentarios = (i.journals || []).filter(j => j.notes?.trim()).slice(-5)
        .map(j => ({ data: j.created_on?.slice(0, 10), autor: j.user?.name, nota: j.notes.slice(0, 800) }));
      return {
        id: i.id, assunto: i.subject, status: i.status?.name, responsavel: i.assigned_to?.name,
        autor: i.author?.name, projeto: i.project?.name, prioridade: i.priority?.name,
        descricao: (i.description || '').slice(0, 2000), criada: i.created_on, atualizada: i.updated_on, comentarios,
      };
    },
  },
  {
    name: 'listar_projetos',
    description: 'Lista os projetos disponíveis no Redmine.',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { redmine }) => {
      const { data } = await redmine.get('/projects.json', { params: { limit: 100 } });
      return (data.projects || []).map(p => ({ id: p.id, nome: p.name, identificador: p.identifier }));
    },
  },
  {
    name: 'listar_horas',
    description: 'Lista lançamentos de horas (time entries). Filtros opcionais: issue_id, from e to (datas YYYY-MM-DD).',
    input_schema: { type: 'object', properties: { issue_id: { type: 'number' }, from: { type: 'string' }, to: { type: 'string' } } },
    run: async (a, { redmine }) => {
      const params = { limit: 50 };
      if (a.issue_id) params.issue_id = a.issue_id;
      if (a.from) params.from = a.from;
      if (a.to) params.to = a.to;
      const { data } = await redmine.get('/time_entries.json', { params });
      return (data.time_entries || []).map(t => ({ id: t.id, horas: t.hours, data: t.spent_on, usuario: t.user?.name, tarefa: t.issue?.id, atividade: t.activity?.name, comentario: t.comments }));
    },
  },
  {
    name: 'usuario_atual',
    description: 'Retorna o usuário autenticado no Redmine (nome, login, email).',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { redmine }) => {
      const { data } = await redmine.get('/users/current.json');
      return { id: data.user.id, nome: `${data.user.firstname} ${data.user.lastname}`, login: data.user.login, email: data.user.mail };
    },
  },
  // ── Wiki corporativa (DokuWiki) ───────────────────────────────────────
  {
    name: 'buscar_wiki',
    description: 'Busca páginas na wiki corporativa (DokuWiki) por texto livre. Use para encontrar documentação, procedimentos e notas internas.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'texto a buscar' } }, required: ['query'] },
    run: async (a, { req }) => {
      const results = await doku.searchPages(req, a.query);
      return results.slice(0, 10).map(p => ({ id: p.id, titulo: p.title, namespace: p.namespace, trecho: p.snippet }));
    },
  },
  {
    name: 'ler_pagina_wiki',
    description: 'Lê o conteúdo de uma página da wiki (DokuWiki) pelo seu id (ex.: "namespace:pagina"). Use após buscar_wiki para obter o texto completo.',
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'id da página, ex.: "ti:backup"' } }, required: ['id'] },
    run: async (a, { req }) => {
      const html = await doku.getPageHTML(req, a.id);
      return { id: a.id, conteudo: htmlToText(html).slice(0, 6000) };
    },
  },
  // ── E-mail (Zimbra) — somente leitura ─────────────────────────────────
  {
    name: 'listar_emails',
    description: 'Lista os e-mails de uma pasta do Zimbra. folder opcional (padrão "inbox"): inbox, sent, junk, trash. Não marca como lido.',
    input_schema: { type: 'object', properties: { folder: { type: 'string' }, limit: { type: 'number' } } },
    run: async (a, { req }) => {
      const { messages = [] } = await zimbra.listMessages(req, { folder: a.folder || 'inbox', limit: Math.min(a.limit || 15, 30) });
      return messages.map(slimMail);
    },
  },
  {
    name: 'buscar_emails',
    description: 'Busca e-mails no Zimbra por texto livre (assunto, remetente, conteúdo). Não marca como lido.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    run: async (a, { req }) => {
      const { messages = [] } = await zimbra.searchMessages(req, a.query, { limit: Math.min(a.limit || 15, 30) });
      return messages.map(slimMail);
    },
  },
  {
    name: 'ler_email',
    description: 'Lê o conteúdo completo de um e-mail do Zimbra pelo id. Não marca como lido.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (a, { req }) => {
      const m = await zimbra.getMessage(req, a.id, { markRead: false });
      const fmtAddr = e => (e?.name && e.name !== e.address ? `${e.name} <${e.address}>` : e?.address || '');
      return {
        id: m.id, de: fmtAddr(m.from), para: (m.to || []).map(fmtAddr).join(', '),
        assunto: m.subject, data: m.date ? new Date(m.date).toISOString() : null,
        corpo: htmlToText(m.html || m.text || '').slice(0, 6000),
        anexos: (m.attachments || []).map(x => x.filename),
      };
    },
  },
  // ── Notas pessoais (escrita segura) ───────────────────────────────────
  {
    name: 'listar_notas',
    description: 'Lista as notas pessoais do usuário neste app.',
    input_schema: { type: 'object', properties: {} },
    run: async (_a, { req }) => {
      const uid = await getMyUserId(req);
      return userNotes(uid).map(n => ({ id: n.id, titulo: n.title, corpo: (n.body || '').slice(0, 500), tags: n.tags, fixada: n.pinned, tarefa: n.linkedIssueId }));
    },
  },
  {
    name: 'criar_nota',
    description: 'Cria uma nota pessoal para o usuário neste app. Útil para registrar lembretes, resumos ou pendências. Opcionalmente vincule a uma tarefa via linkedIssueId.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, linkedIssueId: { type: 'number' } }, required: ['body'] },
    run: async (a, { req }) => {
      const uid = await getMyUserId(req);
      const now = Date.now();
      const note = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        title: typeof a.title === 'string' ? a.title : '',
        body: typeof a.body === 'string' ? a.body : '',
        tags: Array.isArray(a.tags) ? a.tags.filter(t => typeof t === 'string') : [],
        pinned: false, color: null,
        linkedIssueId: Number.isInteger(a.linkedIssueId) ? a.linkedIssueId : null,
        linkedProjectId: null, createdAt: now, updatedAt: now,
      };
      userNotes(uid).unshift(note);
      saveNotes();
      return { ok: true, id: note.id, titulo: note.title };
    },
  },
  // ── Horas (escrita segura) ────────────────────────────────────────────
  {
    name: 'lancar_horas',
    description: 'Lança horas (time entry) em uma tarefa do Redmine. spent_on opcional (YYYY-MM-DD, padrão hoje). activity_id opcional. Confirme com o usuário antes de lançar.',
    input_schema: { type: 'object', properties: { issue_id: { type: 'number' }, hours: { type: 'number' }, comments: { type: 'string' }, spent_on: { type: 'string' }, activity_id: { type: 'number' } }, required: ['issue_id', 'hours'] },
    run: async (a, { redmine }) => {
      const time_entry = { issue_id: a.issue_id, hours: a.hours };
      if (a.comments) time_entry.comments = a.comments;
      if (a.spent_on) time_entry.spent_on = a.spent_on;
      if (a.activity_id) time_entry.activity_id = a.activity_id;
      const { data } = await redmine.post('/time_entries.json', { time_entry });
      const t = data.time_entry;
      return { ok: true, id: t.id, horas: t.hours, tarefa: t.issue?.id, data: t.spent_on };
    },
  },
];

const CHAT_SYSTEM = `Você é o assistente do Bluemine, integrado ao sistema da B2click. Responda em português do Brasil, de forma objetiva e útil.
Você tem acesso a vários subsistemas via ferramentas:
- Redmine: tarefas, projetos, horas e usuário.
- Wiki corporativa (DokuWiki): documentação e procedimentos internos (buscar_wiki, ler_pagina_wiki).
- E-mail (Zimbra): consulta de mensagens (listar_emails, buscar_emails, ler_email).
- Notas pessoais do app (listar_notas, criar_nota).
Regras:
- Use as ferramentas para obter dados REAIS. Nunca invente IDs, status, nomes, números, conteúdo de e-mails ou de wiki.
- Sempre cite tarefas no formato #ID (ex.: #83314) para ficarem clicáveis.
- Para responder sobre "como fazer X" ou procedimentos internos, prefira buscar na wiki antes de responder de memória.
- Você pode ESCREVER apenas em duas situações: criar nota pessoal (criar_nota) e lançar horas (lancar_horas). Antes de lançar horas, confirme com o usuário os valores (tarefa, horas, data).
- Você NÃO envia e-mails, NÃO altera/exclui tarefas e NÃO muda status. Se pedirem, explique gentilmente que ainda não consegue fazer isso.
- Se uma busca não retornar resultados, diga isso claramente em vez de inventar.`;

async function execChatTool(name, args, ctx) {
  const tool = CHAT_TOOLS.find(t => t.name === name);
  if (!tool) return { erro: `ferramenta desconhecida: ${name}` };
  try { return await tool.run(args || {}, ctx); }
  catch (e) { return { erro: e.response?.status ? `${e.response.status} ${e.response.statusText || ''}`.trim() : (e.message || 'falha') }; }
}

module.exports = {
  Anthropic,
  OpenAI,
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
  htmlToText,
  slimMail,
  CHAT_TOOLS,
  CHAT_SYSTEM,
  execChatTool,
};
