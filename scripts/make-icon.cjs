// Gera os ícones do Bluemine (diamante) a partir de build/bluemine.svg:
// - PNGs do app (favicon/PWA): client/public/icon-512.png, icon-192.png, favicon.svg
// - build/bluemine.ico (usado para gravar o ícone no executável via rcedit)
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico').default || require('png-to-ico');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build', 'bluemine.svg');
const svg = fs.readFileSync(svgPath);

function renderPng(size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

(async () => {
  // Ícones do app (front-end)
  const pub = path.join(root, 'client', 'public');
  fs.writeFileSync(path.join(pub, 'icon-512.png'), renderPng(512));
  fs.writeFileSync(path.join(pub, 'icon-192.png'), renderPng(192));
  fs.copyFileSync(svgPath, path.join(pub, 'favicon.svg'));

  // Ícone do executável (multi-resolução)
  const ico = await pngToIco([renderPng(256), renderPng(128), renderPng(64), renderPng(32), renderPng(16)]);
  fs.writeFileSync(path.join(root, 'build', 'bluemine.ico'), ico);

  console.log('Ícones gerados: icon-512/192.png, favicon.svg, build/bluemine.ico');
})().catch(e => { console.error('Erro ao gerar ícones:', e); process.exit(1); });
