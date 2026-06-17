// Wrapper de handlers assíncronos: captura exceções e padroniza a resposta de erro.
const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.statusCode || err.response?.status || 500;
    
    // Log completo no backend para debug
    console.error(`[${req.method} ${req.path}] ${status}:`, err.response?.data || err.message);
    if (status >= 500) console.error(err.stack); // Loga a stack trace apenas internamente

    // Montar resposta para o cliente
    if (status >= 500) {
      // Esconde detalhes de erros críticos (500+)
      res.status(status).json({ error: 'Ocorreu um erro interno no servidor.' });
    } else {
      // Repassa erros 4xx (400, 401, 403, 404)
      const data = err.response?.data;
      if (data) {
        res.status(status).json(data);
      } else {
        res.status(status).json({ error: err.message || 'Requisição inválida.' });
      }
    }
  }
};

module.exports = handle;
