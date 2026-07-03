import { describe, it, expect, vi } from 'vitest';
import errorMiddleware from './errorMiddleware.js';
import AppError from './AppError.js';

function mockRes() {
  const res = { statusCode: 0, body: null };
  res.status = vi.fn((c) => {
    res.statusCode = c;
    return res;
  });
  res.json = vi.fn((b) => {
    res.body = b;
    return res;
  });
  return res;
}
const req = { method: 'GET', path: '/api/x' };

describe('errorMiddleware', () => {
  it('repassa mensagem de AppError (isSafe)', () => {
    const res = mockRes();
    errorMiddleware(new AppError(400, 'mensagem segura'), req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'mensagem segura' });
  });

  it('esconde detalhes internos em erro 500', () => {
    const res = mockRes();
    const err = new Error('stack secreta com detalhes internos');
    errorMiddleware(err, req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Ocorreu um erro interno no servidor.' });
  });

  it('normaliza 401/403 numa mensagem genérica de credenciais', () => {
    const res = mockRes();
    errorMiddleware({ response: { status: 403, data: { secret: 'x' } } }, req, res, () => {});
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Credenciais inválidas ou sem permissão.' });
  });

  it('repassa apenas o array errors do Redmine em 4xx, nunca o corpo bruto', () => {
    const res = mockRes();
    errorMiddleware(
      { response: { status: 422, data: { errors: ['Assunto obrigatório'], secreto: 'x' } } },
      req,
      res,
      () => {},
    );
    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({ errors: ['Assunto obrigatório'] });
  });
});
