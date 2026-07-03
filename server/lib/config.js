// Configuração central do Bluemine.
//
// Reúne num só lugar dois grupos de "números mágicos" que antes estavam
// espalhados por ai.js, routes/ai.js, routes/issues.js e services/push.js:
//
//  1. IDs de campos custom e de status do Redmine — acoplam o app a UMA
//     instância/config do Redmine (a da B2click). Centralizar aqui permite
//     apontar para outra instância só por env var, sem caçar constantes.
//  2. Model IDs dos provedores de IA — mudam quando um provider deprecia um
//     modelo; ter um ponto único evita drift silencioso.
//
// Tudo é sobrescrevível por variável de ambiente (.env ao lado do .exe).

const int = (envName, fallback) => {
  const v = parseInt(process.env[envName], 10);
  return Number.isFinite(v) ? v : fallback;
};
const str = (envName, fallback) => process.env[envName]?.trim() || fallback;

// ── Campos custom do Redmine (cf_<id>) ──────────────────────────────────────
// Rótulos entre parênteses são os do Redmine da B2click.
const REDMINE_CF = {
  branch: int('RM_CF_BRANCH', 140), // Branch
  developer: int('RM_CF_DEVELOPER', 141), // DEV Desenvolvedor(a)
  reviewer: int('RM_CF_REVIEWER', 210), // DEV Revisor
  versionNote: int('RM_CF_VERSION_NOTE', 213), // Nota de versão
  forecast: int('RM_CF_FORECAST', 228), // Previsão revisão
  impact: int('RM_CF_IMPACT', 229), // Impacto (módulos)
};

// ── Status do Redmine (status_id) ───────────────────────────────────────────
const REDMINE_STATUS = {
  pendingReview: int('RM_STATUS_PENDING_REVIEW', 71), // Pendente Revisão
  pendingFix: int('RM_STATUS_PENDING_FIX', 34), // Pendente Correção (voltou da revisão)
};

// ── Modelos de IA ───────────────────────────────────────────────────────────
// `default` = qualidade; `fast` = respostas curtas/baratas (resumos de 1 linha,
// standup, etc.); `vision` = quando há imagem inline.
const AI_MODELS = {
  anthropic: {
    default: str('AI_MODEL_ANTHROPIC', 'claude-sonnet-4-6'),
    fast: str('AI_MODEL_ANTHROPIC_FAST', 'claude-haiku-4-5-20251001'),
  },
  openai: {
    default: str('AI_MODEL_OPENAI', 'gpt-4o-mini'),
    fast: str('AI_MODEL_OPENAI_FAST', 'gpt-4o-mini'),
    vision: str('AI_MODEL_OPENAI_VISION', 'gpt-4o'),
    transcribe: str('AI_MODEL_OPENAI_TRANSCRIBE', 'whisper-1'),
  },
  gemini: {
    default: str('AI_MODEL_GEMINI', 'gemini-3.1-pro-preview'),
    fast: str('AI_MODEL_GEMINI_FAST', 'gemini-3.5-flash'),
  },
  // Provider "local"/on-prem OpenAI-compatible (Ollama, vLLM, LM Studio...).
  local: {
    default: str('AI_MODEL_LOCAL', 'llama3.1'),
    fast: str('AI_MODEL_LOCAL_FAST', str('AI_MODEL_LOCAL', 'llama3.1')),
    vision: str('AI_MODEL_LOCAL_VISION', str('AI_MODEL_LOCAL', 'llama3.1')),
    baseURL: str('AI_LOCAL_BASE_URL', 'http://127.0.0.1:11434/v1'),
  },
};

module.exports = { REDMINE_CF, REDMINE_STATUS, AI_MODELS };
