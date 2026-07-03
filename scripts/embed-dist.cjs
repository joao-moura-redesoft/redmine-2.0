// Gera server/dist-embedded.cjs a partir da pasta do frontend compilado.
//
// O módulo gerado exporta { assets: { '/index.html': '<base64>', ... } }. É
// consumido por server/lib/staticAssets.js e embutido no bundle do servidor no
// build SEA, tornando o executável realmente single-file (frontend incluso).
//
// Uso: node scripts/embed-dist.cjs [srcDir] [outFile]
//   srcDir  padrão: client/dist
//   outFile padrão: server/dist-embedded.cjs
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcDir = path.resolve(root, process.argv[2] || 'client/dist');
const outFile = path.resolve(root, process.argv[3] || 'server/dist-embedded.cjs');

if (!fs.existsSync(srcDir)) {
  console.error(`[embed-dist] pasta não encontrada: ${srcDir} (rode o build do client antes)`);
  process.exit(1);
}

// Caminha recursivamente e devolve os caminhos de arquivo relativos ao srcDir.
function walk(dir, base = dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, out);
    else out.push(full);
  }
  return out;
}

const files = walk(srcDir);
const assets = {};
let totalBytes = 0;
for (const full of files) {
  const rel = '/' + path.relative(srcDir, full).split(path.sep).join('/');
  const buf = fs.readFileSync(full);
  totalBytes += buf.length;
  assets[rel] = buf.toString('base64');
}

// Escreve um módulo CJS. JSON.stringify garante escaping correto do base64.
const banner =
  '// GERADO por scripts/embed-dist.cjs — NÃO EDITAR. Frontend embutido para o build SEA.\n';
fs.writeFileSync(outFile, `${banner}module.exports = { assets: ${JSON.stringify(assets)} };\n`);

console.log(
  `[embed-dist] ${files.length} arquivo(s), ${(totalBytes / 1024).toFixed(0)} KB → ${path.relative(root, outFile)}`,
);
