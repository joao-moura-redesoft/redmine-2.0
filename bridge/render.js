// Renderiza um card de notificação 240x135 (RGB565 depois no device.js).
// Recebe um "spec" já pronto (type/title/subtitle/tag/time) e devolve um Canvas.
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

const W = 240;
const H = 135;

// Tipografia: Segoe UI (todo Windows tem). Aliases próprios pros pesos.
for (const [path, alias] of [
  ['C:/Windows/Fonts/segoeui.ttf', 'Seg'],
  ['C:/Windows/Fonts/segoeuisb.ttf', 'SegSb'],
  ['C:/Windows/Fonts/segoeuib.ttf', 'SegB'],
]) {
  try {
    GlobalFonts.registerFromPath(path, alias);
  } catch {
    /* fallback do sistema */
  }
}
const F = { reg: 'Seg', semi: 'SegSb', bold: 'SegB' };

// Cor + ícone padrão por tipo de notificação.
const TYPES = {
  talk: { accent: '#22c55e', glyph: 'initial' },
  mention: { accent: '#f59e0b', glyph: '@' },
  issue: { accent: '#ef4444', glyph: '!' },
  review: { accent: '#a855f7', glyph: '?' },
  comment: { accent: '#3b82f6', glyph: 'chat' },
  summary: { accent: '#6366f1', glyph: 'diamond' },
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

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

function wrapLines(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
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

function drawBadge(ctx, x, y, s, accent, drawGlyph) {
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
  ctx.save();
  roundRect(ctx, x, y, s, s, 14);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, x, y, s, s * 0.42, 14);
  ctx.fill();
  ctx.restore();
  drawGlyph(ctx, x + s / 2, y + s / 2, s);
}

function glyphChar(ch, scale = 0.55) {
  return (ctx, cx, cy, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(s * scale)}px ${F.bold}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, cx, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  };
}

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

function resolveIcon(spec) {
  const g = spec.glyph || TYPES[spec.type]?.glyph || 'initial';
  if (g === 'chat') return chatGlyph;
  if (g === 'initial') {
    const ch = (spec.title || '?').trim().charAt(0).toUpperCase() || '?';
    return glyphChar(ch, 0.5);
  }
  if (g === '@') return glyphChar('@', 0.62);
  if (g === '!') return glyphChar('!', 0.66);
  return glyphChar(g, 0.55);
}

function renderCard(spec) {
  const accent = spec.accent || TYPES[spec.type]?.accent || '#6366f1';
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0f17');
  bg.addColorStop(1, shade(accent, 0.28));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const bar = ctx.createLinearGradient(0, 0, 0, H);
  bar.addColorStop(0, shade(accent, 1.15));
  bar.addColorStop(1, shade(accent, 0.7));
  ctx.fillStyle = bar;
  ctx.fillRect(0, 0, 5, H);

  const bx = 13;
  const by = 18;
  const bs = 46;
  drawBadge(ctx, bx, by, bs, accent, resolveIcon(spec));

  const tx = bx + bs + 12;
  const maxW = W - tx - 12;

  ctx.textBaseline = 'alphabetic';
  let timeW = 0;
  if (spec.time) {
    ctx.font = `12px ${F.semi}`;
    timeW = ctx.measureText(spec.time).width + 8;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(spec.time, W - 12, by + 12);
    ctx.textAlign = 'left';
  }

  let ts = 21;
  ctx.font = `${ts}px ${F.bold}`;
  while (ts > 15 && ctx.measureText(spec.title).width > maxW - timeW) {
    ts -= 1;
    ctx.font = `${ts}px ${F.bold}`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(ellipsize(ctx, spec.title || '', maxW - timeW), tx, by + 18);

  ctx.font = `15px ${F.reg}`;
  ctx.fillStyle = 'rgba(213,219,233,0.92)';
  wrapLines(ctx, spec.subtitle || '', maxW, 2).forEach((ln, i) =>
    ctx.fillText(ln, tx, by + 42 + i * 19),
  );

  if (spec.tag) {
    const tag = String(spec.tag).toUpperCase();
    ctx.font = `11px ${F.bold}`;
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRect(ctx, tx, H - 24, tw + 16, 17, 8);
    ctx.fill();
    ctx.fillStyle = shade(accent, 1.25);
    ctx.fillText(tag, tx + 8, H - 11);
  }
  return canvas;
}

function renderSummary(spec) {
  const accent = spec.accent || TYPES.summary.accent;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, shade(accent, 0.5));
  bg.addColorStop(1, '#0d0f17');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(40, 42);
  ctx.rotate(Math.PI / 4);
  const g = ctx.createLinearGradient(-16, -16, 16, 16);
  g.addColorStop(0, shade(accent, 1.25));
  g.addColorStop(1, shade(accent, 0.8));
  ctx.fillStyle = g;
  roundRect(ctx, -16, -16, 32, 32, 7);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#ffffff';
  ctx.font = `26px ${F.bold}`;
  ctx.fillText(spec.title || 'Bluemine', 70, 50);

  ctx.fillStyle = 'rgba(214,220,235,0.9)';
  ctx.font = `15px ${F.semi}`;
  ctx.fillText(spec.subtitle || '', 22, 96);

  const chips = spec.chips || [];
  const margin = 22;
  const gap = 7;
  let fs = 13;
  let pad = 11;
  const total = () => {
    ctx.font = `${fs}px ${F.bold}`;
    return (
      chips.reduce((s, c) => s + ctx.measureText(c.text).width + pad * 2, 0) + gap * (chips.length - 1)
    );
  };
  while (fs > 10 && margin + total() > W - margin) {
    fs -= 1;
    pad -= 1;
  }
  ctx.font = `${fs}px ${F.bold}`;
  let px = margin;
  for (const chip of chips) {
    const cw = ctx.measureText(chip.text).width + pad * 2;
    ctx.fillStyle = shade(chip.color || accent, 0.9);
    roundRect(ctx, px, 106, cw, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(chip.text, px + pad, 121);
    px += cw + gap;
  }
  return canvas;
}

// Tela ociosa: relógio próprio do Bluemine (a tela nativa do relógio some quando
// mandamos imagem custom, e não há comando limpo pra voltar — então desenhamos o
// nosso). Atualizado periodicamente pelo bridge.
const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function renderIdle(now = new Date(), accent = '#6366f1') {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0d14');
  bg.addColorStop(1, shade(accent, 0.32));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = `60px ${F.bold}`;
  ctx.fillText(`${hh}:${mm}`, W / 2, 78);

  ctx.fillStyle = 'rgba(210,216,232,0.75)';
  ctx.font = `14px ${F.semi}`;
  const date = `${DOW[now.getDay()]}, ${now.getDate()} ${MON[now.getMonth()]}`;
  ctx.fillText(date, W / 2, 100);

  // Rodapé de marca (diamante + Bluemine).
  ctx.save();
  ctx.translate(W / 2 - 34, 118);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = shade(accent, 1.1);
  roundRect(ctx, -5, -5, 10, 10, 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = shade(accent, 1.3);
  ctx.font = `13px ${F.bold}`;
  ctx.textAlign = 'left';
  ctx.fillText('Bluemine', W / 2 - 22, 123);
  ctx.textAlign = 'left';
  return canvas;
}

function render(spec) {
  return spec.type === 'summary' || spec.kind === 'summary' ? renderSummary(spec) : renderCard(spec);
}

module.exports = { render, renderIdle, W, H };
