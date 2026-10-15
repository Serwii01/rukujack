// Todas las texturas se generan por código en <canvas>: sin archivos externos
// ni licencias. Estética limpia con neón, pero con algo de grano "lo-fi".
import * as THREE from 'three';
import { SEATS, feltPx, ARC_CZ, TABLE_W } from './layout.js';

const UI_FONT = '"Chakra Petch", "Arial Narrow", Arial, sans-serif';

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function grain(ctx, w, h, amt) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function stains(ctx, w, h, n, rgb, maxR, alpha) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 4 + Math.random() * maxR;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${alpha * (0.3 + Math.random() * 0.7)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function arcText(ctx, text, cx, cy, R, font, spacing = 0) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const widths = [...text].map(ch => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0);
  let a = -total / (2 * R);
  [...text].forEach((ch, i) => {
    a += widths[i] / (2 * R);
    ctx.save();
    ctx.translate(cx + R * Math.sin(a), cy + R * Math.cos(a));
    ctx.rotate(-a);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += widths[i] / (2 * R);
  });
}

export function felt() {
  const W = 1024, H = 608;
  const [c, ctx] = mk(W, H);
  ctx.fillStyle = '#0d3a2c';
  ctx.fillRect(0, 0, W, H);
  const [cx, cy] = feltPx(0, ARC_CZ, W, H);
  const px = W / TABLE_W;
  const g = ctx.createRadialGradient(cx, cy + 120, 40, cx, cy + 120, W * 0.6);
  g.addColorStop(0, 'rgba(40,130,95,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  stains(ctx, W, H, 25, '0,0,0', 110, 0.25);

  ctx.fillStyle = 'rgba(232,214,160,0.75)';
  arcText(ctx, 'RUKUJACK', cx, cy, 0.86 * px, `700 30px ${UI_FONT}`, 10);
  ctx.fillStyle = 'rgba(232,214,160,0.5)';
  arcText(ctx, 'BLACKJACK PAGA 3 A 2  ·  LA BANCA PIDE CON 16', cx, cy, 1.02 * px, `500 19px ${UI_FONT}`, 2);

  // Líneas finas del tapete.
  ctx.strokeStyle = 'rgba(232,214,160,0.35)';
  ctx.lineWidth = 2;
  for (const r of [0.74, 1.12, 1.98]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * px, 0.1, Math.PI - 0.1);
    ctx.stroke();
  }

  // Casillas de apuesta, una por asiento con su color.
  for (const s of SEATS) {
    const [x, y] = feltPx(s.chip.x, s.chip.z, W, H);
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, 24, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  grain(ctx, W, H, 14);
  return toTex(c);
}

export function leather() {
  const [c, ctx] = mk(128, 128);
  ctx.fillStyle = '#16161b';
  ctx.fillRect(0, 0, 128, 128);
  stains(ctx, 128, 128, 12, '40,40,50', 20, 0.4);
  grain(ctx, 128, 128, 16);
  return toTex(c, [8, 1]);
}

export function wall() {
  const S = 512;
  const [c, ctx] = mk(S, S);
  ctx.fillStyle = '#121318';
  ctx.fillRect(0, 0, S, S);
  // Paneles acústicos verticales.
  for (let x = 0; x < S; x += 32) {
    const v = 14 + Math.floor(Math.random() * 6);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
    ctx.fillRect(x + 2, 0, 28, S);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, 0, 2, S);
  }
  stains(ctx, S, S, 14, '0,0,0', 90, 0.35);
  grain(ctx, S, S, 14);
  return toTex(c, [6, 2]);
}

export function floor() {
  const S = 256;
  const [c, ctx] = mk(S, S);
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, S, S);
  stains(ctx, S, S, 20, '30,30,36', 50, 0.4);
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= S; i += 64) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
  }
  grain(ctx, S, S, 12);
  return toTex(c, [6, 6]);
}

// Visera del crupier: dos "ojos" de luz sobre una banda negra. Se tiñe con el
// color del material y se desplaza (offset.x) para mirar a un lado u otro.
export function visor() {
  const [c, ctx] = mk(256, 32);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 32);
  for (const x of [104, 152]) {
    const g = ctx.createRadialGradient(x, 16, 1, x, 16, 18);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 20, 0, 40, 32);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(0, 15, 256, 2);
  const t = toTex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

const RED = new Set(['♥', '♦']);
const faceCache = new Map();
const CW = 128, CH = 180;

function cardShape(ctx, fill) {
  ctx.clearRect(0, 0, CW, CH);
  roundRect(ctx, 2, 2, CW - 4, CH - 4, 12);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function cardFace(r, s) {
  const key = r + s;
  if (faceCache.has(key)) return faceCache.get(key);
  const [c, ctx] = mk(CW, CH);
  cardShape(ctx, '#f3f0e8');
  const col = RED.has(s) ? '#d3203d' : '#17181d';
  const sym = s + '︎';
  ctx.fillStyle = col;
  const corner = () => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 38px ${UI_FONT}`;
    ctx.fillText(r, 26, 44);
    ctx.font = '28px Arial, sans-serif';
    ctx.fillText(sym, 26, 72);
  };
  corner();
  ctx.save();
  ctx.translate(CW, CH);
  ctx.rotate(Math.PI);
  corner();
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('JQK'.includes(r)) {
    roundRect(ctx, 40, 52, 56, 76, 6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.font = `700 50px ${UI_FONT}`;
    ctx.fillText(r, CW / 2 + 4, CH / 2);
  } else {
    ctx.font = '74px Arial, sans-serif';
    ctx.fillText(sym, CW / 2 + 4, CH / 2 + 4);
  }
  grain(ctx, CW, CH, 10);
  const t = toTex(c);
  faceCache.set(key, t);
  return t;
}

let blankTex = null;
export function cardBlank() {
  if (blankTex) return blankTex;
  const [c, ctx] = mk(CW, CH);
  cardShape(ctx, '#f3f0e8');
  blankTex = toTex(c);
  return blankTex;
}

export function cardBack() {
  const [c, ctx] = mk(CW, CH);
  cardShape(ctx, '#14151d');
  ctx.save();
  roundRect(ctx, 10, 10, CW - 20, CH - 20, 8);
  ctx.clip();
  ctx.strokeStyle = 'rgba(56,240,255,0.25)';
  ctx.lineWidth = 2;
  for (let i = -CH; i < CW + CH; i += 10) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + CH, CH); ctx.stroke();
  }
  ctx.restore();
  roundRect(ctx, 10, 10, CW - 20, CH - 20, 8);
  ctx.strokeStyle = '#38f0ff';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#14151d';
  ctx.beginPath(); ctx.arc(CW / 2, CH / 2, 28, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff3d7f';
  ctx.stroke();
  ctx.fillStyle = '#ff3d7f';
  ctx.font = `700 30px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('21', CW / 2, CH / 2 + 2);
  grain(ctx, CW, CH, 10);
  return toTex(c);
}

export function neon(text, color) {
  const [c, ctx] = mk(512, 128);
  ctx.font = `700 84px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) ctx.fillText(text, 256, 68);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(text, 256, 68);
  return toTex(c);
}
