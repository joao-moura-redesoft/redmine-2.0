// --- Sincronizacao com o Concierge (app Delphi local) ---
// Quando uma issue vai para "Em andamento", aponta a tarefa no Concierge
// automaticamente, rodando o agente PowerShell (fire-and-forget).
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// __dirname aqui é server/services, então sobe dois níveis até a raiz do repo.
const CONCIERGE_SCRIPT = path.join(__dirname, '..', '..', 'automation', 'concierge-set-task.ps1');
// nome do status considerado "em andamento" (regex, configuravel por env)
const CONCIERGE_INPROGRESS_RE = new RegExp(process.env.CONCIERGE_INPROGRESS || 'andamento|progress', 'i');
const CONCIERGE_ENABLED = process.env.CONCIERGE_AUTOMATION !== '0'; // ligado por padrao

function syncConcierge(taskId, subject) {
  if (!CONCIERGE_ENABLED) return;
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(CONCIERGE_SCRIPT)) return;
  try {
    const args = ['-ExecutionPolicy', 'Bypass', '-File', CONCIERGE_SCRIPT, '-TaskId', String(taskId)];
    if (subject) args.push('-ExpectTitle', subject);
    const child = spawn('powershell', args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (e) => console.error('[concierge] spawn falhou:', e.message));
    child.unref();
    console.log(`[concierge] sincronizando tarefa ${taskId}${subject ? ` (${subject})` : ''}`);
  } catch (e) {
    console.error('[concierge] erro ao sincronizar:', e.message);
  }
}

module.exports = { syncConcierge, CONCIERGE_INPROGRESS_RE };
