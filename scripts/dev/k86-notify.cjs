/* eslint-disable no-console */
// Renderiza notificações bonitas (240x135) e manda pra telinha do Attack Shark K86.
// Demo pra avaliar layout/legibilidade antes de integrar ao Bluemine.
//
//   npm i @napi-rs/canvas node-hid
//   node scripts/dev/k86-notify.cjs            # passa por todas (slideshow)
//   node scripts/dev/k86-notify.cjs talk       # só uma (talk|mention|issue|comment|summary)
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const k86 = require('./k86-device.cjs');

const W = k86.WIDTH; // 240
const H = k86.HEIGHT; // 135

// Tipografia: Segoe UI (existe em todo Windows). Aliases próprios pros pesos.
const FONTS = [
  ['C:/Windows/Fonts/segoeui.ttf', 'Seg'],
  ['C:/Windows/Fonts/segoeuisb.ttf', 'SegSb'],
  ['C:/Windows/Fonts/segoeuib.ttf', 'SegB'],
];
for (const [path, alias] of FONTS) {
  try {
    GlobalFonts.registerFromPath(path, alias);
  } catch {
    /* segue com fallback do sistema */
  }
}
const F = { reg: 'Seg', semi: 'SegSb', bold: 'SegB' };

// --- helpers de desenho ------------------------------------------------------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Escurece/clareia um hex por um fator (0.8 = mais escuro, 1.2 = mais claro).
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function ellipsize(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Quebra gulosa em até `maxLines` linhas dentro de maxW; se sobrar texto,
// põe reticências no fim da última linha.
function wrapLines(ctx, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    let cur = words[i++];
    while (i < words.length && ctx.measureText(cur + ' ' + words[i]).width <= maxW) {
      cur += ' ' + words[i++];
    }
    lines.push(cur);
  }
  if (i < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last + '…';
  }
  return lines;
}

// --- badge de ícone (quadrado arredondado com brilho + glifo) ---------------
function drawBadge(ctx, x, y, s, accent, draw) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  const g = ctx.createLinearGradient(x, y, x, y + s);
  g.addColorStop(0, shade(accent, 1.18));
  g.addColorStop(1, shade(accent, 0.82));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, s, s, 14);
  ctx.fill();
  ctx.restore();
  // brilho superior sutil
  ctx.save();
  roundRect(ctx, x, y, s, s, 14);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x, y, s, s * 0.42, 14);
  ctx.fill();
  ctx.restore();
  draw(ctx, x + s / 2, y + s / 2, s);
}

function glyphText(ch, font = F.bold, scale = 0.5) {
  return (ctx, cx, cy, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(s * scale)}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy + 1);
    ctx.textAlign = 'left';
  };
}

// Balão de chat vetorial (pro tipo "comment").
function chatGlyph(ctx, cx, cy, s) {
  const w = s * 0.52;
  const h = s * 0.4;
  const x = cx - w / 2;
  const y = cy - h / 2 - 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, x, y, w, h, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 3, y + h - 1);
  ctx.lineTo(cx - 10, y + h + 7);
  ctx.lineTo(cx + 4, y + h - 1);
  ctx.closePath();
  ctx.fill();
}

