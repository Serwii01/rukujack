// Escena 3D: sala oscura con neones, mesa en "D" y el crupier enmascarado.
// Se renderiza a baja resolución y se escala con píxeles duros (esencia lo-fi).
import * as THREE from 'three';
import * as T from './textures.js';
import { SEATS, TABLE_W, TABLE_D, TABLE_R, ARC_CZ, BACK_Z, DEALER_CARDS_Z } from './layout.js';

const RETRO_HEIGHT = 420;
const CARD_W = 0.36, CARD_H = 0.5;
const HAND_GAP = 0.4;
const GUN_REST = new THREE.Vector3(0.35, -0.7, -1.5);
const GUN_AIM = new THREE.Vector3(0.25, 0.62, -1.05);
const SHOE = new THREE.Vector3(1.55, 0.2, -0.95);
const DISCARD = new THREE.Vector3(-1.6, 0.06, -0.95);
const DEALER_Z = -1.95;
const CAM_POS = new THREE.Vector3(0, 2.15, 3.05);
const CAM_LOOK = new THREE.Vector3(0, 0.25, -0.45);
const AI_COLOR = '#ff3d7f';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - t, 3);

// Contorno de la mesa en coordenadas de forma (x, y = -z).
function dShape(r, backZ) {
  const s = new THREE.Shape();
  s.moveTo(-r, -backZ);
  s.lineTo(r, -backZ);
  s.lineTo(r, -ARC_CZ);
  s.absarc(0, -ARC_CZ, r, 0, -Math.PI, true);
  s.closePath();
  return s;
}

