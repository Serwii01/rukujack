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
  t.anisotropy = 8;
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
  const K = 2;
  const [c, ctx] = mk(W * K, H * K);
  ctx.scale(K, K);
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
  arcText(ctx, 'RUKUJACK', cx, cy, 0.86 * px, `700 34px ${UI_FONT}`, 10);
  ctx.fillStyle = 'rgba(232,214,160,0.5)';
  arcText(ctx, 'BLACKJACK PAGA 3 A 2  ·  LA BANCA PIDE CON 16', cx, cy, 1.02 * px, `600 21px ${UI_FONT}`, 2);

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
  grain(ctx, W * K, H * K, 14);
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
const CW = 128, CH = 180, CK = 2;
function mkCard() {
  const [c, ctx] = mk(CW * CK, CH * CK);
  ctx.scale(CK, CK);
  return [c, ctx];
}

function cardShape(ctx, fill) {
  ctx.clearRect(0, 0, CW, CH);
  roundRect(ctx, 2, 2, CW - 4, CH - 4, 12);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function cardFace(r, s) {
  const key = r + s;
  if (faceCache.has(key)) return faceCache.get(key);
  const [c, ctx] = mkCard();
  cardShape(ctx, '#f3f0e8');
  const col = RED.has(s) ? '#d3203d' : '#17181d';
  const sym = s + '︎';
  ctx.fillStyle = col;
  const corner = () => {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 46px ${UI_FONT}`;
    ctx.fillText(r, 27, 48);
    ctx.font = '32px Arial, sans-serif';
    ctx.fillText(sym, 27, 80);
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
  grain(ctx, CW * CK, CH * CK, 10);
  const t = toTex(c);
  faceCache.set(key, t);
  return t;
}

let blankTex = null;
export function cardBlank() {
  if (blankTex) return blankTex;
  const [c, ctx] = mkCard();
  cardShape(ctx, '#f3f0e8');
  blankTex = toTex(c);
  return blankTex;
}

export function cardBack() {
  const [c, ctx] = mkCard();
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
  grain(ctx, CW * CK, CH * CK, 10);
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

// Fichas de casino: canto con franjas blancas y cara con anillo de rombos.
const chipCache = new Map();
export function chip(color, stripe = '#f3efe6', label = 'RJ') {
  const key = color + stripe + label;
  if (chipCache.has(key)) return chipCache.get(key);
  const [s, sx] = mk(256, 16);
  sx.fillStyle = color;
  sx.fillRect(0, 0, 256, 16);
  sx.fillStyle = stripe;
  for (let i = 0; i < 8; i++) sx.fillRect(i * 32 + 6, 0, 12, 16);
  grain(sx, 256, 16, 18);

  const S = 128, [f, fx] = mk(S, S);
  fx.fillStyle = color;
  fx.fillRect(0, 0, S, S);
  fx.strokeStyle = stripe;
  fx.lineWidth = 9;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    fx.beginPath();
    fx.arc(S / 2, S / 2, S / 2 - 7, a, a + 0.32);
    fx.stroke();
  }
  fx.strokeStyle = stripe;
  fx.globalAlpha = 0.6;
  fx.lineWidth = 2;
  fx.setLineDash([4, 4]);
  fx.beginPath(); fx.arc(S / 2, S / 2, S * 0.3, 0, Math.PI * 2); fx.stroke();
  fx.setLineDash([]);
  fx.globalAlpha = 0.9;
  fx.fillStyle = stripe;
  fx.font = `700 26px ${UI_FONT}`;
  fx.textAlign = 'center';
  fx.textBaseline = 'middle';
  fx.fillText(label, S / 2, S / 2 + 2);
  fx.globalAlpha = 1;
  grain(fx, S, S, 14);

  const out = { side: toTex(s), face: toTex(f) };
  chipCache.set(key, out);
  return out;
}

// Madera oscura para el canto de la mesa y la barra.
export function wood() {
  const [c, ctx] = mk(512, 64);
  ctx.fillStyle = '#2a170d';
  ctx.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * 64, a = 0.05 + Math.random() * 0.12;
    ctx.strokeStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a * 2})` : `rgba(120,70,35,${a})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 2);
    ctx.stroke();
  }
  grain(ctx, 512, 64, 10);
  return toTex(c, [6, 1]);
}

// Canto del mazo: muchas cartas apiladas, con líneas finas de papel.
export function deckEdge() {
  const [c, ctx] = mk(64, 128);
  ctx.fillStyle = '#e9e4d8';
  ctx.fillRect(0, 0, 64, 128);
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = `rgba(60,55,45,${0.08 + Math.random() * 0.18})`;
    ctx.fillRect(0, y, 64, 1);
  }
  grain(ctx, 64, 128, 10);
  return toTex(c);
}

// Bocanada de humo: mancha suave con algo de textura.
let smokeTex = null;
export function smoke() {
  if (smokeTex) return smokeTex;
  const S = 128, [c, ctx] = mk(S, S);
  for (let i = 0; i < 9; i++) {
    const x = S / 2 + (Math.random() - 0.5) * 34, y = S / 2 + (Math.random() - 0.5) * 34, r = 26 + Math.random() * 24;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  smokeTex = toTex(c);
  return smokeTex;
}

// Fogonazo: estrella de puntas irregulares.
let flashTex = null;
export function flash() {
  if (flashTex) return flashTex;
  const S = 256, [c, ctx] = mk(S, S);
  ctx.translate(S / 2, S / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.2, 'rgba(255,210,120,0.9)');
  g.addColorStop(0.55, 'rgba(255,120,30,0.35)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i <= n * 2; i++) {
    const a = i / (n * 2) * Math.PI * 2;
    const r = i % 2 ? S * 0.12 : S * (0.3 + Math.random() * 0.2);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.fill();
  flashTex = toTex(c);
  return flashTex;
}
