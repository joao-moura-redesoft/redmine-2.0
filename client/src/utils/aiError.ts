// Mapeia um erro de chamada à IA (axios) para uma mensagem clara em pt-BR.
// Centraliza o tratamento usado pelos componentes de IA (painel da issue, assistente, standup).
// Distingue cota/faturamento (429), indisponibilidade (502/503), chave inválida (401/403),
// rede offline e demais casos — em vez de cair sempre numa mensagem genérica.

interface AiErrorShape {
  response?: { status?: number; data?: { error?: unknown } };
  code?: string;
}

// Extrai a mensagem do upstream quando o servidor a repassa (handle.js repassa o corpo em 4xx).
function upstreamDetail(data: { error?: unknown } | undefined): string | undefined {
  const e = data?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as any).message === 'string') {
    return (e as any).message;
  }
  return undefined;
}

export function aiErrorMessage(
  err: unknown,
  fallback = 'Erro ao chamar a IA. Tente novamente.',
): string {
  const e = err as AiErrorShape | undefined;
  const status = e?.response?.status;

  // Sem resposta do servidor → problema de rede/conexão.
  if (e && !e.response) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Sem conexão com a internet.';
    if (e.code === 'ERR_NETWORK') return 'Sem conexão com o servidor.';
  }

  const detail = upstreamDetail(e?.response?.data);

  switch (status) {
    case 401:
    case 403:
      return 'Chave de IA inválida ou sem permissão para o modelo. Verifique nas Configurações.';
    case 429:
      return 'Limite de cota da IA atingido. Verifique o faturamento (billing) e as cotas do provedor — '
        + 'no free tier do Gemini, modelos Pro/preview podem ter cota zerada. Ou tente novamente mais tarde.';
    case 502:
    case 503:
      return 'Serviço de IA temporariamente indisponível (modelo sobrecarregado). Tente novamente em instantes.';
    case 500:
      return 'Erro interno ao processar a IA. Tente novamente.';
    case 400:
      return detail ? `A IA rejeitou a requisição: ${detail}` : fallback;
    default:
      return detail || fallback;
  }
}