export class Scene3D {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.retro = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050a);
    this.scene.fog = new THREE.Fog(0x05050a, 7, 15);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 30);

    this.cards = new Map();
    this.chipStacks = SEATS.map(() => ({ group: null, key: '' }));
    this.ringState = null;
    this.mouse = { x: 0, y: 0 };
    this.clock = new THREE.Clock();
    this.onFrame = null;
    this.onBuzz = null;
    this.gaze = 0;
    this.gazeTarget = 0;
    this.nextFlicker = 6;
    this.flickerUntil = 0;
    this.reach = null;
    this.dealerActive = false;
    this.visorColor = new THREE.Color(AI_COLOR);

    this.build();
    addEventListener('resize', () => this.resize());
    addEventListener('pointermove', e => {
      this.mouse.x = e.clientX / innerWidth * 2 - 1;
      this.mouse.y = e.clientY / innerHeight * 2 - 1;
    });
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    if (this.retro) {
      // Modo retro: render a baja resolución escalado con píxeles duros.
      const k = Math.min(1, RETRO_HEIGHT / h);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.round(w * k), Math.round(h * k), false);
    } else {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    // En vertical (móvil) abrimos el campo de visión para que quepa la mesa.
    const need = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / this.camera.aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(need), 55, 105);
    this.camera.updateProjectionMatrix();
  }

  build() {
    const s = this.scene;
    const lambert = o => new THREE.MeshLambertMaterial(o);

    // Luces: la lámpara sobre la mesa manda; neones de relleno.
    s.add(new THREE.AmbientLight(0x3a3f55, 1.0));
    const spot = this.spot = new THREE.SpotLight(0xfff0d8, 120, 0, 0.78, 0.45, 2);
    spot.position.set(0, 3.15, -0.2);
    spot.target.position.set(0, 0, -0.2);
    spot.castShadow = true;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.0008;
    s.add(spot, spot.target);
    this.spotBase = spot.intensity;

    const pink = new THREE.PointLight(0xff3d7f, 10, 9, 2);
    pink.position.set(-3.2, 2.2, -3.6);
    const cyan = new THREE.PointLight(0x38f0ff, 10, 9, 2);
    cyan.position.set(3.2, 2.2, -3.6);
    const fill = new THREE.PointLight(0x9fb4ff, 5, 10, 2);
    fill.position.set(0, 1.7, 3.4);
    const under = new THREE.PointLight(0x38f0ff, 3, 4, 2);
    under.position.set(0, -0.6, 1.8);
    s.add(pink, cyan, fill, under);

    // Sala.
    const wallMat = lambert({ map: T.wall() });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), wallMat);
    back.position.set(0, 1.5, -4.6);
    s.add(back);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), wallMat);
      side.position.set(sx * 5.5, 1.5, -0.5);
      side.rotation.y = -sx * Math.PI / 2;
      s.add(side);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), lambert({ map: T.floor() }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.3;
    floor.receiveShadow = true;
    s.add(floor);

    // Tubos de neón verticales y cartel.
    const tube = (color, x) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, 1.3, -4.5);
      s.add(m);
    };
    tube(0xff3d7f, -3.6); tube(0xff3d7f, -3.35);
    tube(0x38f0ff, 3.35); tube(0x38f0ff, 3.6);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0x38f0ff }));
    strip.position.set(0, 3.05, -4.5);
    s.add(strip);

    const sign = this.sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({
      map: T.neon('RUKUJACK', AI_COLOR), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sign.position.set(-2.2, 2.35, -4.5);
    s.add(sign);
    const sign21 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({
      map: T.neon('21', '#38f0ff'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sign21.position.set(2.4, 2.35, -4.5);
    s.add(sign21);

    // Mesa en "D": cuerpo, tapete, borde acolchado y tira LED.
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(dShape(TABLE_R + 0.18, BACK_Z - 0.16), { depth: 0.32, bevelEnabled: false, curveSegments: 48 }),
      lambert({ color: 0x0c0c10 }),
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = -0.32;
    body.receiveShadow = true;
    s.add(body);

    const feltGeo = new THREE.ShapeGeometry(dShape(TABLE_R, BACK_Z), 48);
    const uv = feltGeo.attributes.uv, pos = feltGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (pos.getX(i) + TABLE_W / 2) / TABLE_W, (pos.getY(i) + TABLE_D / 2) / TABLE_D);
    }
    const felt = new THREE.Mesh(feltGeo, lambert({ map: T.felt() }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.002;
    felt.receiveShadow = true;
    s.add(felt);

    const railShape = dShape(TABLE_R + 0.18, BACK_Z - 0.16);
    railShape.holes.push(dShape(TABLE_R, BACK_Z));
    const rail = new THREE.Mesh(
      new THREE.ExtrudeGeometry(railShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 48 }),
      new THREE.MeshPhongMaterial({ map: T.leather(), shininess: 40, specular: 0x333340 }),
    );
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0;
    rail.castShadow = rail.receiveShadow = true;
    s.add(rail);

    const ledPts = [];
    for (let i = 0; i <= 64; i++) {
      const t = -Math.PI / 2 + Math.PI * i / 64;
      ledPts.push(new THREE.Vector3(Math.sin(t) * (TABLE_R + 0.2), -0.05, ARC_CZ + Math.cos(t) * (TABLE_R + 0.2)));
    }
    this.ledMat = new THREE.MeshBasicMaterial({ color: 0x38f0ff });
    const led = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ledPts), 128, 0.014, 6), this.ledMat);
    s.add(led);

    // Zapato de cartas.
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.5), new THREE.MeshPhongMaterial({ color: 0x15161c, shininess: 60 }));
    shoe.position.set(SHOE.x, 0.1, SHOE.z);
    shoe.rotation.y = -0.4;
    shoe.castShadow = true;
    s.add(shoe);
    const shoeTop = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W * 0.9, CARD_H * 0.9), lambert({ map: T.cardBack(), alphaTest: 0.5 }));
    shoeTop.rotation.set(-Math.PI / 2 + 0.25, 0, -0.4);
    shoeTop.position.set(SHOE.x, 0.205, SHOE.z);
    s.add(shoeTop);

    // Lámpara colgante (la que parpadea).
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 0.3, 24, 1, true),
      new THREE.MeshPhongMaterial({ color: 0x1b1c22, side: THREE.DoubleSide, shininess: 50 }));
    shade.position.set(0, 3.35, -0.2);
    s.add(shade);
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), this.bulbMat);
    bulb.position.set(0, 3.22, -0.2);
    s.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 3, 5), lambert({ color: 0x111111 }));
    cord.position.set(0, 5.0, -0.2);
    s.add(cord);

    this.buildDealer();
    this.buildDust();
    this.buildGun();

    // Anillos de asiento: tu sitio y el turno.
    this.rings = SEATS.map(seat => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.2, 28), new THREE.MeshBasicMaterial({
        color: seat.color, transparent: true, opacity: 0, depthWrite: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(seat.chip.x, 0.006, seat.chip.z);
      s.add(m);
      return m;
    });

    this.backMat = lambert({ map: T.cardBack(), alphaTest: 0.5 });
    this.cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    this.chipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.022, 16);
    this.chipMats = [0xd3203d, 0xf0ece2, 0x2457c5, 0x17181d, 0x1e9e6a].map(c => new THREE.MeshPhongMaterial({ color: c, shininess: 30 }));
  }

  buildDealer() {
    const s = this.scene;
    const suit = new THREE.MeshLambertMaterial({ color: 0x2c2e3a });
    // Contraluz para recortar la silueta del crupier contra el fondo.
    const backLight = new THREE.SpotLight(0xb0a0ff, 25, 6, 0.6, 0.6, 2);
    backLight.position.set(0, 3.2, -3.6);
    backLight.target.position.set(0, 1.0, DEALER_Z);
    s.add(backLight, backLight.target);
    const frontLight = new THREE.SpotLight(0xfff0d8, 8, 4, 0.5, 0.7, 2);
    frontLight.position.set(0, 0.4, -0.6);
    frontLight.target.position.set(0, 1.3, DEALER_Z);
    s.add(frontLight, frontLight.target);
    const shirt = new THREE.MeshLambertMaterial({ color: 0x0e0f13 });
    const glove = new THREE.MeshPhongMaterial({ color: 0x18181d, shininess: 30 });
    this.accentMat = new THREE.MeshBasicMaterial({ color: AI_COLOR });
    const d = this.dealer = new THREE.Group();
    d.position.set(0, 0, DEALER_Z);
    s.add(d);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.58, 1.6, 14), suit);
    torso.position.y = 0.2;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), suit);
    shoulders.scale.set(1.45, 0.4, 0.78);
    shoulders.position.y = 0.98;
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.04), shirt);
    front.position.set(0, 0.76, 0.46);
    front.rotation.x = -0.1;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.32, 10), shirt);
    neck.position.y = 1.18;
    // Solapas con filo de neón.
    for (const sx of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.5, 0.012), this.accentMat);
      lapel.position.set(sx * 0.12, 0.76, 0.49);
      lapel.rotation.set(-0.1, 0, sx * 0.18);
      d.add(lapel);
    }
    for (const m of [torso, shoulders, front, neck]) { m.castShadow = true; d.add(m); }

    // Cabeza: casco liso con visera luminosa.
    const head = this.head = new THREE.Group();
    head.position.y = 1.52;
    d.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshPhongMaterial({
      color: 0x24252d, specular: 0x8890a0, shininess: 90,
    }));
    helmet.scale.set(0.3, 0.38, 0.31);
    helmet.castShadow = true;
    head.add(helmet);

    this.visorTex = T.visor();
    this.visorMat = new THREE.MeshBasicMaterial({ map: this.visorTex, color: AI_COLOR });
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true, -1.15, 2.3), this.visorMat);
    visor.scale.set(0.305, 0.075, 0.315);
    visor.position.y = 0.03;
    head.add(visor);
    this.visorLight = new THREE.PointLight(AI_COLOR, 1.2, 1.5, 2);
    this.visorLight.position.set(0, 0.03, 0.5);
    head.add(this.visorLight);
    // "Auriculares" laterales.
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 16), helmet.material);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(sx * 0.29, 0.02, 0);
      head.add(ear);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 20), this.accentMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * 0.325, 0.02, 0);
      head.add(ring);
    }

    // Manos enguantadas.
    this.hands = [-1, 1].map(side => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.06, 0.19), glove);
      g.add(palm);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.016, 0.15, 6), glove);
        f.rotation.x = Math.PI / 2;
        f.position.set(-0.06 + i * 0.04, -0.008, 0.16 - Math.abs(i - 1.5) * 0.015);
        g.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.11, 6), glove);
      thumb.rotation.set(Math.PI / 2, 0, side * 0.9);
      thumb.position.set(-side * 0.1, 0, 0.05);
      g.add(thumb);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 12), this.accentMat);
      cuff.rotation.x = Math.PI / 2 - 0.25;
      cuff.position.set(0, 0.02, -0.12);
      g.add(cuff);
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.7, 10), suit);
      sleeve.rotation.x = Math.PI / 2 - 0.25;
      sleeve.position.set(0, 0.07, -0.47);
      g.add(sleeve);
      g.traverse(o => { o.castShadow = true; });
      const base = new THREE.Vector3(side * 0.62, 0.045, -1.18);
      g.position.copy(base);
      g.rotation.y = -side * 0.25;
      g.userData.base = base;
      s.add(g);
      return g;
    });
  }

  buildDust() {
    const N = 220;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.6;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 3;
      pos[i * 3 + 2] = Math.sin(a) * r - 0.2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xdde4ff, size: 0.016, transparent: true, opacity: 0.45, depthWrite: false,
    }));
    this.scene.add(this.dust);
  }

  makeCard() {
    const g = new THREE.Group();
    const front = new THREE.Mesh(this.cardGeo, new THREE.MeshLambertMaterial({ map: T.cardBlank(), alphaTest: 0.5 }));
    front.rotation.x = -Math.PI / 2;
    front.position.y = 0.001;
    const back = new THREE.Mesh(this.cardGeo, this.backMat);
    back.rotation.x = Math.PI / 2;
    g.add(front, back);
    g.userData.front = front;
    return g;
  }

  animate(m, to, rotY, flip, dur = 0.45) {
    const u = m.userData;
    u.from = m.position.clone();
    u.to = to.clone();
    u.fromRotY = m.rotation.y; u.toRotY = rotY;
    u.fromFlip = m.rotation.z; u.toFlip = flip;
    u.t0 = this.clock.elapsedTime;
    u.dur = dur;
  }

  // Sincroniza la escena con el estado de la mesa.
  update(state, myId) {
    const wanted = new Map();
    const dn = state.dealer.hand.length;
    const dStep = dn > 5 ? 0.3 : 0.4;
    state.dealer.hand.forEach((c, i) => {
      wanted.set(c.id, { c, pos: new THREE.Vector3((i - (dn - 1) / 2) * dStep, 0.004 + i * 0.002, DEALER_CARDS_Z), rotY: 0 });
    });
    // Cartas de cada mano en cascada (la esquina superior izquierda queda a la vista);
    // las manos separadas se colocan una al lado de otra.
    for (const p of state.players) {
      const seat = SEATS[p.seat];
      const cr = Math.cos(seat.rot), sr = Math.sin(seat.rot);
      const H = p.hands.length;
      p.hands.forEach((hand, hi) => {
        const n = hand.cards.length;
        const hx = (hi - (H - 1) / 2) * HAND_GAP;
        hand.cards.forEach((c, i) => {
          const lx = hx + (i - (n - 1) / 2) * 0.085;
          const lz = (i - (n - 1) / 2) * 0.06;
          wanted.set(c.id, {
            c,
            pos: new THREE.Vector3(seat.x + lx * cr + lz * sr, 0.004 + i * 0.003, seat.z - lx * sr + lz * cr),
            rotY: seat.rot,
          });
        });
      });
    }

    for (const [id, w] of wanted) {
      let m = this.cards.get(id);
      if (!m) {
        m = this.makeCard();
        m.position.copy(SHOE);
        m.rotation.set(0, -0.4, Math.PI);
        this.cards.set(id, m);
        this.scene.add(m);
        this.reach = { to: w.pos.clone(), t0: this.clock.elapsedTime };
      }
      const faceUp = !w.c.hidden;
      if (faceUp && !m.userData.faceSet) {
        m.userData.front.material.map = T.cardFace(w.c.r, w.c.s);
        m.userData.front.material.needsUpdate = true;
        m.userData.faceSet = true;
      }
      const flip = faceUp ? 0 : Math.PI;
      const u = m.userData;
      if (!u.to || !u.to.equals(w.pos) || u.toFlip !== flip) this.animate(m, w.pos, w.rotY, flip);
    }

    for (const [id, m] of this.cards) {
      if (wanted.has(id) || m.userData.leaving) continue;
      m.userData.leaving = true;
      const to = DISCARD.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.05, (Math.random() - 0.5) * 0.1));
      this.animate(m, to, Math.random() - 0.5, Math.PI, 0.6);
      m.userData.removeAt = this.clock.elapsedTime + 0.65;
    }

    // Fichas apostadas.
    SEATS.forEach((seat, i) => {
      const p = state.players.find(x => x.seat === i);
      const total = p ? (p.hands.length ? p.hands.reduce((a, h) => a + h.bet, 0) : p.bet) : 0;
      const show = p && p.id !== state.dealer.id && total > 0 && (p.ready || p.status !== 'idle');
      const n = show ? Math.min(16, Math.max(1, Math.ceil(total / 25))) : 0;
      const st = this.chipStacks[i];
      const key = String(n);
      if (st.key === key) return;
      st.key = key;
      if (st.group) this.scene.remove(st.group);
      st.group = null;
      if (!n) return;
      const g = new THREE.Group();
      for (let k = 0; k < n; k++) {
        const chip = new THREE.Mesh(this.chipGeo, this.chipMats[Math.floor(k / 3) % this.chipMats.length]);
        chip.position.set((Math.random() - 0.5) * 0.01, 0.013 + k * 0.023, (Math.random() - 0.5) * 0.01);
        chip.castShadow = true;
        g.add(chip);
      }
      g.position.set(seat.chip.x, 0, seat.chip.z);
      this.scene.add(g);
      st.group = g;
    });

    // Anillos, color del crupier y mirada.
    this.ringState = SEATS.map((_, i) => {
      const p = state.players.find(x => x.seat === i);
      const present = !!p && p.id !== state.dealer.id && p.role === 'player';
      return { present, mine: present && p.id === myId, turn: present && p.id === state.turn };
    });
    const dp = state.dealer.id && state.players.find(p => p.id === state.dealer.id);
    this.visorColor.set(dp ? SEATS[dp.seat].color : AI_COLOR);
    this.dealerActive = state.phase === 'dealer' || state.phase === 'dealing';

    const turnP = state.players.find(p => p.id === state.turn);
    const me = state.players.find(p => p.id === myId);
    const look = turnP || (state.phase === 'betting' || !me || me.id === state.dealer.id ? null : me);
    if (!this.gunAnim) this.gazeTarget = look ? Math.atan2(SEATS[look.seat].x, SEATS[look.seat].z - DEALER_Z) : 0;
  }

  // Escopeta de dos cañones que el crupier saca de debajo de la mesa.
  buildGun() {
    const g = this.gun = new THREE.Group();
    const metal = new THREE.MeshPhongMaterial({ color: 0x2a2b30, specular: 0x999999, shininess: 80 });
    const wood = new THREE.MeshLambertMaterial({ color: 0x4a2a16 });
    const body = this.gunBody = new THREE.Group();
    g.add(body);
    for (const x of [-0.028, 0.028]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.85, 12), metal);
      b.rotation.x = Math.PI / 2;
      b.position.set(x, 0, 0.42);
      body.add(b);
    }
    const recv = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.22), metal);
    recv.position.set(0, -0.01, -0.08);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.22, 10), wood);
    pump.rotation.x = Math.PI / 2;
    pump.position.set(0, -0.05, 0.3);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.42), wood);
    stock.position.set(0, -0.07, -0.38);
    stock.rotation.x = 0.18;
    body.add(recv, pump, stock);
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), this.flashMat);
    flash.scale.set(1, 1, 2.2);
    flash.position.set(0, 0, 1.0);
    body.add(flash);
    this.gunLight = new THREE.PointLight(0xffb060, 0, 7, 2);
    this.gunLight.position.set(0, 0, 1.0);
    body.add(this.gunLight);
    g.traverse(o => { o.castShadow = true; });
    g.scale.setScalar(1.4);
    g.visible = false;
    this.scene.add(g);
    this.gunAnim = null;
  }

  // target: punto al que apunta (null = sin escopeta). onFire se llama al disparar.
  shoot(target, onFire) {
    if (!target) { setTimeout(onFire, 600); return; }
    const restQ = new THREE.Quaternion(), aimQ = new THREE.Quaternion();
    const dummy = new THREE.Object3D();
    dummy.position.copy(GUN_REST);
    dummy.lookAt(GUN_REST.x, GUN_REST.y - 1, GUN_REST.z + 1);
    restQ.copy(dummy.quaternion);
    dummy.position.copy(GUN_AIM);
    dummy.lookAt(target);
    aimQ.copy(dummy.quaternion);
    this.gunAnim = { t0: this.clock.elapsedTime, restQ, aimQ, onFire, fired: false };
    this.gazeTarget = Math.atan2(target.x, target.z - DEALER_Z);
  }

  shake(amp, dur) {
    this.shakeAmp = amp;
    this.shakeDur = dur;
    this.shakeEnd = this.clock.elapsedTime + dur;
  }

  setRetro(on) {
    this.retro = on;
    this.resize();
  }

  seatTarget(seat) {
    const s = SEATS[seat];
    return new THREE.Vector3(s.x + s.out.x * 0.9, 1.0, s.z + s.out.z * 0.9);
  }

  cameraTarget() {
    return CAM_POS.clone();
  }

  updateGun(t) {
    const a = this.gunAnim, g = this.gun, body = this.gunBody;
    const e = t - a.t0;
    g.visible = true;
    if (e < 0.9) {
      const k = ease(e / 0.9);
      g.position.lerpVectors(GUN_REST, GUN_AIM, k);
      g.quaternion.slerpQuaternions(a.restQ, a.aimQ, k);
    } else if (e < 2.3) {
      g.position.copy(GUN_AIM);
      g.position.y += Math.sin(t * 23) * 0.002;
      g.quaternion.copy(a.aimQ);
    } else if (e < 3.0) {
      const k = ease((e - 2.3) / 0.7);
      g.position.lerpVectors(GUN_AIM, GUN_REST, k);
      g.quaternion.slerpQuaternions(a.aimQ, a.restQ, k);
    } else {
      g.visible = false;
      this.gunAnim = null;
      this.flashMat.opacity = 0;
      this.gunLight.intensity = 0;
      return;
    }
    if (!a.fired && e >= 1.3) {
      a.fired = true;
      a.fireT = t;
      if (a.onFire) a.onFire();
    }
    if (a.fired) {
      const r = t - a.fireT;
      const k = Math.max(0, 1 - r / 0.35);
      body.position.z = -0.12 * k;
      body.rotation.x = -0.35 * k;
      this.flashMat.opacity = r < 0.07 ? 1 : 0;
      this.gunLight.intensity = r < 0.09 ? 80 : 0;
    } else {
      body.position.z = 0;
      body.rotation.x = 0;
    }
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  }

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;

    this.camera.position.set(CAM_POS.x + this.mouse.x * 0.18, CAM_POS.y - this.mouse.y * 0.08 + Math.sin(t * 0.6) * 0.01, CAM_POS.z);
    this.camera.lookAt(CAM_LOOK.x + this.mouse.x * 0.1, CAM_LOOK.y - this.mouse.y * 0.06, CAM_LOOK.z);
    if (this.shakeEnd && t < this.shakeEnd) {
      const k = (this.shakeEnd - t) / this.shakeDur * this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.rotation.z += (Math.random() - 0.5) * k * 0.5;
    }
    if (this.gunAnim) this.updateGun(t);

    // Parpadeo ocasional de la lámpara.
    if (t > this.nextFlicker) {
      this.flickerUntil = t + 0.1 + Math.random() * 0.3;
      this.nextFlicker = t + 8 + Math.random() * 14;
      if (this.onBuzz) this.onBuzz();
    }
    const k = t < this.flickerUntil ? (Math.random() < 0.5 ? 0.2 : 0.95) : 1;
    this.spot.intensity = this.spotBase * k;
    this.bulbMat.color.setScalar(0.3 + 0.7 * k);

    // Colores de acento: visera, solapas y LED de la mesa siguen al crupier.
    const pulse = this.dealerActive ? 0.75 + Math.sin(t * 5) * 0.25 : 0.9 + Math.sin(t * 1.5) * 0.1;
    this.visorMat.color.copy(this.visorColor).multiplyScalar(pulse);
    this.visorLight.color.copy(this.visorColor);
    this.accentMat.color.copy(this.visorColor);
    this.ledMat.color.copy(this.visorColor).multiplyScalar(0.8);

    // Crupier: respiración, mirada y visera que sigue al jugador.
    this.dealer.position.y = Math.sin(t * 1.1) * 0.01;
    this.gaze = lerp(this.gaze, this.gazeTarget, 1 - Math.pow(0.03, dt));
    const h = this.head;
    h.rotation.y = this.gaze * 0.7 + Math.sin(t * 0.37) * 0.04;
    h.rotation.x = 0.1 + Math.sin(t * 0.5) * 0.02;
    h.rotation.z = Math.sin(t * 0.3) * 0.03;
    this.visorTex.offset.x = THREE.MathUtils.clamp(-this.gaze * 0.06, -0.12, 0.12);

    // Mano derecha que alcanza cada carta repartida.
    const [lh, rh] = this.hands;
    lh.position.copy(lh.userData.base);
    lh.position.y += Math.sin(t * 1.3 + 1) * 0.006;
    rh.position.copy(rh.userData.base);
    if (this.reach) {
      const rt = (t - this.reach.t0) / 0.5;
      if (rt >= 1) this.reach = null;
      else {
        rh.position.lerp(this.reach.to, Math.sin(Math.PI * rt) * 0.35);
        rh.position.y = rh.userData.base.y + Math.sin(Math.PI * rt) * 0.06;
      }
    } else rh.position.y += Math.sin(t * 1.2) * 0.006;

    // Animación de cartas.
    for (const [id, m] of this.cards) {
      const u = m.userData;
      if (u.t0 !== undefined) {
        const p = Math.min(1, (t - u.t0) / u.dur);
        const e = ease(p);
        m.position.lerpVectors(u.from, u.to, e);
        m.position.y += Math.sin(Math.PI * p) * 0.16;
        m.rotation.y = lerp(u.fromRotY, u.toRotY, e);
        m.rotation.z = lerp(u.fromFlip, u.toFlip, e);
      }
      if (u.removeAt && t > u.removeAt) {
        this.scene.remove(m);
        u.front.material.dispose();
        this.cards.delete(id);
      }
    }

    if (this.ringState) this.rings.forEach((r, i) => {
      const st = this.ringState[i];
      let op = 0;
      if (st.turn) op = 0.6 + Math.sin(t * 6) * 0.35;
      else if (st.mine) op = 0.55;
      else if (st.present) op = 0.18;
      r.material.opacity = op;
    });

    const pos = this.dust.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * 0.03;
      if (y > 3) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.01);
    }
    pos.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
    if (this.onFrame) this.onFrame();
  }
}
