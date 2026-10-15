// Lógica de la mesa. Solo la ejecuta el anfitrión (o el modo solitario);
// los clientes reciben instantáneas con snapshot().
//
// El crupier puede ser la IA (dealerId = null) o cualquier jugador. Un crupier
// humano es la banca: cobra y paga con sus fichas. Debe pedir con 16 o menos,
// pero con 17 o más decide él si se planta o arriesga.
//
// Cada jugador juega una o varias manos (al separar parejas). Quien se queda
// sin fichas puede firmar hasta MAX_WAIVERS exenciones; sin ellas, queda eliminado.

export const START_CHIPS = 500;
export const MIN_BET = 10;
export const MAX_PLAYERS = 6;
export const MAX_HANDS = 3;
export const MAX_WAIVERS = 3;
export const HOST_ID = 'host';

const TURN_MS = 30000;
const BET_MS = 20000;
const DEALER_MS = 20000;
const RESULT_MS = 5000;
const SHOT_EXTRA_MS = 4500;
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
  split: n => [`${n} separa.`, `${n} divide la apuesta. Valiente.`],
  turn: n => [`Tu turno, ${n}.`, `${n}, ¿pides o te plantas?`, `${n}, decide.`],
  humanDealer: n => [`${n}, la banca es tuya. Juega tu mano.`],
  waiver: (n, left) => [`${n} firma otra exención. Le quedan ${left}.`],
  lastWaiver: n => [`${n} firma su última exención. No habrá más.`],
  join: n => [`${n} se sienta a la mesa.`],
  newDealer: n => [`${n} toma la banca.`, `${n} es ahora el crupier.`],
  aiDealer: ['La casa vuelve a repartir.'],
  shot: n => [`${n} no tiene más exenciones.`, `Se acabó para ${n}.`],
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

export function canSplit(p) {
  const h = p.hands[p.active];
  return !!h && h.cards.length === 2 && p.hands.length < MAX_HANDS && p.chips >= h.bet
    && cardValue(h.cards[0].r) === cardValue(h.cards[1].r);
}

