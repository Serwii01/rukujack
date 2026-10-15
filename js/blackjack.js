// Lógica de la mesa. Solo la ejecuta el anfitrión (o el modo solitario);
// los clientes reciben instantáneas con snapshot().
//
// El crupier puede ser la IA (dealerId = null) o cualquier jugador. Un crupier
// humano es la banca: cobra y paga con sus fichas. Debe pedir con 16 o menos,
// pero con 17 o más decide él si se planta o arriesga.

export const START_CHIPS = 500;
export const MIN_BET = 10;
export const MAX_PLAYERS = 6;
export const HOST_ID = 'host';

const TURN_MS = 30000;
const BET_MS = 20000;
const DEALER_MS = 20000;
const RESULT_MS = 5000;
const DEAL_STEP = 300;
const DEALER_STEP = 800;
const SEAT_ORDER = [2, 3, 1, 4, 0, 5];

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const wait = ms => new Promise(r => setTimeout(r, ms));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const LINES = {
  betting: ['Hagan sus apuestas.', 'Fichas sobre el tapete.', '¿Otra ronda?', 'La mesa está abierta.', 'Cuando quieran.'],
  dealing: ['Repartiendo.', 'Veamos qué sale.', 'Cartas.'],
  dealerTurn: ['Turno de la banca.', 'Ahora juego yo.', 'Veamos.'],
  dealerBJ: ['Blackjack de la banca.', 'Veintiuno. La casa gana.'],
  dealerBust: ['La banca se pasa.', 'Me he pasado. Disfrutadlo.', 'Pasada. No os acostumbréis.'],
  bust: n => [`${n} se pasa.`, `Demasiado, ${n}.`],
  bj: n => [`Blackjack para ${n}.`],
  turn: n => [`Tu turno, ${n}.`, `${n}, ¿pides o te plantas?`, `${n}, decide.`],
  humanDealer: n => [`${n}, la banca es tuya. Juega tu mano.`],
  waiver: n => [`${n} firma otra exención.`, `${n} vuelve a firmar.`],
  join: n => [`${n} se sienta a la mesa.`],
  newDealer: n => [`${n} toma la banca.`, `${n} es ahora el crupier.`],
  aiDealer: ['La casa vuelve a repartir.'],
};

