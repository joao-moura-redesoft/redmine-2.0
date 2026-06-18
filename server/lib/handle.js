// Wrapper de handlers assíncronos: delega exceções ao errorMiddleware centralizado.
const handle = (fn) => async (req, res, next) => {
  try { await fn(req, res); }
  catch (err) {
    // Normaliza o status do SDK OpenAI/Gemini (err.status) para o campo padrão
    if (!err.statusCode && !err.response && err.status) err.statusCode = err.status;
    // Preserva mensagem de erro do SDK (err.error) como upstream sanitizável
    if (!err.response?.data && err.error)
      err.response = { ...err.response, data: err.error.message ? { error: err.error.message } : err.error };
    next(err);
  }
};

module.exports = handle;