export function canDouble(p) {
  const h = p.hands[p.active];
  return !!h && h.cards.length === 2 && p.chips >= h.bet;
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
    this.turnIdx = 0;
    this.shoe = makeShoe();
    this.cardSeq = 0;
    this.round = 0;
    this.deadline = 0;
    this.timer = null;
    this.shots = [];
    this.message = pick(LINES.betting);
  }

  get(id) { return this.players.find(p => p.id === id); }
  emit() { this.onChange(this.snapshot()); }
  isBettor(p) { return p.role === 'player' && !p.eliminated && p.id !== this.dealerId; }
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
      hands: [], active: 0, status: 'idle', result: null, delta: 0, waivers: 0, eliminated: false,
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
    const p = target !== null ? this.get(target) : null;
    if (target !== null && (!p || p.eliminated)) return;
    if (target === this.dealerId) return;
    this.dealerId = target;
    if (p) { p.ready = false; this.message = pick(LINES.newDealer(p.name)); }
    else this.message = pick(LINES.aiDealer);
    if (!this.checkAllReady()) this.emit();
  }

  setRole(byId, target, role) {
    if (this.phase !== 'betting' || !['player', 'spectator'].includes(role)) return;
    if (byId !== HOST_ID && byId !== target) return;
    const p = this.get(target);
    if (!p || p.role === role || p.eliminated) return;
    p.role = role;
    p.ready = false;
    this.message = role === 'spectator' ? `${p.name} se levanta a mirar.` : `${p.name} vuelve a apostar.`;
    if (!this.checkAllReady()) this.emit();
  }

  waiver(id) {
    const p = this.get(id);
    if (!p || p.eliminated || p.chips >= MIN_BET || p.status !== 'idle' || p.waivers >= MAX_WAIVERS) return;
    if (this.phase !== 'betting') return;
    p.chips += START_CHIPS;
    p.waivers++;
    const left = MAX_WAIVERS - p.waivers;
    this.message = left ? pick(LINES.waiver(p.name, left)) : pick(LINES.lastWaiver(p.name));
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
    this.shots = [];
    for (const p of this.players) {
      p.result = null; p.delta = 0; p.active = 0;
      const playing = inRound.includes(p);
      p.status = playing ? 'in' : 'idle';
      p.hands = playing ? [{ cards: [], bet: p.bet, status: 'playing', result: null, delta: 0 }] : [];
      if (playing) p.chips -= p.bet;
    }
    this.emit();
    await wait(400);

    for (let k = 0; k < 2; k++) {
      for (const p of inRound) {
        p.hands[0].cards.push(this.draw());
        this.emit();
        await wait(DEAL_STEP);
      }
      this.dealer.hand.push(this.draw(k === 1));
      this.emit();
      await wait(DEAL_STEP);
    }

    for (const p of inRound) {
      if (handValue(p.hands[0].cards).total === 21) p.hands[0].status = 'blackjack';
    }
    if (handValue(this.dealer.hand, true).total === 21) {
      this.dealer.hand.forEach(c => { c.hidden = false; });
      this.message = pick(LINES.dealerBJ);
      this.settle();
      return;
    }
    this.phase = 'playing';
    this.order = inRound.map(p => p.id);
    this.turnIdx = 0;
    this.advance();
  }

  // Busca la siguiente mano pendiente: primero del jugador actual, luego del siguiente.
  advance() {
    this.setTimer(0);
    while (this.turnIdx < this.order.length) {
      const p = this.get(this.order[this.turnIdx]);
      const h = p ? p.hands.findIndex(x => x.status === 'playing') : -1;
      if (h !== -1) {
        const changed = this.turn !== p.id;
        p.active = h;
        this.turn = p.id;
        if (changed) this.message = pick(LINES.turn(p.name));
        this.startTurnTimer(p);
        this.emit();
        return;
      }
      this.turnIdx++;
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
    const h = p && p.hands[p.active];
    if (!h || h.status !== 'playing') return;

    if (a === 'hit') {
      h.cards.push(this.draw());
      const v = handValue(h.cards).total;
      if (v > 21) { h.status = 'bust'; this.message = pick(LINES.bust(p.name)); this.advance(); }
      else if (v === 21) { h.status = 'stand'; this.advance(); }
      else { this.startTurnTimer(p); this.emit(); }
    } else if (a === 'stand') {
      h.status = 'stand';
      this.advance();
    } else if (a === 'double') {
      if (!canDouble(p)) return;
      p.chips -= h.bet;
      h.bet *= 2;
      h.cards.push(this.draw());
      if (handValue(h.cards).total > 21) { h.status = 'bust'; this.message = pick(LINES.bust(p.name)); }
      else h.status = 'stand';
      this.advance();
    } else if (a === 'split') {
      if (!canSplit(p)) return;
      p.chips -= h.bet;
      const [c1, c2] = h.cards;
      const aces = c1.r === 'A';
      h.cards = [c1, this.draw()];
      const nh = { cards: [c2, this.draw()], bet: h.bet, status: 'playing', result: null, delta: 0 };
      p.hands.splice(p.active + 1, 0, nh);
      // Con ases separados solo se recibe una carta por mano.
      for (const x of [h, nh]) {
        if (aces || handValue(x.cards).total === 21) x.status = 'stand';
      }
      this.message = pick(LINES.split(p.name));
      if (h.status !== 'playing') this.advance();
      else { this.startTurnTimer(p); this.emit(); }
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

    const someoneStands = this.players.some(p => this.order.includes(p.id) && p.hands.some(h => h.status === 'stand'));
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
      p.delta = 0;
      for (const h of p.hands) {
        const v = handValue(h.cards).total;
        let res;
        if (h.status === 'bust') res = 'lose';
        else if (h.status === 'blackjack') res = dealerBJ ? 'push' : 'bj';
        else if (dealerBJ) res = 'lose';
        else if (d > 21 || v > d) res = 'win';
        else if (v === d) res = 'push';
        else res = 'lose';

        if (res === 'bj') { const w = Math.floor(h.bet * 1.5); p.chips += h.bet + w; h.delta = w; }
        else if (res === 'win') { p.chips += h.bet * 2; h.delta = h.bet; }
        else if (res === 'push') { p.chips += h.bet; h.delta = 0; }
        else h.delta = -h.bet;
        h.result = res;
        p.delta += h.delta;
      }
      p.result = p.hands.length === 1 ? p.hands[0].result : p.delta > 0 ? 'win' : p.delta < 0 ? 'lose' : 'push';
      houseNet -= p.delta;
    }
    // Un crupier humano es la banca: gana lo que pierden los demás y viceversa.
    const human = this.humanDealer();
    if (human) human.chips += houseNet;
    this.dealerDelta = houseNet;

    // Bancarrota sin exenciones: eliminado.
    this.shots = [];
    for (const p of this.players) {
      if (p.eliminated || p.chips >= MIN_BET || p.waivers < MAX_WAIVERS) continue;
      if (p.status === 'idle' && p.id !== this.dealerId) continue;
      p.eliminated = true;
      p.role = 'spectator';
      p.ready = false;
      this.shots.push(p.id);
      if (this.dealerId === p.id) this.dealerId = null;
    }
    if (this.shots.length) this.message = pick(LINES.shot(this.shots.map(id => this.get(id).name).join(' y ')));

    this.dealerWaiting = false;
    this.phase = 'result';
    this.turn = null;
    this.emit();
    this.setTimer(RESULT_MS + (this.shots.length ? SHOT_EXTRA_MS : 0), () => this.newRound());
  }

  newRound() {
    this.setTimer(0);
    this.phase = 'betting';
    this.dealer.hand = [];
    this.dealerDelta = 0;
    this.order = [];
    this.shots = [];
    for (const p of this.players) {
      p.hands = []; p.active = 0; p.status = 'idle'; p.ready = false; p.result = null; p.delta = 0;
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
      shots: this.shots.slice(),
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
      players: this.players.map(p => ({
        id: p.id, name: p.name, seat: p.seat, role: p.role, chips: p.chips, bet: p.bet, ready: p.ready,
        status: p.status, result: p.result, delta: p.delta, waivers: p.waivers, eliminated: p.eliminated,
        active: p.active,
        canSplit: this.phase === 'playing' && this.turn === p.id && canSplit(p),
        canDouble: this.phase === 'playing' && this.turn === p.id && canDouble(p),
        hands: p.hands.map(h => {
          const v = handValue(h.cards);
          return {
            cards: h.cards.map(c => ({ id: c.id, r: c.r, s: c.s })),
            bet: h.bet, status: h.status, result: h.result, delta: h.delta, value: v.total, soft: v.soft,
          };
        }),
      })),
    };
  }
}
