# scripts/dev

Scripts ad-hoc de diagnóstico/teste manual contra a API do Redmine. **Não** fazem parte
da suíte automatizada — são executados à mão durante investigação.

## Credenciais

Os scripts que falam com o Redmine leem a chave do ambiente (nunca hardcoded):

```sh
REDMINE_API_KEY=<sua-chave> node scripts/dev/test-redmine.js
```

Variáveis suportadas:

- `REDMINE_API_KEY` (obrigatória) — chave de API do Redmine.
- `REDMINE_URL` (opcional) — base URL; default `https://redmine.b2click.com`.
- `REDMINE_ISSUE_ID` (opcional) — issue alvo dos testes; default `89521`.

> ⚠️ Uma chave de API antiga (`e238663d…`) vazou no histórico git destes arquivos e
> **deve ser rotacionada** no Redmine. Nunca cole chaves diretamente no código.

## Scripts

| Arquivo | O que faz |
| --- | --- |
| `test-redmine.js` | Bateria de PUTs em uma issue (notes, estimated_hours, custom_fields em formatos de data). |
| `test-slash.js` | Reproduz comportamento com trailing slash na base URL. |
| `test-fix.js` | Envia notes longa em Textile sem Unicode especial, com `@@Tabela`. |
| `test-long.js` | Notes longa + estimated_hours + custom_field de data. |
| `test-long-only.js` | Apenas notes longa. |
| `test-md.js` | Exercita a conversão Markdown→Textile (`client/src/utils/markdownToTextile.ts`). Sem credencial. |
