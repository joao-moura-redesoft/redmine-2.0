// Troca o subsistema do PE de CONSOLE (3) para GUI/Windows (2) no executável.
//
// O bluemine.exe é um binário do Node (SEA), que é compilado no subsistema
// "Console". Ao iniciar pelo Explorer/atalho, o Windows abre uma JANELA DE
// CONSOLE mostrando os logs — indesejado, já que o app abre sua própria janela
// (Edge em app mode) e loga em arquivo (LOG_FILE). Marcando o binário como GUI,
// o Windows não cria console algum.
//
// Editamos um único campo (Subsystem) no Optional Header do PE, sem recalcular o
// CheckSum (o Windows não valida checksum para executáveis comuns, só drivers).
// Alvo: argumento opcional (padrão: bluemine.exe na raiz).
const fs = require('fs');
const path = require('path');

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3; // console

const target = process.argv[2] || path.join(__dirname, '..', 'bluemine.exe');
const buf = fs.readFileSync(target);

// MZ (0x5A4D) no início; ponteiro para o PE header em 0x3C.
if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(`Não é um PE (MZ ausente): ${target}`);
const peOff = buf.readUInt32LE(0x3c);
if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('Assinatura "PE\\0\\0" ausente');

// Optional Header = peOff + 4 (assinatura) + 20 (COFF header).
// O campo Subsystem fica no offset 68 do Optional Header — mesma posição em
// PE32 e PE32+ (o campo vem antes dos campos que divergem entre os formatos).
const subsystemOff = peOff + 4 + 20 + 68;
const current = buf.readUInt16LE(subsystemOff);

if (current === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
  console.log('Subsystem já é GUI (2); nada a fazer:', target);
} else if (current === IMAGE_SUBSYSTEM_WINDOWS_CUI) {
  buf.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, subsystemOff);
  fs.writeFileSync(target, buf);
  console.log('Subsystem alterado para GUI (2) — sem janela de console:', target);
} else {
  throw new Error(`Subsystem inesperado (${current}); abortando por segurança.`);
}
