// --- Sincronizacao com o Concierge ---
// Quando uma issue vai para "Em andamento", aponta a tarefa no Concierge.
//
// Dois caminhos (CONCIERGE_MODE: 'auto' | 'api' | 'win32'):
//   - api:   chama JornadaConciergeBO.trataComandoConciergeTela via b2click (headless,
//            nao precisa do app Delphi aberto). Usado quando o b2click esta configurado.
//   - win32: dirige a janela do Delphi local via Win32 (script PowerShell), digitando
//            o numero da tarefa no chat. Fallback.
//   - auto (default): api se configurado, senao win32.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const b2click = require('./b2click');

const CONCIERGE_SCRIPT = path.join(__dirname, '..', '..', 'automation', 'concierge-set-task.ps1');
const CONCIERGE_INPROGRESS_RE = new RegExp(process.env.CONCIERGE_INPROGRESS || 'andamento|progress', 'i');
const CONCIERGE_ENABLED = process.env.CONCIERGE_AUTOMATION !== '0'; // ligado por padrao
const CONCIERGE_MODE = (process.env.CONCIERGE_MODE || 'auto').toLowerCase();

// Caminho API: envia o numero da tarefa como comando do Concierge (mesmo que digitar no chat).
async function syncViaApi(taskId) {
  const po = await b2click.comandoConcierge(String(taskId));
  const ativa = po && (po.atividadeAtual || po.estagioAtual || po.ultimaMensagem);
  console.log(`[concierge] tarefa ${taskId} apontada via API${ativa ? ` (${ativa})` : ''}`);
  return po;
}

// Caminho Win32: dirige o app Delphi local (fire-and-forget).
function syncViaWin32(taskId, subject) {
  if (process.platform !== 'win32') { console.warn('[concierge] win32 indisponivel fora do Windows'); return; }
  if (!fs.existsSync(CONCIERGE_SCRIPT)) { console.warn('[concierge] script Win32 nao encontrado'); return; }
  const args = ['-ExecutionPolicy', 'Bypass', '-File', CONCIERGE_SCRIPT, '-TaskId', String(taskId)];
  if (subject) args.push('-ExpectTitle', subject);
  const child = spawn('powershell', args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (e) => console.error('[concierge] spawn falhou:', e.message));
  child.unref();
  console.log(`[concierge] sincronizando tarefa ${taskId} via Win32${subject ? ` (${subject})` : ''}`);
}

// Fire-and-forget: nunca lanca pro chamador (o handler HTTP nao espera por isso).
function syncConcierge(taskId, subject) {
  if (!CONCIERGE_ENABLED) return;

  const useApi = CONCIERGE_MODE === 'api'
    || (CONCIERGE_MODE === 'auto' && b2click.isConfigured());

  if (useApi) {
    syncViaApi(taskId).catch((e) => {
      console.error('[concierge] API falhou:', e.message);
      // em auto, se a API falhar e estivermos no Windows, tenta o Delphi local como rede de seguranca
      if (CONCIERGE_MODE === 'auto') syncViaWin32(taskId, subject);
    });
    return;
  }

  try { syncViaWin32(taskId, subject); }
  catch (e) { console.error('[concierge] erro ao sincronizar:', e.message); }
}

module.exports = { syncConcierge, CONCIERGE_INPROGRESS_RE };