export function makeShoe(decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export function cardValue(r) {
  if (r === 'A') return 11;
  if (r === 'J' || r === 'Q' || r === 'K' || r === '10') return 10;
  return Number(r);
}

// includeHidden: el anfitrión necesita contar la carta tapada del crupier.
export function handValue(cards, includeHidden = false) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (!c || !c.r || (c.hidden && !includeHidden)) continue;
    total += cardValue(c.r);
    if (c.r === 'A') aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export class Table {
  constructor(onChange) {
    this.onChange = onChange;
    this.players = [];
    this.dealer = { hand: [] };
    this.dealerId = null;
    this.dealerWaiting = false;
    this.dealerDelta = 0;
    this.phase = 'betting';
    this.turn = null;
    this.order = [];
    this.turnIdx = -1;
    this.shoe = makeShoe();
    this.cardSeq = 0;
    this.round = 0;
    this.deadline = 0;
    this.timer = null;
    this.message = pick(LINES.betting);
  }

  get(id) { return this.players.find(p => p.id === id); }
  emit() { this.onChange(this.snapshot()); }
  isBettor(p) { return p.role === 'player' && p.id !== this.dealerId; }
  humanDealer() { return this.dealerId ? this.get(this.dealerId) : null; }

  draw(hidden = false) {
    if (this.shoe.length < 40) this.shoe = makeShoe();
    const c = this.shoe.pop();
    return { r: c.r, s: c.s, id: ++this.cardSeq, hidden };
  }

  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = ms ? Date.now() + ms : 0;
    this.timer = ms ? setTimeout(fn, ms) : null;
  }

  // ---------- Jugadores y roles ----------

  addPlayer(id, name) {
    if (this.get(id) || this.players.length >= MAX_PLAYERS) return false;
    const used = new Set(this.players.map(p => p.seat));
    const seat = SEAT_ORDER.find(s => !used.has(s));
    this.players.push({
      id, name, seat, role: 'player', chips: START_CHIPS, bet: 0, ready: false,
      hand: [], status: 'idle', result: null, delta: 0, waivers: 0,
    });
    if (this.players.length > 1) this.message = pick(LINES.join(name));
    this.emit();
    return true;
  }

  removePlayer(id) {
    const p = this.get(id);
    if (!p) return;
    this.players = this.players.filter(x => x !== p);
    if (this.dealerId === id) {
      this.dealerId = null;
      this.message = 'El crupier se ha ido. ' + pick(LINES.aiDealer);
      if (this.dealerWaiting) { this.autoDealer(); return; }
    }
    if (this.phase === 'playing' && this.turn === id) { this.advance(); return; }
    if (this.phase === 'betting' && this.checkAllReady()) return;
    this.emit();
  }

  setDealer(byId, target) {
    if (byId !== HOST_ID || this.phase !== 'betting') return;
    if (target !== null && !this.get(target)) return;
    if (target === this.dealerId) return;
    this.dealerId = target;
    const p = target && this.get(target);
    if (p) { p.ready = false; this.message = pick(LINES.newDealer(p.name)); }
    else this.message = pick(LINES.aiDealer);
    if (!this.checkAllReady()) this.emit();
  }

  setRole(byId, target, role) {
    if (this.phase !== 'betting' || !['player', 'spectator'].includes(role)) return;
    if (byId !== HOST_ID && byId !== target) return;
    const p = this.get(target);
    if (!p || p.role === role) return;
    p.role = role;
    p.ready = false;
    this.message = role === 'spectator' ? `${p.name} se levanta a mirar.` : `${p.name} vuelve a apostar.`;
    if (!this.checkAllReady()) this.emit();
  }

  waiver(id) {
    const p = this.get(id);
    if (!p || p.chips >= MIN_BET || p.status !== 'idle') return;
    if (this.dealerId === id && this.phase !== 'betting') return;
    p.chips += START_CHIPS;
    p.waivers++;
    this.message = pick(LINES.waiver(p.name));
    this.emit();
  }

  // ---------- Apuestas ----------

  placeBet(id, amount) {
    const p = this.get(id);
    if (!p || this.phase !== 'betting' || p.ready || !this.isBettor(p)) return;
    amount = Math.floor(amount);
    if (!(amount >= MIN_BET && amount <= p.chips)) return;
    p.bet = amount;
    p.ready = true;
    if (!this.deadline) this.setTimer(BET_MS, () => this.deal());
    if (!this.checkAllReady()) this.emit();
  }

  // El anfitrión o el crupier humano pueden repartir sin esperar a todos.
  dealNow(id) {
    if (this.phase !== 'betting') return;
    if (id !== HOST_ID && id !== this.dealerId) return;
    if (this.players.some(p => p.ready)) this.deal();
  }

  checkAllReady() {
    const eligible = this.players.filter(p => this.isBettor(p) && p.chips >= MIN_BET);
    if (eligible.length && eligible.every(p => p.ready)) { this.deal(); return true; }
    if (!this.players.some(p => p.ready)) this.setTimer(0);
    return false;
  }

  // ---------- Ronda ----------

  async deal() {
    if (this.phase !== 'betting') return;
    this.setTimer(0);
    const inRound = this.players
      .filter(p => this.isBettor(p) && p.ready && p.bet >= MIN_BET && p.bet <= p.chips)
      .sort((a, b) => a.seat - b.seat);
    if (!inRound.length) { this.emit(); return; }

    this.round++;
    this.phase = 'dealing';
    this.message = pick(LINES.dealing);
    this.dealer.hand = [];
    this.dealerDelta = 0;
    for (const p of this.players) {
      p.hand = []; p.result = null; p.delta = 0;
      p.status = inRound.includes(p) ? 'playing' : 'idle';
      if (p.status === 'playing') p.chips -= p.bet;
    }
    this.emit();
    await wait(400);

    for (let k = 0; k < 2; k++) {
      for (const p of inRound) {
        p.hand.push(this.draw());
        this.emit();
        await wait(DEAL_STEP);
      }
      this.dealer.hand.push(this.draw(k === 1));
      this.emit();
      await wait(DEAL_STEP);
    }

    for (const p of inRound) {
      if (handValue(p.hand).total === 21) p.status = 'blackjack';
    }
    if (handValue(this.dealer.hand, true).total === 21) {
      this.dealer.hand.forEach(c => { c.hidden = false; });
      this.message = pick(LINES.dealerBJ);
      this.settle();
      return;
    }
    this.phase = 'playing';
    this.order = inRound.map(p => p.id);
    this.turnIdx = -1;
    this.advance();
  }

  advance() {
    this.setTimer(0);
    while (++this.turnIdx < this.order.length) {
      const p = this.get(this.order[this.turnIdx]);
      if (p && p.status === 'playing') {
        this.turn = p.id;
        this.message = pick(LINES.turn(p.name));
        this.startTurnTimer(p);
        this.emit();
        return;
      }
    }
    this.turn = null;
    this.dealerPlay();
  }

  startTurnTimer(p) {
    // Con una sola persona en la mesa no hay prisa.
    if (this.players.length > 1) this.setTimer(TURN_MS, () => this.action(p.id, 'stand'));
    else this.setTimer(0);
  }

  action(id, a) {
    if (this.phase !== 'playing' || this.turn !== id) return;
    const p = this.get(id);
    if (!p) return;

    if (a === 'hit') {
      p.hand.push(this.draw());
      const v = handValue(p.hand).total;
      if (v > 21) { p.status = 'bust'; this.message = pick(LINES.bust(p.name)); this.advance(); }
      else if (v === 21) { p.status = 'stand'; this.advance(); }
      else { this.startTurnTimer(p); this.emit(); }
    } else if (a === 'stand') {
      p.status = 'stand';
      this.advance();
    } else if (a === 'double') {
      if (p.hand.length !== 2 || p.chips < p.bet) return;
      p.chips -= p.bet;
      p.bet *= 2;
      p.hand.push(this.draw());
      if (handValue(p.hand).total > 21) { p.status = 'bust'; this.message = pick(LINES.bust(p.name)); }
      else p.status = 'stand';
      this.advance();
    }
  }

  // ---------- Turno de la banca ----------

  async dealerPlay() {
    this.phase = 'dealer';
    this.message = pick(LINES.dealerTurn);
    this.emit();
    await wait(DEALER_STEP);
    this.dealer.hand.forEach(c => { c.hidden = false; });
    this.emit();
    await wait(DEALER_STEP);

    const someoneStands = this.players.some(p => this.order.includes(p.id) && p.status === 'stand');
    if (!someoneStands) { this.finishDealer(); return; }

    const human = this.humanDealer();
    if (human) {
      this.dealerWaiting = true;
      this.message = pick(LINES.humanDealer(human.name));
      this.setTimer(DEALER_MS, () => this.autoDealer());
      this.emit();
      return;
    }
    await this.aiDraw();
    this.finishDealer();
  }

  async aiDraw() {
    while (handValue(this.dealer.hand, true).total < 17) {
      this.dealer.hand.push(this.draw());
      this.emit();
      await wait(DEALER_STEP);
    }
  }

  async autoDealer() {
    if (!this.dealerWaiting) return;
    this.dealerWaiting = false;
    this.setTimer(0);
    await this.aiDraw();
    this.finishDealer();
  }

  dealerAction(id, a) {
    if (this.phase !== 'dealer' || !this.dealerWaiting || id !== this.dealerId) return;
    const total = handValue(this.dealer.hand, true).total;
    if (a === 'hit') {
      if (total >= 21) return;
      this.dealer.hand.push(this.draw());
      const v = handValue(this.dealer.hand, true).total;
      if (v >= 21) { this.dealerWaiting = false; this.setTimer(0); this.finishDealer(); return; }
      this.setTimer(DEALER_MS, () => this.autoDealer());
      this.emit();
    } else if (a === 'stand') {
      if (total < 17) return;
      this.dealerWaiting = false;
      this.setTimer(0);
      this.finishDealer();
    }
  }

  finishDealer() {
    const d = handValue(this.dealer.hand, true).total;
    this.message = d > 21 ? pick(LINES.dealerBust) : `La banca tiene ${d}.`;
    this.settle();
  }

  settle() {
    const d = handValue(this.dealer.hand, true).total;
    const dealerBJ = d === 21 && this.dealer.hand.length === 2;
    let houseNet = 0;
    for (const p of this.players) {
      if (p.status === 'idle') continue;
      const v = handValue(p.hand).total;
      let res;
      if (p.status === 'bust') res = 'lose';
      else if (p.status === 'blackjack') res = dealerBJ ? 'push' : 'bj';
      else if (dealerBJ) res = 'lose';
      else if (d > 21 || v > d) res = 'win';
      else if (v === d) res = 'push';
      else res = 'lose';

      if (res === 'bj') { const w = Math.floor(p.bet * 1.5); p.chips += p.bet + w; p.delta = w; }
      else if (res === 'win') { p.chips += p.bet * 2; p.delta = p.bet; }
      else if (res === 'push') { p.chips += p.bet; p.delta = 0; }
      else p.delta = -p.bet;
      p.result = res;
      houseNet -= p.delta;
    }
    // Un crupier humano es la banca: gana lo que pierden los demás y viceversa.
    const human = this.humanDealer();
    if (human) human.chips += houseNet;
    this.dealerDelta = houseNet;

    this.dealerWaiting = false;
    this.phase = 'result';
    this.turn = null;
    this.emit();
    this.setTimer(RESULT_MS, () => this.newRound());
  }

  newRound() {
    this.setTimer(0);
    this.phase = 'betting';
    this.dealer.hand = [];
    this.dealerDelta = 0;
    this.order = [];
    for (const p of this.players) {
      p.hand = []; p.status = 'idle'; p.ready = false; p.result = null; p.delta = 0;
      if (p.bet > p.chips) p.bet = Math.max(0, p.chips);
    }
    this.message = pick(LINES.betting);
    this.emit();
  }

  snapshot() {
    const dv = handValue(this.dealer.hand);
    const human = this.humanDealer();
    return {
      phase: this.phase,
      turn: this.turn,
      message: this.message,
      round: this.round,
      remaining: this.deadline && this.phase !== 'result' ? Math.max(0, this.deadline - Date.now()) : 0,
      dealer: {
        id: human ? human.id : null,
        name: human ? human.name : null,
        hand: this.dealer.hand.map(c => (c.hidden ? { id: c.id, hidden: true } : { id: c.id, r: c.r, s: c.s })),
        value: dv.total,
        hidden: this.dealer.hand.some(c => c.hidden),
        waiting: this.dealerWaiting,
        delta: this.dealerDelta,
      },
      players: this.players.map(p => {
        const v = handValue(p.hand);
        return {
          id: p.id, name: p.name, seat: p.seat, role: p.role, chips: p.chips, bet: p.bet, ready: p.ready,
          status: p.status, result: p.result, delta: p.delta, waivers: p.waivers,
          hand: p.hand.map(c => ({ id: c.id, r: c.r, s: c.s })),
          value: v.total, soft: v.soft,
        };
      }),
    };
  }
}
