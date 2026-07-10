// Resolvedor de variáveis {{ }} — portado do Twenty
// (twenty-shared/src/utils/variable-resolver.ts), adaptado ao nosso contexto de
// automações: { issue, room, message, event, user, now }.
//
// Regras (iguais ao Twenty):
// - String que é APENAS um token ("{{issue.id}}") → devolve o valor cru/tipado.
// - String com token no meio ("#{{issue.id}} x") → interpola (objetos viram JSON).
// - Percorre arrays/objetos recursivamente (ex.: headers de webhook, body).

const VARIABLE_PATTERN = /\{\{([^{}]+)\}\}/g;

// Caminha um path "a.b.c" no contexto. Retorna undefined se algum nível faltar.
function evalPath(path, context) {
  const parts = String(path).trim().split('.');
  let cur = context;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveString(input, context) {
  const matched = input.match(VARIABLE_PATTERN);
  if (!matched || matched.length === 0) return input;

  // Token único que ocupa a string toda → preserva o tipo do valor.
  if (matched.length === 1 && matched[0] === input) {
    const inner = input.slice(2, -2); // remove {{ }}
    const val = evalPath(inner, context);
    return val === undefined ? '' : val;
  }

  // Caso contrário, interpola tudo como texto.
  return input.replace(VARIABLE_PATTERN, (_m, expr) => {
    const val = evalPath(expr, context);
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  });
}

function resolveInput(input, context) {
  if (input == null) return input;
  if (typeof input === 'string') return resolveString(input, context);
  if (Array.isArray(input)) return input.map((v) => resolveInput(v, context));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = resolveInput(v, context);
    return out;
  }
  return input;
}

module.exports = { resolveInput, evalPath };
