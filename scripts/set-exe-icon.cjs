// Grava o ícone do diamante (e metadados) num executável Windows via rcedit.
// Alvo: argumento opcional (padrão: bluemine.exe na raiz).
// IMPORTANTE: para binários do pkg, aplicar isto no BINÁRIO-BASE do cache (antes de
// empacotar), nunca no exe final — editar o exe final trunca o payload do pkg.
const path = require('path');
const mod = require('rcedit');
const rcedit = typeof mod === 'function' ? mod : (mod.rcedit || mod.default);

const root = path.join(__dirname, '..');
const target = process.argv[2] || path.join(root, 'bluemine.exe');

rcedit(target, {
  icon: path.join(root, 'build', 'bluemine.ico'),
  'version-string': {
    ProductName: 'Bluemine',
    FileDescription: 'Bluemine',
    CompanyName: 'b2click',
    LegalCopyright: 'b2click',
  },
}).then(() => console.log('Ícone aplicado em:', target))
  .catch(e => { console.error('Erro ao aplicar ícone:', e); process.exit(1); });