// --- render principal de uma notificação ------------------------------------
function renderCard(n) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fundo: gradiente escuro levemente tingido pelo accent.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0f17');
  bg.addColorStop(1, shade(n.accent, 0.28));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Barra de accent na borda esquerda.
  const bar = ctx.createLinearGradient(0, 0, 0, H);
  bar.addColorStop(0, shade(n.accent, 1.15));
  bar.addColorStop(1, shade(n.accent, 0.7));
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, 5, H);

  const bx = 13;
  const by = 18;
  const bs = 46;
  drawBadge(ctx, bx, by, bs, n.accent, n.icon);

  const tx = bx + bs + 12; // início do texto
  const maxW = W - tx - 12;

  // Hora (canto superior direito, discreta).
  ctx.textBaseline = 'alphabetic';
  let timeW = 0;
  if (n.time) {
    ctx.font = `12px ${F.semi}`;
    timeW = ctx.measureText(n.time).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(n.time, W - 12, by + 12);
    ctx.textAlign = 'left';
  }

  // Título (auto-fit) — deixa espaço pra hora na 1ª linha.
  let ts = 21;
  ctx.font = `${ts}px ${F.bold}`;
  while (ts > 15 && ctx.measureText(n.title).width > maxW - timeW) {
    ts -= 1;
    ctx.font = `${ts}px ${F.bold}`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(ellipsize(ctx, n.title, maxW - timeW), tx, by + 18);

  // Subtítulo (até 2 linhas).
  ctx.font = `15px ${F.reg}`;
  ctx.fillStyle = 'rgba(213,219,233,0.92)';
  const lines = wrapLines(ctx, n.subtitle, maxW, 2);
  lines.forEach((ln, i) => ctx.fillText(ln, tx, by + 42 + i * 19));

  // Rodapé: chip de tag em accent.
  const tag = n.tag.toUpperCase();
  ctx.font = `11px ${F.bold}`;
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = shade(n.accent, 1.1);
  roundRect(ctx, tx, H - 24, tw + 16, 17, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(ctx, tx, H - 24, tw + 16, 17, 8);
  ctx.fill();
  ctx.fillStyle = shade(n.accent, 1.25);
  ctx.fillText(tag, tx + 8, H - 11);

  return canvas;
}

// Layout especial "resumo/marca".
function renderSummary(n) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, shade(n.accent, 0.5));
  bg.addColorStop(1, '#0d0f17');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Diamante (marca Bluemine).
  ctx.save();
  ctx.translate(40, 42);
  ctx.rotate(Math.PI / 4);
  const g = ctx.createLinearGradient(-16, -16, 16, 16);
  g.addColorStop(0, shade(n.accent, 1.25));
  g.addColorStop(1, shade(n.accent, 0.8));
  ctx.fillStyle = g;
  roundRect(ctx, -16, -16, 32, 32, 7);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = `26px ${F.bold}`;
  ctx.fillText(n.title, 70, 50);

  ctx.fillStyle = 'rgba(214,220,235,0.9)';
  ctx.font = `15px ${F.semi}`;
  ctx.fillText(n.subtitle, 22, 96);

  // Pílulas de contagem — auto-encolhe pra caber na largura.
  const margin = 22;
  const gap = 7;
  let fs = 13;
  let pad = 11;
  const total = () => {
    ctx.font = `${fs}px ${F.bold}`;
    return n.chips.reduce((s, c) => s + ctx.measureText(c.text).width + pad * 2, 0) + gap * (n.chips.length - 1);
  };
  while (fs > 10 && margin + total() > W - margin) {
    fs -= 1;
    pad -= 1;
  }
  ctx.font = `${fs}px ${F.bold}`;
  let px = margin;
  for (const chip of n.chips) {
    const cw = ctx.measureText(chip.text).width + pad * 2;
    ctx.fillStyle = shade(chip.color, 0.9);
    roundRect(ctx, px, 106, cw, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(chip.text, px + pad, 121);
    px += cw + gap;
  }
  return canvas;
}

// --- notificações de exemplo -------------------------------------------------
const SAMPLES = {
  talk: {
    kind: 'card',
    accent: '#22c55e',
    icon: glyphText('M', F.bold, 0.5),
    title: 'Maria Silva',
    subtitle: 'vamos revisar o PR do Kanban hoje de tarde?',
    tag: 'Talk • DM',
    time: '9:42',
  },
  mention: {
    kind: 'card',
    accent: '#f59e0b',
    icon: glyphText('@', F.bold, 0.62),
    title: 'Você foi mencionado',
    subtitle: 'João: @você consegue olhar o bug do login?',
    tag: '# geral',
    time: '9:40',
  },
  issue: {
    kind: 'card',
    accent: '#ef4444',
    icon: glyphText('!', F.bold, 0.66),
    title: 'Bug no login intermitente',
    subtitle: 'Atribuída a você • Prioridade Alta',
    tag: 'Issue #4821',
    time: '9:38',
  },
  comment: {
    kind: 'card',
    accent: '#3b82f6',
    icon: chatGlyph,
    title: 'Novo comentário',
    subtitle: 'Pedro em #4821: subi um fix, pode testar aí',
    tag: 'Comentário',
    time: '9:35',
  },
  summary: {
    kind: 'summary',
    accent: '#6366f1',
    title: 'Bluemine',
    subtitle: 'Você tem novidades',
    chips: [
      { text: '3 issues', color: '#ef4444' },
      { text: '2 no Talk', color: '#22c55e' },
      { text: '1 menção', color: '#f59e0b' },
    ],
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const which = process.argv[2] || 'talk';
  // 'all' = slideshow (uma imagem por vez, com folga pro device gravar em flash).
  const order = which === 'all' ? ['summary', 'talk', 'mention', 'issue', 'comment'] : [which];
  for (const key of order) {
    if (!SAMPLES[key]) {
      console.error(`Tipo desconhecido: ${key}. Use: ${Object.keys(SAMPLES).join(', ')}, all`);
      process.exit(1);
    }
  }

  const dev = k86.open();
  try {
    for (let i = 0; i < order.length; i++) {
      const n = SAMPLES[order[i]];
      const canvas = n.kind === 'summary' ? renderSummary(n) : renderCard(n);
      k86.sendCanvas(dev, canvas);
      console.log(`[${i + 1}/${order.length}] enviado: ${order[i]}`);
      if (i < order.length - 1) await sleep(6000); // folga pra tela assentar
    }
  } finally {
    dev.close();
  }
  console.log('Pronto.');
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { SAMPLES, renderCard, renderSummary, W, H };
