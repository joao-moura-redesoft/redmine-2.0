# Teste do Auto-Update (download, aplicação e rollback)

Guia para validar o auto-update — em especial o **rollback** (se a versão nova
não subir, o app volta sozinho para a anterior). São três níveis, do mais rápido
e determinístico ao mais completo.

> Contexto: [server/services/updater.js](../server/services/updater.js),
> [server/routes/update.js](../server/routes/update.js),
> [client/src/components/UpdateBanner.tsx](../client/src/components/UpdateBanner.tsx).
> O auto-update fica **inerte** até `UPDATE_GITHUB_REPO` ou `UPDATE_MANIFEST_URL`
> ser definido (ver README).

---

## Nível 1 — Teste automático do rollback (recomendado, ~15s)

Exercita o **watchdog real** (swap do `.exe` + relançamento + reversão) usando
"exes" dummy (`.cmd`), sem precisar de dois builds reais. É determinístico.

```powershell
node scripts/dev/test-rollback.cjs
```

Esperado: `=== RESULTADO: PASSOU ✅ ===`, cobrindo:

- **ROLLBACK** — a "nova" versão quebrada (não grava o marcador de boot) → o exe é
  restaurado para a versão anterior e ela é relançada.
- **SUCESSO** — a "nova" versão sobe (grava o marcador) → a nova é mantida e o
  backup (`.bak`) é descartado.

Também há testes de unidade dos helpers puros (semver, manifesto, release do
GitHub, `SHA256SUMS`, script do watchdog): `npm test`.

---

## Nível 2 — Marcador de boot e simulação de falha (~1min)

Confirma que uma **falha de boot não grava o marcador** — o sinal que o watchdog
usa para decidir o rollback.

1. Rode o app normalmente e confirme que o marcador é criado ao lado do executável
   (ou em `server/` no modo dev): arquivo **`.bluemine-boot-ok`** contendo a versão.
2. Rode com a flag de falha:

   ```powershell
   $env:BLUEMINE_FAIL_BOOT = '1'; node server/index.js
   ```

   Esperado: o processo sai com `[boot] BLUEMINE_FAIL_BOOT=1 — abortando...` **antes**
   do `listen`, e o `.bluemine-boot-ok` **não** é atualizado. É exatamente o cenário
   que dispara o rollback no fluxo real.

3. Limpe: `Remove-Item Env:\BLUEMINE_FAIL_BOOT`.

---

## Nível 3 — Ciclo completo com dois executáveis reais (~15min)

Valida o caminho de produção ponta a ponta, incluindo download e verificação de
SHA-256. Use um **manifesto self-hosted** (não exige GitHub).

1. **Build v1 (boa):** em `package.json`, `version: 1.0.0`. `./build_exe_sea.ps1`.
   Guarde o resultado como `bluemine-v1.exe` numa pasta de teste, com um `.env`:

   ```
   PORT=3001
   UPDATE_MANIFEST_URL=http://127.0.0.1:8080/manifest.json
   ```

2. **Build v2 (quebrada de propósito):** troque `version` para `2.0.0` e force uma
   falha antes do `listen` (ex.: adicione `throw new Error('boom')` no topo de
   `server/index.js`, **apenas para o teste**). `./build_exe_sea.ps1` →
   `bluemine-v2-broken.exe`. Calcule o SHA-256:

   ```powershell
   (Get-FileHash bluemine-v2-broken.exe -Algorithm SHA256).Hash.ToLower()
   ```

3. **Sirva o manifesto + o binário v2** (qualquer HTTP estático na porta 8080):

   ```json
   {
     "version": "2.0.0",
     "url": "http://127.0.0.1:8080/bluemine-v2-broken.exe",
     "sha256": "<hash do passo 2>",
     "notes": "Teste de rollback"
   }
   ```

4. **Rode a v1** (`bluemine-v1.exe`). No app deve surgir o banner "Nova versão 2.0.0".
   Clique **Baixar** (baixa e confere o SHA, estaciona `bluemine-v1.exe.new`) e depois
   **Reiniciar para aplicar**.

5. **Observe:** o app fecha; o watchdog instala a v2, que **falha ao subir**; após
   ~30s (`UPDATE_ROLLBACK_TIMEOUT`) o watchdog **restaura a v1** e a relança. Você
   deve terminar de volta na **v1 funcionando**, e o `.bak` some.

6. **Reverta o `throw` de teste** do passo 2. Para validar o caminho de sucesso,
   repita com uma v2 **boa** (sem o `throw`): ao aplicar, o app reabre na v2.

> Dica: ajuste `UPDATE_ROLLBACK_TIMEOUT` (segundos) para encurtar a espera do
> watchdog durante o teste.

---

## Checklist de aceitação

- [ ] `node scripts/dev/test-rollback.cjs` → PASSOU (rollback + sucesso).
- [ ] `BLUEMINE_FAIL_BOOT=1` sai antes do `listen` e não grava o marcador.
- [ ] Ciclo real: v2 quebrada → volta para v1 sozinho; v2 boa → atualiza.
- [ ] Download recusa binário com **SHA-256 divergente** (troque 1 caractere no
      manifesto e confirme o erro).
