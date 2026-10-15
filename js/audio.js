// Sonido sintetizado con WebAudio: zumbido ambiental, cartas, fichas, golpes.
// Nada que descargar ni licenciar.

let ctx = null, master = null, noiseBuf = null, muted = false;
const VOL = 0.7;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : VOL;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ambience();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : VOL, ctx.currentTime, 0.05);
  return muted;
}

function noise(dur, { type = 'bandpass', freq = 2000, q = 1, gain = 0.3, at = 0 } = {}) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone(freq, dur, { type = 'sine', gain = 0.2, at = 0, slide = 0 } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function ambience() {
  // Dron grave que respira.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 4;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  for (const f of [41.2, 41.6, 61.7]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(lp); o.start();
  }
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const lg = ctx.createGain();
  lg.gain.value = 70;
  lfo.connect(lg).connect(lp.frequency);
  lfo.start();
  lp.connect(g).connect(master);

  // Rumor de la sala + zumbido eléctrico de 50 Hz.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf; src.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass'; nf.frequency.value = 350;
  const ng = ctx.createGain();
  ng.gain.value = 0.035;
  src.connect(nf).connect(ng).connect(master);
  src.start();
  const hum = ctx.createOscillator();
  hum.type = 'square'; hum.frequency.value = 50;
  const hf = ctx.createBiquadFilter();
  hf.type = 'bandpass'; hf.frequency.value = 150; hf.Q.value = 6;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hum.connect(hf).connect(hg).connect(master);
  hum.start();

  // Golpes lejanos de vez en cuando.
  const knock = () => {
    if (!muted) { tone(48, 0.6, { gain: 0.25, slide: 0.6 }); noise(0.3, { type: 'lowpass', freq: 200, gain: 0.15 }); }
    setTimeout(knock, 25000 + Math.random() * 35000);
  };
  setTimeout(knock, 15000);
}

const play = fn => (...a) => { if (ctx && !muted) fn(...a); };

export const sfx = {
  card: play(() => { noise(0.08, { freq: 2600, q: 0.8, gain: 0.4 }); noise(0.04, { type: 'highpass', freq: 5000, gain: 0.15, at: 0.03 }); }),
  flip: play(() => { noise(0.14, { freq: 1500, q: 0.6, gain: 0.35 }); }),
  chip: play(() => { for (let i = 0; i < 3; i++) tone(2200 + Math.random() * 1400, 0.07, { type: 'triangle', gain: 0.07, at: i * 0.045 }); }),
  turn: play(() => { tone(660, 0.6, { gain: 0.1 }); tone(990, 0.7, { gain: 0.05, at: 0.02 }); }),
  win: play(() => { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.28, { type: 'square', gain: 0.045, at: i * 0.09 })); }),
  lose: play(() => { tone(90, 0.7, { gain: 0.5, slide: 0.4 }); noise(0.35, { type: 'lowpass', freq: 400, gain: 0.4 }); }),
  bust: play(() => { tone(150, 0.45, { type: 'sawtooth', gain: 0.13, slide: 0.3 }); noise(0.3, { type: 'lowpass', freq: 800, gain: 0.3 }); }),
  buzz: play(() => { tone(100, 0.2, { type: 'sawtooth', gain: 0.035 }); tone(150, 0.18, { type: 'square', gain: 0.015 }); }),
  type: play(() => { noise(0.02, { freq: 3200, q: 2, gain: 0.05 }); }),
  thump: play(() => { tone(55, 0.6, { gain: 0.6, slide: 0.5 }); noise(0.2, { type: 'lowpass', freq: 300, gain: 0.3 }); }),
  // Corredera de la escopeta: "chk-chk".
  pump: play(() => {
    for (const at of [0, 0.22]) {
      noise(0.06, { freq: 1800, q: 3, gain: 0.6, at });
      tone(320, 0.05, { type: 'square', gain: 0.08, at });
      noise(0.04, { type: 'highpass', freq: 4000, gain: 0.25, at: at + 0.05 });
    }
  }),
  // Disparo: golpe seco, cuerpo grave y cola de eco.
  gunshot: play(() => {
    noise(0.5, { type: 'lowpass', freq: 4000, gain: 1.2 });
    noise(0.12, { type: 'highpass', freq: 2500, gain: 0.8 });
    tone(80, 0.6, { gain: 1.0, slide: 0.35 });
    noise(1.8, { type: 'lowpass', freq: 500, gain: 0.35, at: 0.05 });
  }),
  // Pitido de oídos para quien recibe el disparo.
  ring: play(() => { tone(3600, 3.5, { gain: 0.05 }); }),
};
