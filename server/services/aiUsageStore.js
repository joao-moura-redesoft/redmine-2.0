// Rastreio de custo/uso de IA por usuário do Redmine.
//
// Acumula tokens (entrada/saída) e nº de chamadas por provider e por dia, para
// o usuário ver quanto está gastando e para servir de base ao "teto de custo de
// IA por usuário" previsto na centralização (docs/CENTRALIZACAO-SERVIDOR-UNICO.md).
//
// Estrutura: { [uid]: { total: {...}, byProvider: { anthropic: {...} },
//                        daily: { '2026-07-03': {...} } } }
const { createJsonStore } = require('../lib/jsonStore');

// Não é segredo (só contadores), mas mora junto dos demais dados por-usuário.
const store = createJsonStore('ai-usage.json', { fallback: {}, encrypted: false });

const today = () => new Date().toISOString().slice(0, 10);

function blank() {
  return { calls: 0, inputTokens: 0, outputTokens: 0 };
}
function add(bucket, inTok, outTok) {
  bucket.calls += 1;
  bucket.inputTokens += inTok || 0;
  bucket.outputTokens += outTok || 0;
}

// Registra uma chamada. `usage` é normalizado ({ inputTokens, outputTokens }).
function record(uid, provider, usage = {}) {
  if (!uid) return;
  const inTok = usage.inputTokens || 0;
  const outTok = usage.outputTokens || 0;
  const u = store.data[uid] || (store.data[uid] = { total: blank(), byProvider: {}, daily: {} });
  add(u.total, inTok, outTok);
  add((u.byProvider[provider] ||= blank()), inTok, outTok);
  const d = today();
  add((u.daily[d] ||= blank()), inTok, outTok);
  // Poda diários com mais de 90 dias para o arquivo não crescer sem limite.
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const day of Object.keys(u.daily)) if (day < cutoff) delete u.daily[day];
  try {
    store.save();
  } catch {
    /* contadores não valem derrubar o processo */
  }
}

// Extrai { inputTokens, outputTokens } da resposta de qualquer SDK.
function usageFrom(resp) {
  if (!resp) return {};
  // Anthropic: resp.usage.{input_tokens,output_tokens}
  if (resp.usage?.input_tokens != null) {
    return { inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens };
  }
  // OpenAI/Gemini/local: resp.usage.{prompt_tokens,completion_tokens}
  if (resp.usage?.prompt_tokens != null) {
    return { inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens };
  }
  return {};
}

function summary(uid) {
  return store.data[uid] || { total: blank(), byProvider: {}, daily: {} };
}

module.exports = { record, usageFrom, summary };
