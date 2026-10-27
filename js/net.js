// Red P2P con PeerJS (WebRTC). El anfitrión es la autoridad: ejecuta la mesa
// y envía el estado a todos. No hace falta servidor propio: el "broker"
// público y gratuito de PeerJS solo se usa para que los navegadores se encuentren.
/* global Peer */

const PREFIX = 'veintiuno-bj-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

export function normalizeCode(c) {
  return (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

export class HostNet {
  constructor(handlers) {
    this.h = handlers;
    this.conns = new Map();
    this.peer = null;
  }

  start(code) {
    this.peer = new Peer(PREFIX + code, { debug: 1 });
    this.peer.on('open', () => this.h.onOpen());
    this.peer.on('error', e => this.h.onError(e));
    this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch { /* ya destruido */ } });
    this.peer.on('connection', conn => {
      conn.on('data', d => {
        if (!d || typeof d !== 'object') return;
        if (d.t === 'join') {
          if (this.conns.has(conn.peer)) return;
          this.conns.set(conn.peer, conn);
          this.h.onJoin(conn.peer, d.name);
        } else if (this.conns.get(conn.peer) === conn) {
          this.h.onMessage(conn.peer, d);
        }
      });
      const gone = () => {
        if (this.conns.get(conn.peer) === conn) {
          this.conns.delete(conn.peer);
          this.h.onLeave(conn.peer);
        }
      };
      conn.on('close', gone);
      conn.on('error', gone);
    });
  }

  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns.values()) if (c.open) c.send(msg);
  }

  kick(id) {
    const c = this.conns.get(id);
    this.conns.delete(id);
    if (c) c.close();
  }

  destroy() {
    this.conns.clear();
    if (this.peer) this.peer.destroy();
  }
}

export class ClientNet {
  connect(code, name, h) {
    this.closed = false;
    this.peer = new Peer({ debug: 1 });
    this.peer.on('error', e => h.onError(e));
    this.peer.on('open', id => {
      const conn = this.conn = this.peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => {
        conn.send({ t: 'join', name });
        h.onOpen(id);
      });
      conn.on('data', d => {
        if (d && d.t === 'state') h.onState(d.s);
        else if (d && d.t === 'chat') h.onChat(d.m);
        else if (d && d.t === 'chatlog' && Array.isArray(d.list)) d.list.forEach(m => h.onChat(m, true));
        else if (d && d.t === 'full') h.onFull();
      });
      conn.on('close', () => { if (!this.closed) h.onClose(); });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    this.closed = true;
    if (this.peer) this.peer.destroy();
  }
}
