import { Table, MIN_BET, HOST_ID, MAX_PLAYERS } from './blackjack.js';
import { HostNet, ClientNet, randomCode, normalizeCode } from './net.js';
import { Scene3D } from './scene.js';
import { SEATS, DEALER_CARDS_Z } from './layout.js';
import { initAudio, toggleMute, sfx } from './audio.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = n => String(n || '').replace(/[<>]/g, '').trim().toUpperCase().slice(0, 12) || 'ANÓNIMO';
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

// Las texturas usan la fuente de la interfaz: esperamos a que cargue (máx. 2,5 s).
await Promise.race([
  Promise.all(['700 30px "Chakra Petch"', '500 19px "Chakra Petch"'].map(f => document.fonts.load(f))).catch(() => {}),
  new Promise(r => setTimeout(r, 2500)),
]);

const scene = new Scene3D($('#view'));
scene.onBuzz = () => sfx.buzz();

let myId = null;
let state = null;
let sendMsg = () => {};
let net = null;
let roomCode = null;
let deadlineAt = 0;
let betAmount = 0;
let inGame = false;
let online = false;

// ---------- Ruido de pantalla ----------
{
  const c = $('#noise'), ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  setInterval(() => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  }, 80);
}

// ---------- Lobby ----------
const nameInput = $('#name'), codeInput = $('#code');
nameInput.value = store.get('rukujack-name') || '';
const hashCode = normalizeCode(location.hash.slice(1));
if (hashCode) {
  codeInput.value = hashCode;
  lobbyStatus(`Te han invitado a la mesa ${hashCode}. Firma y pulsa UNIRSE.`);
}
codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });

function lobbyStatus(t) { $('#lobby-status').textContent = t; }

function getName() {
  const n = nameInput.value.trim();
  if (!n) { lobbyStatus('Primero tienes que firmar.'); nameInput.focus(); return null; }
  const name = cleanName(n);
  store.set('rukujack-name', name);
  return name;
}

function setLobbyBusy(b) { document.querySelectorAll('#lobby button').forEach(x => { x.disabled = b; }); }

$('#btn-solo').onclick = () => { const n = getName(); if (!n) return; initAudio(); startLocal(n, false); };
$('#btn-host').onclick = () => { const n = getName(); if (!n) return; initAudio(); startLocal(n, true); };
$('#btn-join').onclick = () => {
  const n = getName(); if (!n) return;
  const code = normalizeCode(codeInput.value);
  if (code.length < 5) { lobbyStatus('El código tiene 5 caracteres.'); codeInput.focus(); return; }
  initAudio();
  join(n, code);
};
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') (codeInput.value ? $('#btn-join') : $('#btn-solo')).click(); });
codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join').click(); });

// Mensajes que llegan al anfitrión (de él mismo o de los clientes).
function applyMsg(table, id, m) {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'bet': table.placeBet(id, Number(m.amount)); break;
    case 'act': if (['hit', 'stand', 'double'].includes(m.a)) table.action(id, m.a); break;
    case 'dact': if (['hit', 'stand'].includes(m.a)) table.dealerAction(id, m.a); break;
    case 'deal': table.dealNow(id); break;
    case 'waiver': table.waiver(id); break;
    case 'setDealer': table.setDealer(id, typeof m.target === 'string' ? m.target : null); break;
    case 'setRole': if (typeof m.target === 'string') table.setRole(id, m.target, m.role); break;
  }
}

