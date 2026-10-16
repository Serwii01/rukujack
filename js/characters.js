// Personajes de los jugadores: sentados en un taburete en su asiento, con cuerpo,
// cara, pelo, ropa y complementos generados a partir de su id (siempre el mismo
// aspecto), gestos según lo que hacen (pedir, plantarse, apostar, ganar, perder)
// y la caída al recibir el disparo del crupier.
import * as THREE from 'three';
import { SEATS, ARC_CZ } from './layout.js';
import { limbMesh, poseLimb, seeded, ease, smooth, loftGeometry, headGeometry, buildHand, curlHand } from './rig.js';
import * as T from './textures.js';

export const AVATAR_R = 2.85;  // distancia del taburete al centro del arco de la mesa
const HIP_Y = -0.3;            // altura de la cadera (la mesa está en y = 0)
const FLOOR_Y = -1.3;
const L_UP = 0.32, L_FORE = 0.34, L_THIGH = 0.37, L_SHIN = 0.6;
const HEAD_Y = 0.84;

const SKIN = ['#f3cfb3', '#e8b48f', '#d09a70', '#a8744c', '#7c5032', '#573522'];
const EYES = ['#3b2a1a', '#2a4a6a', '#3d5a3a', '#1a1410', '#6a4a2a'];
const HAIR = ['#0f0f10', '#2e1c10', '#5a3a1e', '#b89a68', '#7a2a1a', '#cfcfcf', '#14182a'];
const PANTS = ['#16181f', '#1f2b44', '#2a2a2e', '#2b2219', '#3a3d45'];
// Prendas: color, tipo de tejido y si lleva camiseta debajo.
const OUTFITS = {
  hoodie: ['#2b2e3a', '#5a1f2a', '#1f3a2e', '#3a3a3a', '#6b5a3a', '#1c2a4a'],
  leather: ['#141212', '#3a2216', '#1a1a1e'],
  blazer: ['#22252f', '#2f2a24', '#3b1e28', '#1f2e2a'],
  sweater: ['#6b2f2f', '#2f4a5a', '#5a5a4a', '#7a6a4a', '#3a2f4a'],
};
const TEES = ['#e9e6df', '#1a1a1a', '#a33a3a', '#3a5a8a'];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const std = o => new THREE.MeshStandardMaterial(o);
const phys = o => new THREE.MeshPhysicalMaterial(o);

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
    this.nextBlink = 1 + r() * 3;
    this.curl = [0.45, 0.45];

    // Ropa y materiales.
    this.outfit = pick(r, Object.keys(OUTFITS));
    const clothColor = new THREE.Color(pick(r, OUTFITS[this.outfit]));
    const sheenColor = clothColor.clone().lerp(new THREE.Color(0xffffff), 0.12);
    const cloth = {
      hoodie: () => phys({ color: clothColor, roughness: 0.92, sheen: 0.35, sheenRoughness: 0.8, sheenColor, bumpMap: T.fabricBump(8), bumpScale: 1.2 }),
      leather: () => phys({ color: clothColor, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.45, bumpMap: T.leatherBump(3), bumpScale: 1.5 }),
      blazer: () => phys({ color: clothColor, roughness: 0.75, sheen: 0.25, sheenRoughness: 0.6, sheenColor, bumpMap: T.fabricBump(10), bumpScale: 0.8 }),
      sweater: () => phys({ color: clothColor, roughness: 0.96, sheen: 0.4, sheenRoughness: 0.9, sheenColor, bumpMap: T.knitBump(12), bumpScale: 2 }),
    }[this.outfit]();
    const skinColor = new THREE.Color(pick(r, SKIN));
    const hairColor = pick(r, HAIR);
    this.mats = {
      skin: phys({
        color: skinColor, roughness: 0.55, sheen: 0.15, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xff8a70),
        bumpMap: T.skinBump(4), bumpScale: 0.3,
      }),
      lip: std({ color: skinColor.clone().lerp(new THREE.Color(0x8a3a3a), 0.22), roughness: 0.45 }),
      sclera: std({ color: 0xece8e0, roughness: 0.15 }),
      iris: phys({ color: pick(r, EYES), roughness: 0.1, clearcoat: 1 }),
      cloth,
      tee: phys({ color: pick(r, TEES), roughness: 0.9, sheen: 0.2, sheenRoughness: 0.8, bumpMap: T.fabricBump(12), bumpScale: 0.6 }),
      pants: phys({ color: pick(r, PANTS), roughness: 0.88, sheen: 0.2, sheenRoughness: 0.7, bumpMap: T.fabricBump(14), bumpScale: 1 }),
      hair: phys({ color: hairColor, roughness: 0.55, sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color(hairColor).lerp(new THREE.Color(0xffffff), 0.3) }),
      shoe: std({ color: pick(r, ['#0c0c0e', '#e8e6e0', '#3a2a1a', '#8a1f24']), roughness: 0.45 }),
      sole: std({ color: 0xf2f0ea, roughness: 0.7 }),
      accent: new THREE.MeshBasicMaterial({ color: this.accent }),
      chrome: std({ color: 0xbfc4ce, roughness: 0.18, metalness: 1 }),
      cushion: phys({ color: 0x17171b, roughness: 0.45, clearcoat: 0.3, bumpMap: T.leatherBump(2), bumpScale: 1.2 }),
      metal: std({ color: 0x9aa0a8, roughness: 0.3, metalness: 1 }),
      glass: phys({ color: 0x050507, roughness: 0.04, metalness: 0.2, clearcoat: 1 }),
    };

    // Raíz en el taburete, mirando hacia la mesa (+z local = hacia el centro).
    const root = this.root = new THREE.Group();
    const out = seat.out;
    root.position.set(out.x * AVATAR_R, 0, ARC_CZ + out.z * AVATAR_R);
    root.rotation.y = seat.rot + Math.PI;
    scene.add(root);

    this.buildStool();
    this.buildBody(r);
    root.traverse(o => { if (o.isMesh && o.material !== this.mats.accent) o.castShadow = true; });
  }

  buildStool() {
    const m = this.mats;
    const st = this.stool = new THREE.Group();
    st.position.y = FLOOR_Y;
    this.root.add(st);
    // Asiento acolchado con ribete cromado, columna, reposapiés y base.
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.075, 32), m.cushion);
    cushion.position.y = 0.905;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 8, 0, Math.PI * 2, 0, Math.PI * 0.18), m.cushion);
    top.scale.y = 0.4;
    top.position.y = 0.932;
    const piping = new THREE.Mesh(new THREE.TorusGeometry(0.196, 0.006, 6, 32), m.chrome);
    piping.rotation.x = Math.PI / 2;
    piping.position.y = 0.868;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.84, 16), m.chrome);
    pole.position.y = 0.44;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 32), m.chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.36;
    for (const a of [0, 1, 2]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.17, 6), m.chrome);
      strut.rotation.z = Math.PI / 2;
      strut.rotation.y = a * Math.PI / 1.5;
      strut.position.y = 0.36;
      st.add(strut);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.035, 32), m.chrome);
    base.position.y = 0.017;
    st.add(cushion, top, piping, pole, ring, base);
  }

  buildBody(r) {
    const m = this.mats, b = this.build;
    // Todo el cuerpo cuelga de la cadera, para poder caerse de espaldas.
    const body = this.body = new THREE.Group();
    body.position.y = HIP_Y;
    this.root.add(body);

    const pelvis = new THREE.Mesh(loftGeometry([
      { y: -0.08, w: 0.15 * b, d: 0.12 },
      { y: -0.02, w: 0.19 * b, d: 0.15, p: 2.4 },
      { y: 0.06, w: 0.185 * b, d: 0.14, p: 2.4 },
      { y: 0.1, w: 0.17 * b, d: 0.125 },
    ], 28), m.pants);
    body.add(pelvis);
    const belt = new THREE.Mesh(loftGeometry([
      { y: 0.07, w: 0.182 * b, d: 0.137, p: 2.4 }, { y: 0.1, w: 0.174 * b, d: 0.13, p: 2.4 },
    ], 28), std({ color: 0x141210, roughness: 0.4 }));
    const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.026, 0.008), m.metal);
    buckle.position.set(0, 0.085, 0.135);
    body.add(belt, buckle);

    // Piernas (también con IK, para poder estirarlas al caer) y zapatillas.
    this.legs = [-1, 1].map(side => {
      const leg = { side, a: limbMesh(m.pants, 0.06, 0.078), b: limbMesh(m.pants, 0.046, 0.056) };
      leg.joint = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), m.pants);
      const foot = leg.foot = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.09, 4, 12), m.shoe);
      upper.rotation.x = Math.PI / 2;
      upper.scale.set(1, 1, 0.75);
      upper.position.set(0, 0.012, 0.03);
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.17), m.sole);
      sole.position.set(0, -0.022, 0.03);
      foot.add(upper, sole);
      body.add(leg.a, leg.b, leg.joint, foot);
      return leg;
    });

    // Columna: el torso se inclina desde aquí.
    const spine = this.spine = new THREE.Group();
    spine.position.set(0, 0.05, 0);
    body.add(spine);
    const rings = [
      { y: 0.0, w: 0.175 * b, d: 0.125 },
      { y: 0.12, w: 0.178 * b, d: 0.125, p: 2.2 },
      { y: 0.3, w: 0.205 * b, d: 0.142, z: 0.012, p: 2.3 },
      { y: 0.45, w: 0.235 * b, d: 0.148, z: 0.012, p: 2.6 },
      { y: 0.53, w: 0.25 * b, d: 0.138, z: 0.005, p: 3.2 },
      { y: 0.585, w: 0.225 * b, d: 0.118, p: 3.2 },
      { y: 0.625, w: 0.15 * b, d: 0.09, p: 2.4 },
      { y: 0.645, w: 0.06, d: 0.05 },
    ];
    const torso = this.torso = new THREE.Mesh(loftGeometry(rings), m.cloth);
    spine.add(torso);
    this.buildOutfit(r);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.052, 0.16, 16), m.skin);
    neck.position.set(0, 0.69, 0.005);
    spine.add(neck);
    this.shoulderX = 0.205 * b;
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.068, 18, 12), m.cloth);
      cap.scale.set(1, 0.9, 1);
      cap.position.set(sx * this.shoulderX, 0.545, 0);
      spine.add(cap);
    }

    this.buildHead(r);

    // Brazos (manga + puño) y manos con dedos.
    this.arms = [-1, 1].map(side => {
      const arm = { side, a: limbMesh(m.cloth, 0.05, 0.064), b: limbMesh(m.cloth, 0.043, 0.052) };
      arm.joint = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), m.cloth);
      arm.cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 16), m.cloth);
      arm.hand = buildHand(m.skin, side, 1.05);
      arm.cuff.rotation.x = Math.PI / 2;
      arm.cuff.position.z = -0.015;
      arm.hand.add(arm.cuff);
      // Reloj o pulsera de neón en una muñeca.
      if (side === -1) {
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.006, 6, 18), r() < 0.5 ? m.accent : m.metal);
        band.position.z = 0.006;
        arm.hand.add(band);
      }
      arm.cur = new THREE.Vector3(side * 0.13, 0.41, 0.5);
      body.add(arm.a, arm.b, arm.joint, arm.hand);
      return arm;
    });
  }

  // Detalles de cada prenda sobre el torso.
  buildOutfit(r) {
    const m = this.mats, s = this.spine, b = this.build;
    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.rotation.set(rx, ry, rz);
      s.add(o);
      return o;
    };
    if (this.outfit === 'hoodie') {
      // Capucha caída sobre la espalda, cordones y bolsillo canguro.
      const hood = add(new THREE.TorusGeometry(0.1, 0.045, 12, 24, Math.PI * 1.25), m.cloth, 0, 0.62, -0.07, Math.PI / 2 - 0.5, 0, Math.PI * 1.375);
      hood.scale.set(1.15, 1, 0.8);
      for (const sx of [-1, 1]) {
        add(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6), m.sole, sx * 0.035, 0.52, 0.152, -0.12);
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6), m.accent, sx * 0.035, 0.435, 0.162);
      }
      const pocket = add(new THREE.BoxGeometry(0.22 * b, 0.1, 0.012), m.cloth, 0, 0.17, 0.132, -0.04);
      pocket.scale.z = 1.4;
    } else if (this.outfit === 'leather') {
      // Cazadora abierta: camiseta debajo, solapas y cremallera metálica.
      add(new THREE.PlaneGeometry(0.12, 0.38), m.tee, 0, 0.36, 0.162, -0.05);
      for (const sx of [-1, 1]) {
        const lap = new THREE.Shape();
        lap.moveTo(sx * 0.06, 0.12); lap.lineTo(sx * 0.13, 0.27); lap.lineTo(sx * 0.11, 0.3); lap.lineTo(sx * 0.03, 0.27); lap.closePath();
        add(new THREE.ExtrudeGeometry(lap, { depth: 0.01, bevelEnabled: false }), m.cloth, 0, 0.3, 0.135, -0.12);
        add(new THREE.BoxGeometry(0.006, 0.36, 0.008), m.metal, sx * 0.062, 0.33, 0.16, -0.05);
      }
    } else if (this.outfit === 'blazer') {
      // Americana con camisa y solapas en pico.
      const v = new THREE.Shape();
      v.moveTo(-0.075, 0.17); v.lineTo(0.075, 0.17); v.lineTo(0, -0.12); v.closePath();
      add(new THREE.ShapeGeometry(v), m.tee, 0, 0.43, 0.165, -0.08);
      for (const sx of [-1, 1]) {
        const lap = new THREE.Shape();
        lap.moveTo(sx * 0.005, -0.12); lap.lineTo(sx * 0.08, 0.17); lap.lineTo(sx * 0.125, 0.14); lap.lineTo(sx * 0.03, -0.14); lap.closePath();
        add(new THREE.ExtrudeGeometry(lap, { depth: 0.008, bevelEnabled: false }), m.cloth, 0, 0.43, 0.158, -0.08);
      }
      add(new THREE.SphereGeometry(0.008, 8, 6), m.metal, 0, 0.27, 0.163);
      add(new THREE.BoxGeometry(0.03, 0.01, 0.004), m.accent, 0.11 * b, 0.45, 0.158, -0.05, 0.25);
    } else {
      // Jersey de cuello vuelto.
      add(new THREE.CylinderGeometry(0.062, 0.07, 0.07, 18), m.cloth, 0, 0.665, 0.005);
      add(new THREE.TorusGeometry(0.07, 0.012, 8, 20), m.cloth, 0, 0.632, 0.004, Math.PI / 2);
    }
  }

  buildHead(r) {
    const m = this.mats;
    const head = this.head = new THREE.Group();
    head.position.set(0, HEAD_Y, 0.012);
    head.rotation.order = 'YXZ';
    this.spine.add(head);
    const skull = new THREE.Mesh(headGeometry(0.85 + r() * 0.35), m.skin);
    skull.scale.set(0.11, 0.128, 0.118);
    head.add(skull);
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); head.add(o); return o; };

    // Ojos con párpado (para parpadear), cejas, nariz, boca y orejas.
    this.eyes = [-1, 1].map(sx => {
      const eye = new THREE.Group();
      eye.position.set(sx * 0.035, 0.014, 0.094);
      head.add(eye);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 16, 12), m.sclera);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0092, 12, 8), m.iris);
      iris.position.z = 0.0132;
      iris.scale.z = 0.5;
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.0178, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), m.skin);
      lid.rotation.x = -0.35;
      eye.add(ball, iris, lid);
      eye.userData.lid = lid;
      const brow = add(new THREE.CapsuleGeometry(0.0045, 0.026, 3, 6), m.hair, sx * 0.036, 0.042, 0.104);
      brow.rotation.set(0, 0, Math.PI / 2 + sx * 0.12);
      return eye;
    });
    const bridge = add(new THREE.BoxGeometry(0.014, 0.038, 0.02), m.skin, 0, -0.004, 0.108);
    bridge.rotation.x = -0.28;
    const tip = add(new THREE.SphereGeometry(0.013, 12, 10), m.skin, 0, -0.026, 0.118);
    tip.scale.set(1.25, 0.9, 1);
    for (const sx of [-1, 1]) add(new THREE.SphereGeometry(0.009, 8, 6), m.skin, sx * 0.012, -0.03, 0.11);
    const upperLip = add(new THREE.CapsuleGeometry(0.0045, 0.03, 3, 8), m.lip, 0, -0.056, 0.103);
    upperLip.rotation.z = Math.PI / 2;
    const lowerLip = add(new THREE.CapsuleGeometry(0.0056, 0.024, 3, 8), m.lip, 0, -0.064, 0.1);
    lowerLip.rotation.z = Math.PI / 2;
    this.jaw = lowerLip;
    for (const sx of [-1, 1]) {
      const ear = add(new THREE.SphereGeometry(0.026, 12, 10), m.skin, sx * 0.1, -0.005, -0.008);
      ear.scale.set(0.45, 1, 0.75);
    }

    // Vello facial en algunos.
    const fh = r();
    if (fh < 0.18) {
      const beard = add(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), m.hair, 0, -0.01, 0.006);
      beard.scale.set(0.1, 0.138, 0.12);
      add(new THREE.CapsuleGeometry(0.006, 0.04, 3, 8), m.hair, 0, -0.045, 0.11).rotation.z = Math.PI / 2;
    } else if (fh < 0.3) {
      add(new THREE.CapsuleGeometry(0.006, 0.04, 3, 8), m.hair, 0, -0.045, 0.11).rotation.z = Math.PI / 2;
    }

    this.buildHair(r);
    this.buildEyewear(r);
  }

  buildHair(r) {
    const m = this.mats, h = this.head;
    const cap = (mat, sx, sy, sz, y, z = -0.004, thetaLen = Math.PI * 0.5, tilt = -0.18) => {
      const o = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, thetaLen), mat);
      o.scale.set(sx, sy, sz);
      o.position.set(0, y, z);
      o.rotation.x = tilt;
      h.add(o);
      return o;
    };
    const style = pick(r, ['short', 'short', 'long', 'curly', 'bun', 'bald']);
    const hat = r() < 0.4 ? pick(r, ['cap', 'beanie', 'phones']) : this.outfit === 'hoodie' && r() < 0.3 ? 'hood' : null;
    const covered = hat === 'cap' || hat === 'beanie' || hat === 'hood';

    // Pelo.
    if (style !== 'bald' && !(covered && style === 'curly')) {
      if (style === 'curly') {
        const fro = cap(m.hair, 0.15, 0.16, 0.155, 0.02, -0.01, Math.PI * 0.6, -0.25);
        fro.material = m.hair.clone();
        fro.material.bumpMap = T.knitBump(6);
        fro.material.bumpScale = 3;
      } else if (!covered) {
        cap(m.hair, 0.113, 0.14, 0.126, 0.012, -0.006, Math.PI * 0.44, -0.32);
      }
      // Patillas y nuca.
      cap(m.hair, 0.112, 0.125, 0.124, -0.005, -0.014, Math.PI * 0.55, -0.85);
      if (style === 'long') {
        const fall = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.13, 4, 12), m.hair);
        fall.scale.set(1.7, 1, 0.6);
        fall.position.set(0, -0.09, -0.075);
        h.add(fall);
      } else if (style === 'bun' && !covered) {
        const bun = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), m.hair);
        bun.position.set(0, 0.11, -0.085);
        h.add(bun);
      }
    }

    // Gorra, gorro, capucha o cascos.
    if (hat === 'cap') {
      const capMat = phys({ color: new THREE.Color(this.accent).multiplyScalar(0.3), roughness: 0.8, sheen: 0.8, sheenRoughness: 0.7, bumpMap: T.fabricBump(6), bumpScale: 1 });
      cap(capMat, 0.122, 0.11, 0.132, 0.04, -0.004, Math.PI * 0.5, -0.12);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.008, 28, 1, false, -Math.PI / 2, Math.PI), capMat);
      brim.scale.z = 1.2;
      brim.position.set(0, 0.06, 0.1);
      brim.rotation.x = 0.14;
      const button = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), capMat);
      button.position.y = 0.152;
      const logo = new THREE.Mesh(new THREE.CircleGeometry(0.017, 14), m.accent);
      logo.position.set(0, 0.1, 0.115);
      logo.rotation.x = -0.45;
      h.add(brim, button, logo);
    } else if (hat === 'beanie') {
      const knit = phys({ color: pick(r, ['#5a1d24', '#1f3b5a', '#2f4a2a', '#4a4a4a', '#b8862a']), roughness: 0.97, sheen: 1, sheenRoughness: 0.9, bumpMap: T.knitBump(8), bumpScale: 2.5 });
      cap(knit, 0.124, 0.165, 0.134, 0.022, -0.006, Math.PI * 0.52, -0.15);
      const fold = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 10, 30), knit);
      fold.rotation.x = Math.PI / 2 - 0.15;
      fold.position.set(0, 0.035, -0.004);
      h.add(fold);
    } else if (hat === 'hood') {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 18, Math.PI * 0.8, Math.PI * 1.4, 0, Math.PI * 0.7), m.cloth.clone());
      hood.material.side = THREE.DoubleSide;
      hood.scale.set(0.145, 0.165, 0.15);
      hood.position.set(0, 0.0, -0.018);
      h.add(hood);
    } else if (hat === 'phones') {
      const plastic = std({ color: 0x111114, roughness: 0.3 });
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.011, 8, 30, Math.PI), plastic);
      band.position.y = 0.0;
      h.add(band);
      for (const sx of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.046, 0.034, 24), plastic);
        cup.rotation.z = Math.PI / 2;
        cup.position.set(sx * 0.118, -0.008, -0.004);
        const pad = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.01, 8, 20), std({ color: 0x1c1c20, roughness: 0.9 }));
        pad.rotation.y = Math.PI / 2;
        pad.position.set(sx * 0.1, -0.008, -0.004);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.004, 6, 20), m.accent);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(sx * 0.136, -0.008, -0.004);
        h.add(cup, pad, ring);
      }
    }
  }

  buildEyewear(r) {
    const m = this.mats, x = r();
    if (x < 0.15) {
      // Visera de neón (como la del crupier, pero del color del asiento).
      const v = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true, -0.9, 1.8), m.accent);
      v.scale.set(0.112, 0.024, 0.122);
      v.position.y = 0.016;
      this.head.add(v);
    } else if (x < 0.5) {
      // Gafas con montura.
      const frame = std({ color: 0x0b0b0d, roughness: 0.3, metalness: 0.4 });
      const dark = r() < 0.6;
      for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.022, 0.004, 24), dark ? m.glass
          : phys({ color: 0xffffff, transmission: 0.9, roughness: 0.05, transparent: true, opacity: 0.25 }));
        lens.rotation.x = Math.PI / 2;
        lens.scale.set(1.15, 1, 0.9);
        lens.position.set(sx * 0.036, 0.014, 0.112);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.0025, 6, 24), frame);
        rim.scale.set(1.15, 0.9, 1);
        rim.position.copy(lens.position);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.11), frame);
        arm.position.set(sx * 0.096, 0.018, 0.055);
        this.head.add(lens, rim, arm);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.003, 0.003), frame);
      bridge.position.set(0, 0.02, 0.114);
      this.head.add(bridge);
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

    // Parpadeo.
    if (t > this.nextBlink) this.nextBlink = t + 2 + Math.random() * 4;
    const blink = this.dead ? 1 : this.nextBlink - t < 0.12 ? 1 : 0;
    for (const e of this.eyes) e.userData.lid.rotation.x = -0.35 + blink * 1.5;

    // Postura base.
    let lean = 0.12 + breathe * 0.008, pitchAdd = 0;
    const rail = s => _a.set(s * 0.13 + Math.sin(t * 0.7 + this.phase + s) * 0.01, 0.41, 0.5);
    const targets = [rail(-1).clone(), rail(1).clone()];
    const curl = [0.45, 0.45 + Math.max(0, Math.sin(t * 2.3 + this.phase)) * 0.15];
    let point = 0;
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
        curl[1] = 0.8; point = w;
      } else if (g.name === 'wave') {
        R.lerp(_b.set(0.1 + Math.sin(p * Math.PI * 4) * 0.13, 0.5, 0.58), w);
        curl[1] = 0.1;
      } else if (g.name === 'push') {
        R.lerp(_b.set(0.05, 0.36, 0.76), Math.sin(Math.PI * p));
        lean += 0.12 * Math.sin(Math.PI * p);
        curl[1] = 0.2;
      } else if (g.name === 'cheer') {
        const bounce = Math.abs(Math.sin(t * 9)) * 0.06;
        targets[0].lerp(_b.set(-0.28, 1.1 + bounce, 0.12), w);
        R.lerp(_b.set(0.28, 1.1 + bounce, 0.12), w);
        lean -= 0.12 * w;
        pitchAdd -= 0.3 * w;
        curl[0] = curl[1] = 0.95;
      } else if (g.name === 'facepalm') {
        R.lerp(_b.set(0.02, 0.9, 0.24), w);
        pitchAdd += 0.45 * w;
        curl[1] = 0.15;
      } else if (g.name === 'talk') {
        talk = w;
      }
    }

    if (this.dead) { this.updateDead(t); return; }

    this.lean += (lean - this.lean) * ks;
    this.spine.rotation.x = this.lean;
    this.torso.scale.set(1 + breathe * 0.01, 1, 1 + breathe * 0.015);
    this.jaw.position.y = -0.064 - Math.abs(Math.sin(t * 13)) * 0.008 * talk;

    // Mirada: hacia this.look (crupier o sus cartas), con algún vistazo suelto.
    this.root.updateMatrixWorld(true);
    const L = this.body.worldToLocal(_c.copy(this.look));
    const hy = 0.05 + Math.cos(this.lean) * HEAD_Y, hz = Math.sin(this.lean) * HEAD_Y;
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
      this.curl[i] += (curl[i] - this.curl[i]) * k;
      curlHand(arm.hand, this.curl[i], i === 1 ? point : 0);
    });
    this.poseLegs(0);
  }

  poseArm(arm, W) {
    this.spine.updateMatrix();
    const S = _b.set(arm.side * this.shoulderX, 0.545, 0).applyMatrix4(this.spine.matrix);
    const E = poseLimb(arm, S, W, L_UP, L_FORE, _c.set(arm.side * 0.9, -1, -0.6));
    // La mano sigue la dirección del antebrazo, con la palma hacia abajo.
    _a.subVectors(W, E).normalize();
    arm.hand.position.copy(W);
    arm.hand.quaternion.setFromUnitVectors(Z, _a);
  }

  // stretch: 0 sentado con los pies en el aro del taburete, 1 piernas estiradas.
  poseLegs(stretch) {
    for (const leg of this.legs) {
      const H = _a.set(leg.side * 0.1, 0, 0.02);
      const ankle = _b.set(leg.side * 0.12, lerp(-0.6, -0.05, stretch), lerp(0.2, 0.75, stretch));
      poseLimb(leg, H, ankle, L_THIGH, L_SHIN, _c.set(0, 0.6, 1));
      leg.foot.position.set(ankle.x, ankle.y - 0.02, ankle.z + 0.02);
      leg.foot.rotation.set(stretch * -1.2, 0, 0);
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
      curlHand(arm.hand, 0.3);
    });
    this.poseLegs(fall * 0.7);
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
