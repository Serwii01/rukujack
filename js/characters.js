// Personajes de los jugadores: sentados en un taburete en su asiento, con ropa,
// pelo y gafas generados a partir de su id (siempre el mismo aspecto), gestos
// según lo que hacen (pedir, plantarse, apostar, ganar, perder) y la caída al
// recibir el disparo del crupier.
import * as THREE from 'three';
import { SEATS, ARC_CZ } from './layout.js';
import { limbMesh, placeLimb, poseLimb, seeded, ease, smooth } from './rig.js';

export const AVATAR_R = 2.85;  // distancia del taburete al centro del arco de la mesa
const HIP_Y = -0.3;            // altura de la cadera (la mesa está en y = 0)
const FLOOR_Y = -1.3;
const L_UP = 0.32, L_FORE = 0.34, L_THIGH = 0.37, L_SHIN = 0.6;

const SKIN = ['#f1c7a5', '#e3ad86', '#c68a5f', '#9a6440', '#6e4428', '#4f3020'];
const JACKET = ['#1d1f2a', '#2a1c22', '#18251f', '#28241a', '#232323', '#2b3040', '#3a1e2e'];
const PANTS = ['#121318', '#1b2232', '#26262a', '#2a2219'];
const HAIR = ['#0f0f10', '#2e1c10', '#5a3a1e', '#b89a68', '#6d1f1a', '#d6d6d6', '#3a3f5c'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const std = o => new THREE.MeshStandardMaterial(o);

// Duración de cada gesto (s).
const GESTURES = { tap: 0.75, wave: 0.8, push: 0.6, cheer: 1.9, facepalm: 1.7, talk: 1.6 };

export class PlayerAvatar {
  constructor(scene, seatIndex, id) {
    this.scene = scene;
    this.id = id;
    this.seatIndex = seatIndex;
    const seat = SEATS[seatIndex];
    const r = seeded(id + ':' + seatIndex);
    this.accent = new THREE.Color(seat.color);
    this.build = 0.92 + r() * 0.2;
    this.gestures = [];
    this.mood = null;        // 'lose' mientras se ven los resultados de una mano perdida
    this.turn = false;
    this.spectator = false;
    this.dead = null;        // { t0 } al recibir el disparo
    this.look = new THREE.Vector3(0, 1.5, -1.95);
    this.headYaw = 0; this.headPitch = 0; this.lean = 0.12;
    this.phase = r() * 10;   // desfase para que no respiren todos a la vez

    const mats = this.mats = {
      skin: std({ color: pick(r, SKIN), roughness: 0.62 }),
      jacket: std({ color: pick(r, JACKET), roughness: 0.78 }),
      pants: std({ color: pick(r, PANTS), roughness: 0.85 }),
      hair: std({ color: pick(r, HAIR), roughness: 0.7 }),
      shoe: std({ color: 0x0c0c0e, roughness: 0.35, metalness: 0.1 }),
      accent: new THREE.MeshBasicMaterial({ color: this.accent }),
      chrome: std({ color: 0xbfc4ce, roughness: 0.2, metalness: 1 }),
      cushion: std({ color: 0x141418, roughness: 0.5 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: 0.05, metalness: 0.3, clearcoat: 1 }),
    };

    // Raíz en el taburete, mirando hacia la mesa (+z local = hacia el centro).
    const root = this.root = new THREE.Group();
    const out = seat.out;
    root.position.set(out.x * AVATAR_R, 0, ARC_CZ + out.z * AVATAR_R);
    root.rotation.y = seat.rot + Math.PI;
    scene.add(root);

    this.buildStool();
    this.buildBody(r);
  }

  buildStool() {
    const m = this.mats;
    const st = this.stool = new THREE.Group();
    st.position.y = FLOOR_Y;
    this.root.add(st);
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.07, 28), m.cushion);
    cushion.position.y = 0.905;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.84, 12), m.chrome);
    pole.position.y = 0.44;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 28), m.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.36;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.03, 28), m.chrome);
    base.position.y = 0.015;
    for (const o of [cushion, pole, ring, base]) { o.castShadow = true; st.add(o); }
  }

  buildBody(r) {
    const m = this.mats, b = this.build;
    // Todo el cuerpo cuelga de la cadera, para poder caerse de espaldas.
    const body = this.body = new THREE.Group();
    body.position.y = HIP_Y;
    this.root.add(body);

    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), m.pants);
    pelvis.scale.set(0.19 * b, 0.1, 0.15);
    pelvis.position.set(0, 0.03, 0);
    pelvis.castShadow = true;
    body.add(pelvis);

    // Piernas (también con IK, para poder estirarlas al caer).
    this.legs = [-1, 1].map(side => {
      const leg = { side, a: limbMesh(m.pants, 0.058, 0.072), b: limbMesh(m.pants, 0.044, 0.054), joint: null };
      leg.joint = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 8), m.pants);
      leg.foot = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.055, 0.15), m.shoe);
      body.add(leg.a, leg.b, leg.joint, leg.foot);
      return leg;
    });

    // Columna: el torso se inclina desde aquí.
    const spine = this.spine = new THREE.Group();
    spine.position.set(0, 0.05, 0);
    body.add(spine);
    const prof = [[0, 0], [0.17, 0], [0.185, 0.14], [0.21, 0.36], [0.225, 0.5], [0.2, 0.58], [0.12, 0.635], [0, 0.65]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), m.jacket);
    torso.scale.set(1.12 * b, 1, 0.74);
    torso.castShadow = true;
    spine.add(torso);
    this.torso = torso;
    // Cremallera y cuello con vivo de neón del color del asiento.
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.46, 0.008), m.accent);
    zip.position.set(0, 0.33, 0.162);
    zip.rotation.x = -0.06;
    spine.add(zip);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20), m.jacket);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.64;
    spine.add(collar);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.12, 12), m.skin);
    neck.position.y = 0.69;
    spine.add(neck);
    this.shoulderX = 0.2 * b;
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 10), m.jacket);
      cap.position.set(sx * this.shoulderX, 0.555, 0);
      cap.castShadow = true;
      spine.add(cap);
    }

    // Cabeza.
    const head = this.head = new THREE.Group();
    head.position.set(0, 0.83, 0.01);
    head.rotation.order = 'YXZ';
    spine.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), m.skin);
    skull.scale.set(0.112, 0.138, 0.124);
    skull.castShadow = true;
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 12), m.skin);
    jaw.scale.set(1, 0.72, 0.95);
    jaw.position.set(0, -0.07, 0.025);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, 8), m.skin);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, -0.02, 0.127);
    head.add(skull, jaw, nose);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), m.skin);
      ear.scale.set(0.5, 1, 0.75);
      ear.position.set(sx * 0.112, -0.005, -0.005);
      head.add(ear);
    }
    this.buildEyewear(r);
    this.buildHeadwear(r);

    // Brazos y manos.
    this.arms = [-1, 1].map(side => {
      const arm = { side, a: limbMesh(m.jacket, 0.05, 0.062), b: limbMesh(m.jacket, 0.04, 0.05) };
      arm.joint = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), m.jacket);
      arm.hand = this.makeHand(side);
      arm.target = new THREE.Vector3();
      arm.cur = new THREE.Vector3(side * 0.13, 0.41, 0.5);
      body.add(arm.a, arm.b, arm.joint, arm.hand);
      return arm;
    });
  }

  makeHand(side) {
    const m = this.mats;
    const h = new THREE.Group();
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.004, 6, 16), m.accent);
    cuff.position.z = -0.005;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.026, 0.075), m.skin);
    palm.position.z = 0.04;
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.02, 0.05), m.skin);
    fingers.position.set(0, -0.008, 0.095);
    fingers.rotation.x = 0.35;
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.035, 3, 8), m.skin);
    thumb.rotation.set(Math.PI / 2, 0, -side * 0.7);
    thumb.position.set(-side * 0.04, -0.003, 0.045);
    for (const o of [palm, fingers, thumb]) { o.castShadow = true; h.add(o); }
    h.add(cuff);
    return h;
  }

  buildEyewear(r) {
    const m = this.mats;
    if (r() < 0.5) {
      // Visera de neón (como la del crupier, pero del color del asiento).
      const v = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true, -0.95, 1.9), m.accent);
      v.scale.set(0.118, 0.028, 0.13);
      v.position.y = 0.02;
      this.head.add(v);
    } else {
      // Gafas de sol.
      for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.03, 0.01, 20), m.glass);
        lens.rotation.x = Math.PI / 2;
        lens.rotation.z = sx * 0.15;
        lens.position.set(sx * 0.044, 0.02, 0.117);
        this.head.add(lens);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.11), m.shoe);
        arm.position.set(sx * 0.105, 0.025, 0.06);
        this.head.add(arm);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), m.accent);
      bridge.position.set(0, 0.03, 0.124);
      this.head.add(bridge);
    }
  }

  buildHeadwear(r) {
    const m = this.mats, h = this.head;
    const type = Math.floor(r() * 5);
    const cap = (mat, sx, sy, sz, y, thetaLen = Math.PI * 0.55) => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 14, 0, Math.PI * 2, 0, thetaLen), mat);
      o.scale.set(sx, sy, sz);
      o.position.y = y;
      o.castShadow = true;
      h.add(o);
      return o;
    };
    if (type === 0) {
      cap(m.hair, 0.12, 0.13, 0.132, 0.03);
    } else if (type === 1) {
      // Gorra con visera y logo.
      const capMat = std({ color: new THREE.Color(this.accent).multiplyScalar(0.25), roughness: 0.7 });
      cap(capMat, 0.125, 0.1, 0.135, 0.045, Math.PI * 0.5);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 24, 1, false, -Math.PI / 2, Math.PI), capMat);
      brim.scale.z = 1.15;
      brim.position.set(0, 0.05, 0.1);
      brim.rotation.x = 0.12;
      const logo = new THREE.Mesh(new THREE.CircleGeometry(0.018, 12), m.accent);
      logo.position.set(0, 0.095, 0.118);
      logo.rotation.x = -0.45;
      h.add(brim, logo);
    } else if (type === 2) {
      // Gorro de lana con pompón.
      const knit = std({ color: pick(r, ['#5a1d24', '#1f3b5a', '#2f4a2a', '#4a4a4a']), roughness: 0.95 });
      cap(knit, 0.126, 0.16, 0.136, 0.025, Math.PI * 0.52);
      const fold = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.02, 8, 26), knit);
      fold.rotation.x = Math.PI / 2;
      fold.position.y = 0.035;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), knit);
      pom.position.y = 0.19;
      h.add(fold, pom);
    } else if (type === 3) {
      // Capucha (abierta por delante).
      cap(m.hair, 0.118, 0.12, 0.128, 0.035);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 26, 16, Math.PI * 0.78, Math.PI * 1.44, 0, Math.PI * 0.72), m.jacket);
      hood.material = m.jacket.clone();
      hood.material.side = THREE.DoubleSide;
      hood.scale.set(0.15, 0.17, 0.155);
      hood.position.set(0, 0.0, -0.02);
      hood.castShadow = true;
      h.add(hood);
    } else {
      // Cascos con aros de neón.
      cap(m.hair, 0.12, 0.125, 0.13, 0.03);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.132, 0.012, 8, 26, Math.PI), m.shoe);
      band.position.y = 0.0;
      h.add(band);
      for (const sx of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 20), m.shoe);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(sx * 0.128, -0.005, 0);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.006, 6, 18), m.accent);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(sx * 0.147, -0.005, 0);
        h.add(cup, ring);
      }
    }
  }

  // ---------- Estado y gestos ----------

  gesture(name, t, delay = 0) {
    if (this.dead) return;
    this.gestures.push({ name, t0: t + delay, dur: GESTURES[name] || 1 });
  }

  hit(t) { if (!this.dead) this.dead = { t0: t }; }
  // Ya estaba eliminado (por ejemplo, al entrar tarde a la mesa): directamente en el suelo.
  fallen() { if (!this.dead) this.dead = { t0: -100 }; }

  headWorld(out = new THREE.Vector3()) {
    this.root.updateMatrixWorld(true);
    return this.head.localToWorld(out.set(0, 0, 0.02));
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const k in this.mats) this.mats[k].dispose();
  }

  // ---------- Animación ----------

  update(t, dt) {
    const k = 1 - Math.pow(0.002, dt);   // suavizado rápido
    const ks = 1 - Math.pow(0.05, dt);   // suavizado lento
    const breathe = Math.sin(t * 1.6 + this.phase);

    // Postura base.
    let lean = 0.12 + breathe * 0.008, pitchAdd = 0;
    const rail = s => _a.set(s * 0.13 + Math.sin(t * 0.7 + this.phase + s) * 0.01, 0.41, 0.5);
    const targets = [rail(-1).clone(), rail(1).clone()];
    if (this.spectator) {
      lean = -0.04;
      targets[0].set(0.07, 0.42, 0.2);
      targets[1].set(-0.08, 0.45, 0.21);
    } else if (this.turn) {
      lean = 0.26; pitchAdd = 0.35;
    } else if (this.mood === 'lose') {
      lean = 0.3; pitchAdd = 0.55;
    }

    // Gesto activo (el más reciente que ya haya empezado).
    this.gestures = this.gestures.filter(g => t < g.t0 + g.dur);
    const g = [...this.gestures].reverse().find(x => t >= x.t0);
    let talk = 0;
    if (g) {
      const p = (t - g.t0) / g.dur;
      const w = Math.min(1, p / 0.18, (1 - p) / 0.18);
      const R = targets[1];
      if (g.name === 'tap') {
        const tap = _b.set(0.08, 0.33 + Math.abs(Math.sin(p * Math.PI * 2)) * 0.07, 0.72);
        R.lerp(tap, w);
        lean += 0.1 * w;
      } else if (g.name === 'wave') {
        R.lerp(_b.set(0.1 + Math.sin(p * Math.PI * 4) * 0.13, 0.5, 0.58), w);
      } else if (g.name === 'push') {
        R.lerp(_b.set(0.05, 0.36, 0.76), Math.sin(Math.PI * p));
        lean += 0.12 * Math.sin(Math.PI * p);
      } else if (g.name === 'cheer') {
        const bounce = Math.abs(Math.sin(t * 9)) * 0.06;
        targets[0].lerp(_b.set(-0.28, 1.1 + bounce, 0.12), w);
        R.lerp(_b.set(0.28, 1.1 + bounce, 0.12), w);
        lean -= 0.12 * w;
        pitchAdd -= 0.3 * w;
      } else if (g.name === 'facepalm') {
        R.lerp(_b.set(0.02, 0.9, 0.24), w);
        pitchAdd += 0.45 * w;
      } else if (g.name === 'talk') {
        talk = w;
      }
    }

    if (this.dead) { this.updateDead(t); return; }

    this.lean += (lean - this.lean) * ks;
    this.spine.rotation.x = this.lean;
    this.torso.scale.x = 1.12 * this.build * (1 + breathe * 0.012);

    // Mirada: hacia this.look (crupier o sus cartas), con algún vistazo suelto.
    this.root.updateMatrixWorld(true);
    const L = this.body.worldToLocal(_c.copy(this.look));
    const hy = 0.05 + Math.cos(this.lean) * 0.83, hz = Math.sin(this.lean) * 0.83;
    let yaw = Math.atan2(L.x, L.z - hz) + Math.sin(t * 0.23 + this.phase) * 0.12;
    let pitch = Math.atan2(hy - L.y, Math.hypot(L.x, L.z - hz)) - this.lean + pitchAdd;
    yaw = THREE.MathUtils.clamp(yaw, -1.1, 1.1);
    pitch = THREE.MathUtils.clamp(pitch, -0.7, 0.8);
    this.headYaw += (yaw - this.headYaw) * ks;
    this.headPitch += (pitch - this.headPitch) * ks;
    this.head.rotation.y = this.headYaw;
    this.head.rotation.x = this.headPitch + Math.sin(t * 15) * 0.05 * talk;

    this.arms.forEach((arm, i) => {
      arm.cur.lerp(targets[i], k);
      this.poseArm(arm, arm.cur);
    });
    this.poseLegs(0);
  }

  poseArm(arm, W) {
    this.spine.updateMatrix();
    const S = _b.set(arm.side * this.shoulderX, 0.555, 0).applyMatrix4(this.spine.matrix);
    const E = poseLimb(arm, S, W, L_UP, L_FORE, _c.set(arm.side * 0.9, -1, -0.6));
    // La mano sigue la dirección del antebrazo.
    _a.subVectors(W, E).normalize();
    arm.hand.position.copy(W);
    arm.hand.quaternion.setFromUnitVectors(Z, _a);
  }

  // stretch: 0 sentado con los pies en el aro del taburete, 1 piernas estiradas.
  poseLegs(stretch) {
    for (const leg of this.legs) {
      const H = _a.set(leg.side * 0.1, 0, 0.02);
      const ankle = _b.set(leg.side * 0.12, lerp(-0.6, -0.05, stretch), lerp(0.2, 0.75, stretch));
      const knee = poseLimb(leg, H, ankle, L_THIGH, L_SHIN, _c.set(0, 0.6, 1));
      leg.foot.position.set(ankle.x, ankle.y - 0.015, ankle.z + 0.045);
      leg.foot.rotation.set(stretch * -1.2, 0, 0);
      void knee;
    }
  }

  updateDead(t) {
    const e = t - this.dead.t0;
    const k = THREE.MathUtils.clamp(e / 0.95, 0, 1);
    // Sacudida hacia atrás y caída de espaldas del taburete.
    const jolt = Math.min(1, e / 0.08);
    const fall = smooth(k);
    this.body.rotation.x = -0.35 * jolt - 1.17 * fall;
    this.body.position.z = -0.18 * jolt - 0.32 * fall;
    this.body.position.y = HIP_Y - 0.88 * k * k;
    this.stool.rotation.x = -1.45 * ease(THREE.MathUtils.clamp((e - 0.12) / 0.7, 0, 1));
    this.spine.rotation.x = -0.2 * fall;
    this.head.rotation.x = -0.5 * fall;
    this.head.rotation.y = 0.3 * fall;
    this.arms.forEach(arm => {
      const up = _a.set(arm.side * 0.32, 1.0, -0.05);
      const sprawl = _b.set(arm.side * 0.48, 0.55, -0.15);
      arm.cur.copy(up).lerp(sprawl, fall);
      this.poseArm(arm, arm.cur);
    });
    this.poseLegs(fall * 0.7);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