function startLocal(name, isOnline) {
  myId = HOST_ID;
  online = isOnline;
  const table = new Table(s => {
    onState(s);
    if (net) net.broadcast({ t: 'state', s });
  });
  sendMsg = m => applyMsg(table, myId, m);
  if (!isOnline) {
    table.addPlayer(myId, name);
    enterGame(null);
    return;
  }
  setLobbyBusy(true);
  lobbyStatus('Abriendo mesa...');
  const tryOpen = attempt => {
    const code = randomCode();
    net = new HostNet({
      onOpen: () => { roomCode = code; table.addPlayer(myId, name); enterGame(code); },
      onError: e => {
        if (!inGame && e.type === 'unavailable-id' && attempt < 3) { net.destroy(); tryOpen(attempt + 1); return; }
        if (!inGame) { setLobbyBusy(false); lobbyStatus('Error de red: ' + (e.type || e.message || e)); net.destroy(); net = null; }
        else toast('Problema de red: ' + (e.type || 'desconocido'));
      },
      onJoin: (id, pname) => {
        const n = cleanName(pname);
        if (!table.addPlayer(id, n)) { net.send(id, { t: 'full' }); setTimeout(() => net.kick(id), 300); }
        else { toast(`${n} se sienta a la mesa`); sfx.thump(); }
      },
      onLeave: id => {
        const p = table.get(id);
        if (p) { toast(`${p.name} abandona la mesa`); table.removePlayer(id); }
      },
      onMessage: (id, m) => applyMsg(table, id, m),
    });
    net.start(code);
  };
  tryOpen(0);
}

function join(name, code) {
  online = true;
  setLobbyBusy(true);
  lobbyStatus('Conectando con la mesa ' + code + '...');
  const client = net = new ClientNet();
  const giveUp = setTimeout(() => {
    if (!inGame) { client.destroy(); net = null; setLobbyBusy(false); lobbyStatus('No responde nadie. ¿Seguro que la mesa sigue abierta?'); }
  }, 15000);
  client.connect(code, name, {
    onOpen: id => { clearTimeout(giveUp); myId = id; roomCode = code; sendMsg = m => client.send(m); enterGame(code); },
    onState: s => onState(s),
    onFull: () => { client.destroy(); backToLobby(`La mesa está llena (máx. ${MAX_PLAYERS}).`); },
    onClose: () => backToLobby('El anfitrión ha cerrado la mesa.'),
    onError: e => {
      clearTimeout(giveUp);
      if (inGame) { toast('Problema de red: ' + (e.type || '')); return; }
      client.destroy(); net = null; setLobbyBusy(false);
      lobbyStatus(e.type === 'peer-unavailable' ? 'No existe ninguna mesa con ese código.' : 'Error de red: ' + (e.type || e.message || e));
    },
  });
}

function enterGame(code) {
  inGame = true;
  $('#lobby').hidden = true;
  $('#hud').hidden = false;
  if (code) {
    $('#room-label').innerHTML = `MESA <b>${code}</b>`;
    $('#copy-link').hidden = false;
    history.replaceState(null, '', '#' + code);
  } else {
    $('#room-label').textContent = 'MESA PRIVADA';
  }
  sfx.thump();
}

function backToLobby(msg) {
  if (net) net.destroy();
  net = null;
  inGame = false;
  history.replaceState(null, '', location.pathname);
  // Recargar es la forma más limpia de reiniciar la escena y los temporizadores.
  if (msg) { try { sessionStorage.setItem('rukujack-msg', msg); } catch { /* nada */ } }
  location.reload();
}
{
  let m = null;
  try { m = sessionStorage.getItem('rukujack-msg'); sessionStorage.removeItem('rukujack-msg'); } catch { /* nada */ }
  if (m) lobbyStatus(m);
}

$('#leave').onclick = () => backToLobby();
$('#mute').onclick = () => { initAudio(); $('#mute').textContent = toggleMute() ? 'Sonido: no' : 'Sonido: sí'; };
$('#copy-link').onclick = async () => {
  const url = location.origin + location.pathname + '#' + roomCode;
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Pásaselo a tus amigos.'); }
  catch { window.prompt('Copia este enlace:', url); }
};
$('#panel-btn').onclick = () => { $('#panel').hidden = !$('#panel').hidden; renderPanel(); };
$('#panel-close').onclick = () => { $('#panel').hidden = true; };

