// Escena 3D: sala oscura con neones, mesa en "D" y el crupier enmascarado.
// Se renderiza a baja resolución y se escala con píxeles duros (esencia lo-fi).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as T from './textures.js';
import { SEATS, TABLE_W, TABLE_D, TABLE_R, ARC_CZ, BACK_Z, DEALER_CARDS_Z } from './layout.js';

const RETRO_HEIGHT = 420;
const CARD_W = 0.36, CARD_H = 0.5;
const HAND_GAP = 0.4;
const GUN_REST = new THREE.Vector3(0.35, -0.7, -1.5);
const GUN_AIM = new THREE.Vector3(0.25, 0.62, -1.05);
const CHIP_DENOMS = [
  { v: 500, color: '#7a3fc4' },
  { v: 100, color: '#17181d' },
  { v: 50, color: '#1e9e6a' },
  { v: 25, color: '#d3203d' },
  { v: 10, color: '#2457c5' },
  { v: 5, color: '#e8e4da', stripe: '#d3203d' },
  { v: 1, color: '#9aa0ab' },
];
const STACK_MAX = 10;
// Huecos para las pilas alrededor del círculo de apuesta (x lateral, z hacia el jugador).
const STACK_SLOTS = [[0, 0], [0.165, 0.02], [-0.165, 0.02], [0.085, 0.15], [-0.085, 0.15], [0.25, 0.15], [-0.25, 0.15], [0, -0.15]];
const SHOE_POS =new THREE.Vector3(1.6, 0, -0.95);
const SHOE_YAW = -0.95;               // la ranura mira hacia la mano del crupier
const SHOE = new THREE.Vector3();     // de aquí sale cada carta (se calcula al construir el zapato)
const DISCARD = new THREE.Vector3(-1.6, 0.06, -0.95);
const DEALER_Z = -1.95;
const CAM_POS = new THREE.Vector3(0, 2.15, 3.05);
const CAM_LOOK = new THREE.Vector3(0, 0.25, -0.45);
const AI_COLOR = '#ff3d7f';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - t, 3);
const _up = new THREE.Vector3(0, 1, 0);
const _red = new THREE.Color(0xff2030);
const DARK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const [_v1, _v2, _v3, _v4, _v5, _v6] = [...Array(6)].map(() => new THREE.Vector3());

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

    this.buildEnv();
    this.build();

    // Postproceso con bloom selectivo: solo brillan los materiales "de luz"
    // (neones, visera, LED, acentos). Se renderiza la escena con todo lo demás en
    // negro y ese resplandor se suma a la imagen normal.
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.35, 0);
    this.bloomComposer.addPass(this.bloom);
    const mix = new ShaderPass(new THREE.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: this.bloomComposer.renderTarget2.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
    }), 'baseTexture');
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(mix);
    this.composer.addPass(new OutputPass());

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
    // Modo retro: render a baja resolución escalado con píxeles duros.
    const k = this.retro ? Math.min(1, RETRO_HEIGHT / h) : 1;
    const pr = this.retro ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    const rw = Math.round(w * k), rh = Math.round(h * k);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(rw, rh, false);
    for (const c of [this.composer, this.bloomComposer]) { c.setPixelRatio(pr); c.setSize(rw, rh); }
    this.camera.aspect = w / h;
    // En vertical (móvil) abrimos el campo de visión para que quepa la mesa.
    const need = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(40)) / this.camera.aspect);
    this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(need), 55, 105);
    this.camera.updateProjectionMatrix();
  }

  // Mapa de entorno propio (sala oscura con neones rosa y cian y la lámpara):
  // los materiales PBR reflejan la sala en lugar de un cielo genérico.
  buildEnv() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x020205);
    const panel = (color, k, w, h, x, y, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide,
      }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(0xfff0d8, 3, 1.4, 1.4, 0, 4, 0);
    panel(0xff3d7f, 1.2, 0.4, 5, -4, 1, -3);
    panel(0x38f0ff, 1.2, 0.4, 5, 4, 1, -3);
    panel(0x9fb4ff, 0.12, 8, 2, 0, 1, 5);
    panel(0xffb060, 0.4, 4, 0.3, 0, 0.5, -4.5);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(env, 0.03).texture;
    pmrem.dispose();
  }

  build() {
    const s = this.scene;
    const lambert = o => new THREE.MeshLambertMaterial(o);
    const std = o => new THREE.MeshStandardMaterial(o);

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

    this.buildBar();

    // Mesa en "D": cuerpo de madera, faldón metálico, pie, tapete, borde acolchado y tira LED.
    const woodMat = std({ map: T.wood(), roughness: 0.45, metalness: 0.05, envMapIntensity: 0.6 });
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(dShape(TABLE_R + 0.18, BACK_Z - 0.16), {
        depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3, curveSegments: 64,
      }),
      woodMat,
    );
    body.rotation.x = -Math.PI / 2;
    body.position.y = -0.18;
    body.receiveShadow = true;
    s.add(body);
    const apron = new THREE.Mesh(
      new THREE.ExtrudeGeometry(dShape(TABLE_R + 0.06, BACK_Z - 0.06), { depth: 0.22, bevelEnabled: false, curveSegments: 64 }),
      std({ color: 0x0b0b0f, roughness: 0.5, metalness: 0.4 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.42;
    s.add(apron);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 0.9, 24), std({ color: 0x0b0b0f, roughness: 0.3, metalness: 0.7 }));
    pedestal.position.set(0, -0.86, -0.4);
    s.add(pedestal);

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
      std({ map: T.leather(), roughness: 0.5, metalness: 0, envMapIntensity: 0.5 }),
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

    this.buildShoe();

    // Lámpara colgante (la que parpadea).
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.55, 0.3, 32, 1, true),
      std({ color: 0x1b1c22, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.8 }));
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
    this.chipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.022, 28);
    // Cilindro: grupo 0 = canto, 1 = cara de arriba, 2 = cara de abajo.
    // Denominaciones (mismos colores que los botones de apuesta).
    this.denoms = CHIP_DENOMS.map(d => {
      const tx = T.chip(d.color, d.stripe, String(d.v));
      const side = std({ map: tx.side, roughness: 0.4 });
      const face = std({ map: tx.face, roughness: 0.35 });
      return { ...d, mats: [side, face, face] };
    });
    this.chipMats = this.denoms.filter(d => d.v >= 10).map(d => d.mats);
    this.buildTray();
  }

  // Zapato de cartas: cuerpo lacado con frontal inclinado, mazo visible con sus
  // cantos de papel, tope delantero, embellecedores cromados y filo de neón.
  buildShoe() {
    const L = 0.72, W = 0.46, HB = 0.3, HF = 0.07, TOP = -0.08;
    const g = new THREE.Group();
    g.position.copy(SHOE_POS);
    g.rotation.y = SHOE_YAW;
    this.scene.add(g);

    // Perfil lateral (x de la forma = z local, hacia delante; y = altura), extruido a lo ancho.
    const p = new THREE.Shape();
    p.moveTo(-L / 2, 0);
    p.lineTo(L / 2, 0);
    p.lineTo(L / 2, HF);
    p.lineTo(TOP, HB);
    p.lineTo(-L / 2, HB);
    p.closePath();
    const geo = new THREE.ExtrudeGeometry(p, { depth: W, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3 });
    geo.rotateY(-Math.PI / 2);
    geo.translate(W / 2, 0, 0);
    const body = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0x101116, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06,
    }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);

    // Marco apoyado en la cara inclinada: +z baja hacia la ranura, +y sale de la cara.
    const dz = L / 2 - TOP, dy = HB - HF;
    const slope = Math.atan2(dy, dz), len = Math.hypot(dz, dy);
    const f = new THREE.Group();
    f.position.set(0, (HB + HF) / 2, (L / 2 + TOP) / 2);
    f.rotation.x = slope;
    g.add(f);

    const back = new THREE.MeshLambertMaterial({ map: T.cardBack() });
    const edge = new THREE.MeshLambertMaterial({ map: T.deckEdge() });
    const deckT = 0.11, deckL = Math.min(len - 0.06, CARD_H);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, deckT, deckL), [edge, edge, back, back, edge, edge]);
    deck.position.set(0, 0.05 - deckT / 2, -0.01);
    deck.castShadow = true;
    f.add(deck);

    const trimMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, roughness: 0.18, metalness: 1 });
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, len), trimMat);
      rail.position.set(sx * (W / 2 - 0.0175), 0.015, 0);
      f.add(rail);
    }
    // Tope que sujeta las cartas y por donde las saca el crupier.
    const stop = new THREE.Mesh(new THREE.BoxGeometry(W - 0.07, 0.045, 0.03), trimMat);
    stop.position.set(0, 0.022, len / 2 - 0.02);
    f.add(stop);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0x38f0ff }));
    lip.position.set(0, HF + 0.006, L / 2 + 0.008);
    g.add(lip);
    // Placa trasera con el logo.
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.065), new THREE.MeshBasicMaterial({
      map: T.neon('RUKUJACK', AI_COLOR), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    plate.position.set(0, HB * 0.55, -L / 2 - 0.013);
    plate.rotation.y = Math.PI;
    g.add(plate);

    g.updateMatrixWorld(true);
    deck.localToWorld(SHOE.set(0, deckT / 2 + 0.008, 0));
  }

  // Bandeja de fichas delante del crupier: rulos de fichas tumbadas.
  buildTray() {
    const s = this.scene;
    const W = 1.0, D = 0.2, Z = -1.1;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, D), new THREE.MeshStandardMaterial({ color: 0x0d0d12, roughness: 0.25, metalness: 0.6 }));
    tray.position.set(0, 0.015, Z);
    tray.receiveShadow = true;
    s.add(tray);
    const cols = 8, per = 11;
    this.chipMats.forEach((mats, ci) => {
      const slots = [...Array(cols).keys()].filter(i => i % this.chipMats.length === ci);
      const inst = new THREE.InstancedMesh(this.chipGeo, mats, slots.length * per);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      let k = 0;
      for (const col of slots) {
        const x = (col - (cols - 1) / 2) * (W / cols);
        for (let j = 0; j < per; j++) {
          m.compose(new THREE.Vector3(x, 0.105, Z - D / 2 + 0.02 + j * 0.0155), q, new THREE.Vector3(0.62, 0.7, 0.62));
          inst.setMatrixAt(k++, m);
        }
      }
      inst.castShadow = true;
      s.add(inst);
    });
  }

  // Barra al fondo: estantes con botellas retroiluminadas.
  buildBar() {
    const s = this.scene;
    const Z = -4.45;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.3, metalness: 0.6 });
    const glow = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    const prof = [[0, 0], [0.07, 0], [0.075, 0.02], [0.075, 0.2], [0.06, 0.25], [0.025, 0.3], [0.022, 0.4], [0.026, 0.41], [0, 0.41]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const bottleGeo = new THREE.LatheGeometry(prof, 14);
    const glass = [0x6b3a12, 0x1f5e2a, 0x9fb7c8, 0x5a1020, 0x8a6a14].map(c => new THREE.MeshStandardMaterial({
      color: c, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85, emissive: c, emissiveIntensity: 0.25,
    }));
    for (const y of [0.55, 1.25]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.35), shelfMat);
      shelf.position.set(0, y, Z);
      s.add(shelf);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.012, 0.012), glow);
      strip.position.set(0, y - 0.03, Z + 0.17);
      s.add(strip);
      for (let x = -1.45; x <= 1.45; x += 0.2 + Math.random() * 0.08) {
        const b = new THREE.Mesh(bottleGeo, glass[Math.floor(Math.random() * glass.length)]);
        const k = 0.8 + Math.random() * 0.45;
        b.scale.set(k, k * (0.85 + Math.random() * 0.3), k);
        b.position.set(x, y + 0.02, Z + (Math.random() - 0.5) * 0.1);
        s.add(b);
      }
    }
    const amber = new THREE.PointLight(0xffb060, 3, 3.5, 2);
    amber.position.set(0, 1.0, Z + 0.6);
    s.add(amber);
  }

  buildDealer() {
    const s = this.scene;
    const std = o => new THREE.MeshStandardMaterial(o);
    const suit = std({ color: 0x1e1f29, roughness: 0.85, envMapIntensity: 0.2 });
    // Contraluz para recortar la silueta del crupier contra el fondo.
    const backLight = new THREE.SpotLight(0xb0a0ff, 25, 6, 0.6, 0.6, 2);
    backLight.position.set(0, 3.2, -3.6);
    backLight.target.position.set(0, 1.0, DEALER_Z);
    s.add(backLight, backLight.target);
    const frontLight = new THREE.SpotLight(0xfff0d8, 8, 4, 0.5, 0.7, 2);
    frontLight.position.set(0, 0.4, -0.6);
    frontLight.target.position.set(0, 1.3, DEALER_Z);
    s.add(frontLight, frontLight.target);
    const shirt = std({ color: 0x0e0f13, roughness: 0.55 });
    const glove = std({ color: 0x141418, roughness: 0.35, metalness: 0.15 });
    this.accentMat = new THREE.MeshBasicMaterial({ color: AI_COLOR });
    const d = this.dealer = new THREE.Group();
    d.position.set(0, 0, DEALER_Z);
    s.add(d);

    // Torso torneado: cintura, pecho y hombros redondeados (achatado de delante a atrás).
    const prof = [[0, -0.6], [0.42, -0.6], [0.4, -0.05], [0.47, 0.45], [0.56, 0.76], [0.54, 0.9], [0.4, 0.99], [0.16, 1.04], [0, 1.05]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), suit);
    torso.scale.set(1.28, 1, 0.72);
    // Pechera: camisa en V con pajarita y botones de neón.
    const v = new THREE.Shape();
    v.moveTo(-0.15, 0.3); v.lineTo(0.15, 0.3); v.lineTo(0, -0.28); v.closePath();
    const front = new THREE.Mesh(new THREE.ShapeGeometry(v), shirt);
    front.position.set(0, 0.7, 0.4);
    front.rotation.x = -0.32;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 16), shirt);
    neck.position.y = 1.15;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.012, 8, 24), this.accentMat);
    collar.rotation.x = Math.PI / 2 + 0.15;
    collar.position.y = 1.06;
    const bow = new THREE.Group();
    for (const sx of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.07, 4), this.accentMat);
      wing.rotation.z = sx * Math.PI / 2;
      wing.position.x = -sx * 0.035;
      bow.add(wing);
    }
    bow.position.set(0, 0.97, 0.36);
    bow.rotation.x = -0.35;
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), this.accentMat);
      btn.position.set(0, 0.86 - i * 0.12, 0.395 - i * 0.025);
      d.add(btn);
    }
    // Solapas con filo de neón.
    for (const sx of [-1, 1]) {
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.56, 0.012), this.accentMat);
      lapel.position.set(sx * 0.1, 0.72, 0.415);
      lapel.rotation.set(-0.32, 0, sx * 0.26);
      d.add(lapel);
    }
    for (const m of [torso, front, neck]) { m.castShadow = true; d.add(m); }
    d.add(collar, bow);

    // Cabeza: casco lacado con visera luminosa tras un cristal.
    const head = this.head = new THREE.Group();
    head.position.y = 1.52;
    d.add(head);
    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x1c1d24, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), shell);
    helmet.scale.set(0.3, 0.38, 0.31);
    helmet.castShadow = true;
    head.add(helmet);
    // Cresta central y mentón.
    const crest = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 40, Math.PI), shell);
    crest.rotation.y = Math.PI / 2;
    crest.scale.set(1, 1.12, 0.92);
    crest.position.y = 0.01;
    head.add(crest);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12), shell);
    chin.scale.set(1.3, 0.6, 1);
    chin.position.set(0, -0.27, 0.12);
    head.add(chin);

    this.visorTex = T.visor();
    this.visorMat = new THREE.MeshBasicMaterial({ map: this.visorTex, color: AI_COLOR });
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true, -1.15, 2.3), this.visorMat);
    visor.scale.set(0.305, 0.075, 0.315);
    visor.position.y = 0.03;
    head.add(visor);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true, -1.25, 2.5), new THREE.MeshPhysicalMaterial({
      color: 0x000000, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false,
    }));
    glass.scale.set(0.318, 0.12, 0.328);
    glass.position.y = 0.03;
    head.add(glass);
    this.visorLight = new THREE.PointLight(AI_COLOR, 1.2, 1.5, 2);
    this.visorLight.position.set(0, 0.03, 0.5);
    head.add(this.visorLight);
    // "Auriculares" laterales con antena.
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.07, 24), shell);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(sx * 0.29, 0.02, 0);
      head.add(ear);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 24), this.accentMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * 0.33, 0.02, 0);
      head.add(ring);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6), glove);
    antenna.position.set(0.31, 0.16, -0.02);
    antenna.rotation.z = -0.15;
    head.add(antenna);
    this.tipMat = new THREE.MeshBasicMaterial({ color: 0xff2030 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.tipMat);
    tip.position.set(0.326, 0.27, -0.02);
    head.add(tip);

    // Manos enguantadas, con brazos de dos tramos que siguen a la mano (IK simple).
    const limb = (r0, r1) => {
      const g = new THREE.CylinderGeometry(r0, r1, 1, 14);
      g.translate(0, 0.5, 0);
      const m = new THREE.Mesh(g, suit);
      m.castShadow = true;
      s.add(m);
      return m;
    };
    this.hands = [-1, 1].map(side => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 0.17), glove);
      palm.scale.set(1, 1, 1);
      g.add(palm);
      const knuckles = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 10), glove);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, 0, 0.08);
      g.add(knuckles);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.1, 3, 8), glove);
        f.rotation.x = Math.PI / 2 + 0.12;
        f.position.set(-0.055 + i * 0.037, -0.012, 0.15 - Math.abs(i - 1.5) * 0.015);
        g.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 3, 8), glove);
      thumb.rotation.set(Math.PI / 2, 0, side * 0.9);
      thumb.position.set(-side * 0.09, 0, 0.04);
      g.add(thumb);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.009, 6, 20), this.accentMat);
      cuff.position.set(0, 0.02, -0.11);
      cuff.rotation.x = -0.25;
      g.add(cuff);
      g.traverse(o => { o.castShadow = true; });
      const base = new THREE.Vector3(side * 0.62, 0.045, -1.18);
      g.position.copy(base);
      g.rotation.y = -side * 0.25;
      g.userData.base = base;
      g.userData.arm = {
        side,
        upper: limb(0.075, 0.1),
        fore: limb(0.06, 0.08),
        elbow: (() => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), suit); s.add(e); return e; })(),
      };
      s.add(g);
      return g;
    });
  }

  // Brazo de dos tramos: hombro -> codo -> muñeca, con el codo hacia fuera y abajo.
  solveArm(hand) {
    const a = hand.userData.arm;
    const S = this.dealer.localToWorld(_v1.set(a.side * 0.6, 0.86, 0.02));
    const W = hand.localToWorld(_v2.set(0, 0.02, -0.12));
    const L1 = 0.62, L2 = 0.74;
    const d = _v3.subVectors(W, S);
    const dist = THREE.MathUtils.clamp(d.length(), 0.1, L1 + L2 - 0.01);
    d.normalize();
    const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
    const pole = _v4.set(a.side * 0.35, -1, 0.1);
    pole.addScaledVector(d, -pole.dot(d)).normalize();
    const E = _v5.copy(S).addScaledVector(d, L1 * cosA).addScaledVector(pole, L1 * Math.sqrt(1 - cosA * cosA));
    const place = (m, A, B) => {
      const dir = _v6.subVectors(B, A);
      m.position.copy(A);
      m.scale.set(1, dir.length(), 1);
      m.quaternion.setFromUnitVectors(_up, dir.normalize());
    };
    place(a.upper, S, E);
    place(a.fore, E, W);
    a.elbow.position.copy(E);
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
      color: 0xdde4ff, size: 0.011, transparent: true, opacity: 0.3, depthWrite: false,
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
        m.rotation.set(0, SHOE_YAW, Math.PI);
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
      const amount = show ? total : 0;
      const st = this.chipStacks[i];
      const key = String(amount);
      if (st.key === key) return;
      st.key = key;
      if (st.group) this.scene.remove(st.group);
      st.group = null;
      if (!amount) return;
      const g = new THREE.Group();
      this.chipStacksFor(amount).forEach((stack, si) => {
        const [sx, sz] = STACK_SLOTS[si];
        const twist = Math.random() * Math.PI;
        stack.forEach((d, k) => {
          const chip = new THREE.Mesh(this.chipGeo, d.mats);
          // Pilas algo desordenadas: cada ficha un poco desplazada y girada.
          chip.position.set(sx + (Math.random() - 0.5) * 0.008, 0.012 + k * 0.0225, sz + (Math.random() - 0.5) * 0.008);
          chip.rotation.y = twist + Math.random() * 0.6;
          chip.castShadow = true;
          g.add(chip);
        });
      });
      g.position.set(seat.chip.x, 0, seat.chip.z);
      g.rotation.y = seat.rot;
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

  // Descompone la apuesta en fichas reales y las reparte en pilas de una sola
  // denominación (máx. STACK_MAX fichas), de mayor a menor valor. Las moradas
  // (500) solo salen en apuestas grandes, para que 1000 se vea más que 500.
  chipStacksFor(amount) {
    let rest = Math.max(0, Math.floor(amount));
    const stacks = [];
    for (const d of this.denoms) {
      let n = d.v === 500 ? (rest >= 1500 ? Math.floor((rest - 500) / 500) : 0) : Math.floor(rest / d.v);
      rest -= n * d.v;
      while (n > 0) {
        const k = Math.min(STACK_MAX, n);
        stacks.push(Array(k).fill(d));
        n -= k;
      }
    }
    // Si no caben todas las pilas, las más pequeñas se apilan encima de las primeras.
    while (stacks.length > STACK_SLOTS.length) {
      const extra = stacks.pop();
      stacks[stacks.length % STACK_SLOTS.length].push(...extra);
    }
    return stacks;
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

  // Pasada de bloom: lo que no es MeshBasicMaterial se pinta en negro (para que
  // tape lo que haya detrás) y lo transparente que no brilla se oculta.
  renderBloom(dt) {
    const swapped = [], hidden = [];
    this.scene.traverse(o => {
      if (!o.visible || !(o.isMesh || o.isPoints)) return;
      const m = o.material;
      if (m.isMeshBasicMaterial) return;
      if (o.isPoints || (!Array.isArray(m) && m.transparent)) { o.visible = false; hidden.push(o); }
      else { swapped.push(o, m); o.material = DARK; }
    });
    const bg = this.scene.background;
    this.scene.background = null;
    this.bloomComposer.render(dt);
    this.scene.background = bg;
    for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
    for (const o of hidden) o.visible = true;
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
    this.dealer.updateMatrixWorld();
    for (const hand of this.hands) { hand.updateMatrixWorld(); this.solveArm(hand); }
    this.tipMat.color.setScalar(Math.sin(t * 3) > 0.6 ? 1 : 0.15).multiply(_red);

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

    this.renderBloom(dt);
    this.composer.render(dt);
    if (this.onFrame) this.onFrame();
  }
}