let toastTimer = null;
function toast(t) {
  const el = $('#toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ---------- Estado ----------
const me = () => state && state.players.find(p => p.id === myId);
const amDealer = () => state && state.dealer.id === myId;

function onState(s) {
  const prev = state;
  state = s;
  deadlineAt = s.remaining ? Date.now() + s.remaining : 0;
  sounds(prev, s);
  scene.update(s, myId);
  renderHud();
}

function allCards(s) {
  const m = new Map();
  for (const c of s.dealer.hand) m.set(c.id, c);
  for (const p of s.players) for (const c of p.hand) m.set(c.id, c);
  return m;
}

function sounds(prev, s) {
  if (!prev) return;
  const a = allCards(prev), b = allCards(s);
  let fresh = 0;
  for (const [id, c] of b) {
    if (!a.has(id)) fresh++;
    else if (a.get(id).hidden && !c.hidden) sfx.flip();
  }
  for (let i = 0; i < fresh; i++) setTimeout(() => sfx.card(), i * 70);

  const pm = prev.players.find(p => p.id === myId), m = s.players.find(p => p.id === myId);
  if (!m) return;
  if (s.turn === myId && prev.turn !== myId) sfx.turn();
  if (s.dealer.id === myId && s.dealer.waiting && !prev.dealer.waiting) sfx.turn();
  if (m.ready && pm && !pm.ready) sfx.chip();
  if (m.status === 'bust' && pm && pm.status !== 'bust') sfx.bust();
  if (s.phase === 'result' && prev.phase !== 'result') {
    const delta = s.dealer.id === myId ? s.dealer.delta : (m.result ? m.delta : null);
    if (delta === null) return;
    if (delta > 0) sfx.win();
    else if (delta < 0) { sfx.lose(); const mon = $('#monitor'); mon.classList.remove('flash'); void mon.offsetWidth; mon.classList.add('flash'); }
  }
}

// Texto del crupier, letra a letra.
let sayText = '', sayTimer = null;
function say(text) {
  if (text === sayText) return;
  sayText = text;
  clearInterval(sayTimer);
  const el = $('#dealer-say');
  el.textContent = '';
  let i = 0;
  sayTimer = setInterval(() => {
    i++;
    el.textContent = text.slice(0, i);
    if (i % 2) sfx.type();
    if (i >= text.length) clearInterval(sayTimer);
  }, 30);
}

const RESULT_TXT = { win: 'GANA', lose: 'PIERDE', push: 'EMPATE', bj: 'BLACKJACK' };
const STATUS_TXT = { bust: 'SE PASA', blackjack: 'BLACKJACK', stand: 'SE PLANTA' };
const seatColor = p => SEATS[p.seat].color;

function actionsHtml(s, m) {
  if (!m) return `<div class="info">Mirando la mesa...</div>`;
  const anyReady = s.players.some(p => p.ready);

  // Eres el crupier.
  if (amDealer()) {
    if (s.phase === 'betting') {
      return `<div class="info">Eres la banca<small>Espera a que apuesten o reparte ya</small></div>`
        + `<button class="btn primary" data-a="deal" ${anyReady ? '' : 'disabled'}>Repartir<kbd>⏎</kbd></button><span class="timer"></span>`;
    }
    if (s.phase === 'dealer' && s.dealer.waiting) {
      const v = s.dealer.value;
      return `<button class="btn" data-a="dhit" ${v >= 21 ? 'disabled' : ''}>Pedir<kbd>H</kbd></button>`
        + `<button class="btn primary" data-a="dstand" ${v < 17 ? 'disabled' : ''}>Plantarse<kbd>S</kbd></button>`
        + `<div class="info">Tienes ${v}<small>${v < 17 ? 'Con 16 o menos la banca debe pedir' : 'Tú decides: plantarte o arriesgar'}</small></div><span class="timer"></span>`;
    }
    if (s.phase === 'result') {
      const d = s.dealer.delta;
      return `<div class="info big ${d > 0 ? 'win' : d < 0 ? 'lose' : ''}">BANCA ${d ? signed(d) : '±0'}</div>`;
    }
    const tp = s.players.find(p => p.id === s.turn);
    return `<div class="info">${s.phase === 'dealing' ? 'Repartiendo...' : tp ? `Juega ${esc(tp.name)}<span class="timer"></span>` : 'Revelando...'}</div>`;
  }

  // Estás mirando.
  if (m.role === 'spectator') {
    return `<div class="info">Estás mirando<small>Abre MESA para volver a apostar</small></div>`;
  }

  if (s.phase === 'betting') {
    if (m.chips < MIN_BET) return `<div class="info">Sin fichas</div><button class="btn danger" data-a="waiver">Firmar otra exención</button>`;
    if (m.ready) {
      const extra = myId === HOST_ID && !s.dealer.id && s.players.length > 1 ? `<button class="btn xs" data-a="deal">Repartir ya</button>` : '';
      return `<div class="info">Apuestas ${m.bet}<small>Esperando al resto</small></div><span class="timer"></span>${extra}`;
    }
    if (!betAmount) betAmount = m.bet || MIN_BET;
    betAmount = Math.max(MIN_BET, Math.min(m.chips, betAmount));
    return [10, 25, 50, 100].map(v => `<button class="chip" data-a="chip" data-v="${v}" ${v > m.chips ? 'disabled' : ''}>+${v}</button>`).join('')
      + `<div class="bet-amount">${betAmount}</div>`
      + `<button class="btn xs" data-a="min">Mín</button><button class="btn xs" data-a="all">Todo</button>`
      + `<button class="btn primary" data-a="bet">Apostar<kbd>⏎</kbd></button><span class="timer"></span>`;
  }
  if (s.phase === 'playing' && s.turn === myId) {
    const canDouble = m.hand.length === 2 && m.chips >= m.bet;
    return `<button class="btn" data-a="hit">Pedir<kbd>H</kbd></button>`
      + `<button class="btn primary" data-a="stand">Plantarse<kbd>S</kbd></button>`
      + `<button class="btn danger" data-a="double" ${canDouble ? '' : 'disabled'}>Doblar<kbd>D</kbd></button>`
      + `<span class="timer"></span>`;
  }
  if (s.phase === 'result' && m.result) {
    const cls = m.delta > 0 ? 'win' : m.delta < 0 ? 'lose' : '';
    const word = { win: 'GANAS', lose: 'PIERDES', push: 'EMPATE', bj: 'BLACKJACK' }[m.result];
    return `<div class="info big ${cls}">${word}${m.delta ? ' ' + signed(m.delta) : ''}</div>`;
  }
  let t = '';
  if (m.status === 'idle') t = s.phase === 'result' ? 'Siguiente ronda en breve...' : 'Esperas a la siguiente ronda';
  else if (s.phase === 'dealing') t = 'Repartiendo...';
  else if (s.phase === 'dealer') t = s.dealer.id ? `Juega la banca: ${esc(s.dealer.name)}<span class="timer"></span>` : 'Juega la banca...';
  else if (m.status === 'bust') t = `Te has pasado con ${m.value}`;
  else if (m.status === 'blackjack') t = '¡Blackjack!';
  else if (m.status === 'stand') t = `Te plantas con ${m.value}`;
  else {
    const tp = s.players.find(p => p.id === s.turn);
    t = tp ? `Turno de ${esc(tp.name)}<span class="timer"></span>` : '';
  }
  return `<div class="info">${t}</div>`;
}

function renderHud() {
  const s = state;
  if (!s) return;
  say(s.message);
  const m = me();

  if (m) {
    const dealer = amDealer();
    $('#m-label').textContent = dealer ? 'BANCA' : 'FICHAS';
    $('#m-chips').textContent = m.chips;
    $('#m-bet').textContent = !dealer && (m.ready || m.status !== 'idle') ? m.bet : 0;
    $('#m-waivers').textContent = m.waivers ? '✎'.repeat(Math.min(m.waivers, 8)) : '—';
    $('#monitor').classList.toggle('neg', m.chips < 0);
  }
  $('#panel-count').textContent = `${s.players.length}/${MAX_PLAYERS}`;

  const html = actionsHtml(s, m);
  const act = $('#actions');
  if (act.dataset.html !== html) { act.innerHTML = html; act.dataset.html = html; tickTimer(); }

  renderLabels();
  renderPanel();
}

// ---------- Panel de la mesa (roles) ----------
function renderPanel() {
  const s = state;
  const body = $('#panel-body');
  if (!s || $('#panel').hidden) return;
  const isHost = myId === HOST_ID;
  const canEdit = s.phase === 'betting';
  const dis = canEdit ? '' : 'disabled';
  const many = s.players.length > 1;

  let html = `<div class="prow" style="--c:${s.dealer.id ? seatColor(s.players.find(p => p.id === s.dealer.id)) : '#ff3d7f'}">
    <span class="dot"></span>
    <span class="who">CRUPIER<small>${s.dealer.id ? esc(s.dealer.name) + ' hace de banca' : 'La casa (IA)'}</small></span>
    <span class="ctl">${isHost && s.dealer.id ? `<button class="btn xs" data-p="dealer" data-id="" ${dis}>Pasar a IA</button>` : ''}</span>
  </div>`;

  for (const p of [...s.players].sort((a, b) => a.seat - b.seat)) {
    const isDealer = p.id === s.dealer.id;
    const role = isDealer ? '<span class="role dealer">BANCA</span>' : p.role === 'spectator' ? '<span class="role spect">MIRA</span>' : '';
    const ctl = [];
    if (isHost && many && !isDealer) ctl.push(`<button class="btn xs" data-p="dealer" data-id="${esc(p.id)}" ${dis}>Crupier</button>`);
    if ((isHost || p.id === myId) && !isDealer) {
      ctl.push(p.role === 'player'
        ? `<button class="btn xs" data-p="role" data-id="${esc(p.id)}" data-role="spectator" ${dis}>Mirar</button>`
        : `<button class="btn xs" data-p="role" data-id="${esc(p.id)}" data-role="player" ${dis}>Apostar</button>`);
    }
    html += `<div class="prow" style="--c:${seatColor(p)}">
      <span class="dot"></span>
      <span class="who">${esc(p.name)}${p.id === myId ? ' (TÚ)' : ''}${role}<small>◈ ${p.chips}${p.id === HOST_ID && online ? ' · anfitrión' : ''}</small></span>
      <span class="ctl">${ctl.join('')}</span>
    </div>`;
  }

  const notes = [];
  if (!canEdit) notes.push('Los cambios de rol se hacen entre rondas.');
  if (isHost && !many) notes.push(online ? 'Comparte el enlace: con 2 o más jugadores podrás elegir quién reparte.' : 'En solitario reparte la casa. Abre una mesa online para jugar con amigos.');
  if (isHost && many) notes.push('Como anfitrión eliges quién es el crupier y quién apuesta. Cada jugador puede levantarse a mirar.');
  if (!isHost) notes.push('El anfitrión elige quién es el crupier.');
  html += `<div class="panel-note">${notes.join('<br>')}</div>`;

  if (body.dataset.html !== html) { body.innerHTML = html; body.dataset.html = html; }
}

$('#panel-body').addEventListener('click', e => {
  const b = e.target.closest('[data-p]');
  if (!b || b.disabled) return;
  if (b.dataset.p === 'dealer') sendMsg({ t: 'setDealer', target: b.dataset.id || null });
  else if (b.dataset.p === 'role') sendMsg({ t: 'setRole', target: b.dataset.id, role: b.dataset.role });
});

// ---------- Etiquetas sobre la mesa ----------
const labelsEl = $('#labels');
const seatEls = SEATS.map(() => { const d = document.createElement('div'); d.className = 'seat'; labelsEl.appendChild(d); return d; });
const dealerEl = document.createElement('div');
dealerEl.className = 'seat dealer';
labelsEl.appendChild(dealerEl);

function renderLabels() {
  const s = state;
  SEATS.forEach((seat, i) => {
    const el = seatEls[i];
    const p = s.players.find(x => x.seat === i);
    if (!p || p.id === s.dealer.id) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.setProperty('--c', seat.color);
    const turn = s.turn === p.id;
    el.className = 'seat' + (p.id === myId ? ' me' : '') + (turn ? ' turn' : '') + (p.role === 'spectator' ? ' spect' : '');
    let tag = '';
    const tagCls = p.result || p.status;
    if (p.role === 'spectator') tag = 'MIRANDO';
    else if (s.phase === 'betting') tag = p.chips < MIN_BET ? 'SIN FICHAS' : p.ready ? `APUESTA ${p.bet}` : 'PENSANDO...';
    else if (p.status === 'idle') tag = 'ESPERA';
    else if (p.result) tag = RESULT_TXT[p.result] + (p.delta ? ' ' + signed(p.delta) : '');
    else tag = STATUS_TXT[p.status] || (turn ? 'JUGANDO' : '');
    const soft = p.soft && p.value < 21 && p.status === 'playing' ? `<small>/${p.value - 10}</small>` : '';
    const val = p.hand.length ? `<div class="val">${p.value}${soft}</div>` : '<div class="val">&nbsp;</div>';
    el.innerHTML = `${val}<div class="nm">${turn ? '▶ ' : ''}${esc(p.name)}</div><div class="tag ${tagCls}">${tag}</div><div class="sub">◈ ${p.chips}</div>`;
  });

  const d = s.dealer;
  const dp = d.id && s.players.find(p => p.id === d.id);
  dealerEl.style.setProperty('--c', dp ? seatColor(dp) : '#ff3d7f');
  dealerEl.className = 'seat dealer' + (d.id === myId ? ' me' : '') + (d.waiting ? ' turn' : '');
  const val = d.hand.length ? `<div class="val">${d.value}${d.hidden ? '<small> +?</small>' : ''}</div>` : '';
  const res = s.phase === 'result' && dp ? `<div class="tag ${d.delta >= 0 ? 'win' : 'lose'}">BANCA ${d.delta ? signed(d.delta) : '±0'}</div>` : '';
  const sub = dp ? `<div class="sub">◈ ${dp.chips}</div>` : '';
  dealerEl.innerHTML = `${val}<div class="nm">${dp ? esc(dp.name) : 'LA CASA'}</div>${res}${sub}`;
}

scene.onFrame = () => {
  SEATS.forEach((seat, i) => {
    const p = scene.project(seat.x + seat.out.x * 0.36, 0, seat.z + seat.out.z * 0.36);
    seatEls[i].style.left = p.x + 'px';
    seatEls[i].style.top = p.y + 'px';
  });
  const d = scene.project(0, 0.02, DEALER_CARDS_Z - 0.3);
  dealerEl.style.left = d.x + 'px';
  dealerEl.style.top = d.y + 'px';
};

// ---------- Temporizador ----------
function tickTimer() {
  const el = document.querySelector('#actions .timer');
  if (!el) return;
  if (!deadlineAt) { el.textContent = ''; return; }
  const sec = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
  el.textContent = `${sec}s`;
  el.classList.toggle('hurry', sec <= 5);
}
setInterval(tickTimer, 250);

// ---------- Entrada ----------
function act(a, v) {
  initAudio();
  const m = me();
  if (!m) return;
  switch (a) {
    case 'chip': betAmount = Math.min(m.chips, betAmount + Number(v)); sfx.chip(); renderHud(); break;
    case 'min': betAmount = MIN_BET; renderHud(); break;
    case 'all': betAmount = m.chips; sfx.chip(); renderHud(); break;
    case 'bet': sendMsg({ t: 'bet', amount: betAmount }); break;
    case 'deal': sendMsg({ t: 'deal' }); break;
    case 'hit': case 'stand': case 'double': sendMsg({ t: 'act', a }); break;
    case 'dhit': sendMsg({ t: 'dact', a: 'hit' }); break;
    case 'dstand': sendMsg({ t: 'dact', a: 'stand' }); break;
    case 'waiver': sendMsg({ t: 'waiver' }); sfx.thump(); break;
  }
}

$('#actions').addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (b && !b.disabled) act(b.dataset.a, b.dataset.v);
});

addEventListener('keydown', e => {
  if (!inGame || !state || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  const m = me();
  if (!m) return;
  const s = state;
  if (amDealer()) {
    if (s.phase === 'dealer' && s.dealer.waiting) {
      if (k === 'h' && s.dealer.value < 21) act('dhit');
      else if (k === 's' && s.dealer.value >= 17) act('dstand');
    } else if (s.phase === 'betting' && k === 'enter' && s.players.some(p => p.ready)) act('deal');
    return;
  }
  if (s.phase === 'playing' && s.turn === myId) {
    if (k === 'h') act('hit');
    else if (k === 's') act('stand');
    else if (k === 'd' && m.hand.length === 2 && m.chips >= m.bet) act('double');
  } else if (s.phase === 'betting' && m.role === 'player' && !m.ready && m.chips >= MIN_BET && (k === 'enter' || k === ' ')) {
    e.preventDefault();
    act('bet');
  }
});
