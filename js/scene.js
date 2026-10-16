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
import { limbMesh, poseLimb, ease as easeOut, smooth, loftGeometry } from './rig.js';
import { PlayerAvatar } from './characters.js';
import { buildShotgun, Smoke, Shells } from './shotgun.js';

const RETRO_HEIGHT = 420;
const CARD_W = 0.36, CARD_H = 0.5;
const HAND_GAP = 0.4;
// Escopeta: guardada bajo la mesa, preparada frente al pecho y encarada al hombro.
const GUN_REST = new THREE.Vector3(0.3, -0.3, -1.62);
const GUN_READY = new THREE.Vector3(0.12, 0.5, -1.4);
const GUN_AIM = new THREE.Vector3(0.36, 0.74, -1.52);
const ARM_UP = 0.7, ARM_FORE = 0.8;
// Cámara del crupier (cuando juegas de banca): a la altura de su visera.
const DEALER_CAM = new THREE.Vector3(0, 1.95, -1.8);
const DEALER_LOOK = new THREE.Vector3(0, -0.15, 0.55);
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
const SHOE_POS = new THREE.Vector3(1.5, 0, -0.98);
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
    this.sweep = null;
    this.dealerActive = false;
    this.visorColor = new THREE.Color(AI_COLOR);
    this.avatars = SEATS.map(() => null);
    this.prevState = null;
    // Cámara: ángulo del asiento propio y mezcla con la vista del crupier (0..1).
    this.view = { angle: 0, angleTarget: 0, mix: 0, mixTarget: 0 };
    this.dealerPOV = false;
    this.nextBlink = 3;

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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), std({ map: T.floor(), roughness: 0.55, metalness: 0.1, bumpMap: T.leatherBump(20), bumpScale: 0.6, envMapIntensity: 0.5 }));
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
    const woodMat = new THREE.MeshPhysicalMaterial({ map: T.wood(), roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.15, envMapIntensity: 0.6 });
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
    const felt = new THREE.Mesh(feltGeo, new THREE.MeshPhysicalMaterial({
      map: T.felt(), roughness: 0.95, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x1f5a44), bumpMap: T.feltBump(14), bumpScale: 0.6,
    }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.002;
    felt.receiveShadow = true;
    s.add(felt);

    const railShape = dShape(TABLE_R + 0.18, BACK_Z - 0.16);
    railShape.holes.push(dShape(TABLE_R, BACK_Z));
    const rail = new THREE.Mesh(
      new THREE.ExtrudeGeometry(railShape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2, curveSegments: 48 }),
      new THREE.MeshPhysicalMaterial({ map: T.leather(), roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.4, bumpMap: T.leatherBump(12), bumpScale: 1.2, envMapIntensity: 0.5 }),
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
    const suit = new THREE.MeshPhysicalMaterial({
      map: T.suit(), roughness: 0.8, sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x3a3e58),
      bumpMap: T.fabricBump(14), bumpScale: 0.8, envMapIntensity: 0.25,
    });
    const satin = new THREE.MeshPhysicalMaterial({ color: 0x111218, roughness: 0.28, sheen: 1, sheenRoughness: 0.3, sheenColor: new THREE.Color(0x8890b0), envMapIntensity: 0.6 });
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
    const cuffMat = std({ color: 0xcfd2da, roughness: 0.5 });
    this.accentMat = new THREE.MeshBasicMaterial({ color: AI_COLOR });
    const d = this.dealer = new THREE.Group();
    d.position.set(0, 0, DEALER_Z);
    s.add(d);
    // El cuerpo (torso y cabeza) va aparte para poder ocultarlo en la vista del crupier.
    const upper = this.dealerBody = new THREE.Group();
    d.add(upper);

    // Torso torneado: cintura, pecho y hombros redondeados (achatado de delante a atrás).
    // Torso por secciones: cintura entallada, pecho adelantado, espalda plana y hombros cuadrados.
    const torso = this.torso = new THREE.Mesh(loftGeometry([
      { y: -0.6, w: 0.5, d: 0.31, p: 2.2 },
      { y: -0.1, w: 0.47, d: 0.29, p: 2.2 },
      { y: 0.25, w: 0.52, d: 0.32, z: 0.02, p: 2.3 },
      { y: 0.55, w: 0.62, d: 0.36, z: 0.035, p: 2.5 },
      { y: 0.76, w: 0.69, d: 0.36, z: 0.03, p: 2.9 },
      { y: 0.87, w: 0.71, d: 0.31, z: 0.01, p: 3.6 },
      { y: 0.95, w: 0.6, d: 0.26, p: 3.2 },
      { y: 1.01, w: 0.34, d: 0.2, p: 2.4 },
      { y: 1.05, w: 0.14, d: 0.13 },
    ], 48), suit);
    // Hombreras: dan forma de chaqueta y tapan la unión con los brazos.
    for (const sx of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), suit);
      pad.scale.set(0.19, 0.13, 0.2);
      pad.position.set(sx * 0.55, 0.86, 0.0);
      pad.castShadow = true;
      upper.add(pad);
    }
    // Pechera: camisa en V, chaleco, pajarita y botones de neón.
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
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), this.accentMat);
    bow.add(knot);
    bow.position.set(0, 0.97, 0.36);
    bow.rotation.x = -0.35;
    for (let i = 0; i < 3; i++) {
      const btn = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), this.accentMat);
      btn.position.set(0, 0.86 - i * 0.12, 0.395 - i * 0.025);
      upper.add(btn);
    }
    // Solapas de raso con filo de neón.
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape();
      sh.moveTo(sx * 0.015, -0.27);
      sh.lineTo(sx * 0.135, 0.29);
      sh.lineTo(sx * 0.2, 0.25);
      sh.lineTo(sx * 0.045, -0.24);
      sh.closePath();
      const lapel = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: false }), satin);
      lapel.position.set(0, 0.7, 0.405);
      lapel.rotation.x = -0.32;
      upper.add(lapel);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.56, 0.01), this.accentMat);
      edge.position.set(sx * 0.1, 0.72, 0.425);
      edge.rotation.set(-0.32, 0, sx * 0.26);
      upper.add(edge);
    }
    // Pañuelo de bolsillo.
    const pocket = new THREE.Shape();
    pocket.moveTo(-0.04, 0); pocket.lineTo(0.04, 0); pocket.lineTo(0.015, 0.05); pocket.lineTo(-0.005, 0.035); pocket.lineTo(-0.025, 0.055); pocket.closePath();
    const square = new THREE.Mesh(new THREE.ShapeGeometry(pocket), this.accentMat);
    square.position.set(0.33, 0.66, 0.33);
    square.rotation.set(-0.3, 0.45, 0);
    upper.add(square);
    for (const m of [torso, front, neck]) { m.castShadow = true; upper.add(m); }
    upper.add(collar, bow);

    // Cabeza: casco lacado con visera luminosa tras un cristal.
    const head = this.head = new THREE.Group();
    head.position.y = 1.52;
    upper.add(head);
    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x1c1d24, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08,
    });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), shell);
    helmet.scale.set(0.3, 0.38, 0.31);
    helmet.castShadow = true;
    head.add(helmet);
    // Cresta central, mentón, marco de la visera y rejillas en las mejillas.
    const crest = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 40, Math.PI), shell);
    crest.rotation.y = Math.PI / 2;
    crest.scale.set(1, 1.12, 0.92);
    crest.position.y = 0.01;
    head.add(crest);
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12), shell);
    chin.scale.set(1.3, 0.6, 1);
    chin.position.set(0, -0.27, 0.12);
    head.add(chin);
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true, -1.3, 2.6), new THREE.MeshStandardMaterial({
      color: 0x08080a, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide,
    }));
    frame.scale.set(0.312, 0.15, 0.322);
    frame.position.y = 0.03;
    head.add(frame);
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const vent = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.07), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 }));
        vent.position.set(sx * 0.25, -0.13 - i * 0.03, 0.15);
        vent.rotation.y = sx * 0.6;
        head.add(vent);
      }
    }

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
    // "Auriculares" laterales con antena y pilotos.
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.07, 24), shell);
      ear.rotation.z = Math.PI / 2;
      ear.position.set(sx * 0.29, 0.02, 0);
      head.add(ear);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 24), this.accentMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(sx * 0.33, 0.02, 0);
      head.add(ring);
      for (let i = 0; i < 3; i++) {
        const led = new THREE.Mesh(new THREE.SphereGeometry(0.007, 6, 4), this.accentMat);
        led.position.set(sx * 0.325, -0.06, -0.03 + i * 0.03);
        head.add(led);
      }
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 6), glove);
    antenna.position.set(0.31, 0.16, -0.02);
    antenna.rotation.z = -0.15;
    head.add(antenna);
    this.tipMat = new THREE.MeshBasicMaterial({ color: 0xff2030 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.tipMat);
    tip.position.set(0.326, 0.27, -0.02);
    head.add(tip);

    // Manos enguantadas con dedos de dos falanges, puño de camisa y gemelo de neón;
    // brazos de dos tramos que siguen a la mano (IK).
    this.hands = [-1, 1].map(side => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.055, 0.17), glove);
      g.add(palm);
      const knuckles = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 10), glove);
      knuckles.rotation.z = Math.PI / 2;
      knuckles.position.set(0, 0, 0.08);
      g.add(knuckles);
      const fingers = [];
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Group();
        f.position.set(-0.055 + i * 0.037, -0.005, 0.09);
        const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.05, 3, 8), glove);
        p1.rotation.x = Math.PI / 2;
        p1.position.z = 0.035;
        const tipG = new THREE.Group();
        tipG.position.z = 0.075 - Math.abs(i - 1.5) * 0.008;
        const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.035, 3, 8), glove);
        p2.rotation.x = Math.PI / 2;
        p2.position.z = 0.025;
        tipG.add(p2);
        f.add(p1, tipG);
        f.userData.tip = tipG;
        g.add(f);
        fingers.push(f);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.07, 3, 8), glove);
      thumb.rotation.set(Math.PI / 2, 0, side * 0.9);
      thumb.position.set(-side * 0.09, 0, 0.04);
      g.add(thumb);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.06, 16), cuffMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, 0.015, -0.13);
      g.add(cuff);
      const link = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), this.accentMat);
      link.position.set(side * 0.066, 0.015, -0.13);
      g.add(link);
      g.traverse(o => { o.castShadow = true; });
      const base = new THREE.Vector3(side * 0.62, 0.045, -1.18);
      g.position.copy(base);
      g.rotation.y = -side * 0.25;
      g.userData.base = base;
      g.userData.baseQ = g.quaternion.clone();
      g.userData.fingers = fingers;
      const arm = g.userData.arm = { side, a: limbMesh(suit, 0.075, 0.1), b: limbMesh(suit, 0.062, 0.08) };
      arm.joint = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 10), suit);
      s.add(arm.a, arm.b, arm.joint, g);
      return g;
    });
  }

  // Curva de los dedos: 0 mano plana, 1 puño (para empuñar la escopeta).
  curlFingers(hand, k) {
    for (const f of hand.userData.fingers) {
      f.rotation.x = 0.15 + k * 1.1;
      f.userData.tip.rotation.x = 0.25 + k * 1.3;
    }
  }

  // Brazo de dos tramos: hombro -> codo -> muñeca, con el codo hacia fuera y abajo.
  solveArm(hand) {
    const a = hand.userData.arm;
    const S = this.dealer.localToWorld(_v1.set(a.side * 0.6, 0.86, 0.02));
    const W = hand.localToWorld(_v2.set(0, 0.02, -0.15));
    poseLimb(a, S, W, ARM_UP, ARM_FORE, _v4.set(a.side * 0.35, -1, -0.1));
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
    // Si repartes tú, la cámara pasa a la visera del crupier y sus cartas se giran hacia ti.
    const meP = state.players.find(p => p.id === myId);
    this.dealerPOV = !!state.dealer.id && state.dealer.id === myId;
    this.view.mixTarget = this.dealerPOV ? 1 : 0;
    this.view.angleTarget = meP ? SEATS[meP.seat].rot : 0;

    const wanted = new Map();
    const dn = state.dealer.hand.length;
    const dStep = dn > 5 ? 0.3 : 0.4;
    state.dealer.hand.forEach((c, i) => {
      wanted.set(c.id, {
        c, pos: new THREE.Vector3((i - (dn - 1) / 2) * dStep, 0.004 + i * 0.002, DEALER_CARDS_Z), rotY: this.dealerPOV ? Math.PI : 0,
      });
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
        this.reach = { to: w.pos.clone(), t0: this.clock.elapsedTime, from: this.hands[1].position.clone() };
        m.userData.fresh = true;
      }
      const faceUp = !w.c.hidden;
      if (faceUp && !m.userData.faceSet) {
        // Destapar una carta que ya estaba en la mesa: el crupier la voltea con la mano.
        if (!m.userData.fresh) this.reach = { to: w.pos.clone(), t0: this.clock.elapsedTime, flip: true };
        m.userData.front.material.map = T.cardFace(w.c.r, w.c.s);
        m.userData.front.material.needsUpdate = true;
        m.userData.faceSet = true;
      }
      const flip = faceUp ? 0 : Math.PI;
      const u = m.userData;
      if (!u.to || !u.to.equals(w.pos) || u.toFlip !== flip) this.animate(m, w.pos, w.rotY, flip);
    }

    for (const [id, m] of this.cards) {
      m.userData.fresh = false;
      if (wanted.has(id) || m.userData.leaving) continue;
      if (!this.sweep) this.sweep = { t0: this.clock.elapsedTime };
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

    this.updateAvatars(state, myId);
  }

  // Un personaje por jugador sentado (menos el tuyo, que es la cámara, y el de
  // quien hace de crupier, que está detrás de la mesa). Los gestos salen de
  // comparar el estado nuevo con el anterior.
  updateAvatars(state, myId) {
    const prev = this.prevState;
    this.prevState = state;
    const t = this.clock.elapsedTime;
    const nCards = q => q.hands.reduce((a, h) => a + h.cards.length, 0);
    const turnP = state.players.find(p => p.id === state.turn);
    SEATS.forEach((seat, i) => {
      const p = state.players.find(x => x.seat === i);
      let av = this.avatars[i];
      if (av && (!p || av.id !== p.id)) { av.dispose(); av = this.avatars[i] = null; }
      if (!p) return;
      if (!av) av = this.avatars[i] = new PlayerAvatar(this.scene, i, p.id);
      av.root.visible = p.id !== myId && p.id !== state.dealer.id;
      av.spectator = p.role === 'spectator' && !p.eliminated;
      av.turn = state.turn === p.id;
      av.mood = state.phase === 'result' && p.result && p.delta < 0 ? 'lose' : null;
      // Mira sus cartas en su turno; si no, las de quien juega, o al crupier.
      const lookSeat = av.turn ? seat : turnP ? SEATS[turnP.seat] : null;
      if (lookSeat) av.look.set(lookSeat.x, 0, lookSeat.z);
      else av.look.set(0, 1.55, DEALER_Z);
      // Eliminado: en el suelo (salvo si el disparo aún está por llegar).
      if (p.eliminated && !(state.phase === 'result' && state.shots.includes(p.id))) av.fallen();

      const pp = prev && prev.players.find(x => x.id === p.id);
      if (!pp) return;
      const wasTurn = prev.turn === p.id;
      if (!pp.ready && p.ready) av.gesture('push', t);
      if (wasTurn && p.hands.length > pp.hands.length) av.gesture('wave', t);
      else if (wasTurn && nCards(p) > nCards(pp)) av.gesture('tap', t);
      else if (wasTurn && p.hands.some((h, hi) => h.status === 'stand' && pp.hands[hi] && pp.hands[hi].status === 'playing')) av.gesture('wave', t);
      if (p.hands.some((h, hi) => h.status === 'bust' && pp.hands[hi] && pp.hands[hi].status !== 'bust')) av.gesture('facepalm', t, 0.5);
      if (state.phase === 'result' && prev.phase !== 'result' && p.result && p.delta > 0) av.gesture('cheer', t, 0.2);
    });
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

  // Escopeta de corredera que el crupier guarda bajo la mesa.
  buildGun() {
    const G = this.gunParts = buildShotgun();
    this.gun = G.group;
    const aim = (pos, dir) => {
      const o = new THREE.Object3D();
      o.position.copy(pos);
      o.lookAt(pos.clone().add(dir));
      return o.quaternion.clone();
    };
    // Tumbada bajo la mesa, y "en guardia" (cañón arriba, cruzada delante del pecho).
    this.gunRestQ = aim(GUN_REST, new THREE.Vector3(-1, 0, 0.15));
    this.gunReadyQ = aim(GUN_READY, new THREE.Vector3(-0.3, 0.9, 0.45));
    this.gun.position.copy(GUN_REST);
    this.gun.quaternion.copy(this.gunRestQ);
    this.scene.add(this.gun);
    // Orientación de cada mano respecto al arma: la derecha en la empuñadura
    // (dorso hacia fuera) y la izquierda bajo la corredera (palma arriba).
    const basis = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    this.gripQ = [
      basis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0)),
      basis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)),
    ];
    this.smoke = new Smoke(this.scene);
    this.shells = new Shells(this.scene, G.shell, (x, z) => this.surfaceAt(x, z));
    this.gunAnim = null;
    this.gunHold = 0;
    this.recoil = 0;
  }

  // Altura de lo que hay debajo de (x, z): el tapete o el suelo.
  surfaceAt(x, z) {
    const R = TABLE_R + 0.18;
    const inside = z >= BACK_Z - 0.16 && Math.abs(x) <= R && (z <= ARC_CZ || Math.hypot(x, z - ARC_CZ) <= R);
    return inside ? 0.004 : -1.3;
  }

  // target: punto al que apunta (null = sin escopeta). onFire se llama al disparar;
  // opts.onPump al accionar la corredera; opts.seat es el asiento de la víctima.
  shoot(target, onFire, opts = {}) {
    if (!target) { setTimeout(onFire, 600); return; }
    const o = new THREE.Object3D();
    o.position.copy(GUN_AIM);
    o.lookAt(target);
    this.gunAnim = {
      t0: this.clock.elapsedTime, aimQ: o.quaternion.clone(), target: target.clone(),
      onFire, onPump: opts.onPump, seat: opts.seat, fired: false, pumps: 0, ejected: false, puffAt: 0,
    };
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

  // Cabeza del personaje de ese asiento (a donde apunta la escopeta).
  seatTarget(seat) {
    const av = this.avatars[seat];
    if (av) return av.headWorld();
    const s = SEATS[seat];
    return new THREE.Vector3(s.x + s.out.x * 1.1, 0.55, s.z + s.out.z * 1.1);
  }

  cameraTarget() {
    return this.camera.position.clone();
  }

  // Alguien habla en el chat: su personaje mueve la cabeza (o el crupier, si es él).
  talk(seat, isDealer) {
    const t = this.clock.elapsedTime;
    if (isDealer) this.dealerTalkUntil = t + 1.6;
    else if (this.avatars[seat]) this.avatars[seat].gesture('talk', t);
  }

  // Secuencia (s): 0-0.45 coge el arma · 0.45-1.05 la sube · 1.05 corredera ·
  // 1.35-1.8 encara · 2.0 dispara · 2.35 corredera y cartucho fuera ·
  // 2.7-3.0 la baja · 3.0-3.2 suelta.
  updateGun(t, dt) {
    const a = this.gunAnim, G = this.gunParts, g = this.gun;
    const e = t - a.t0;
    const seg = (s, d) => smooth(THREE.MathUtils.clamp((e - s) / d, 0, 1));
    if (e < 0.45) {
      g.position.copy(GUN_REST);
      g.quaternion.copy(this.gunRestQ);
    } else if (e < 1.35) {
      const k = seg(0.45, 0.6);
      g.position.lerpVectors(GUN_REST, GUN_READY, k);
      g.quaternion.slerpQuaternions(this.gunRestQ, this.gunReadyQ, k);
    } else if (e < 2.7) {
      const k = seg(1.35, 0.45);
      g.position.lerpVectors(GUN_READY, GUN_AIM, k);
      g.quaternion.slerpQuaternions(this.gunReadyQ, a.aimQ, k);
      // Pulso del que apunta.
      g.position.y += Math.sin(t * 7.3) * 0.004 * k;
      g.position.x += Math.sin(t * 5.1) * 0.003 * k;
    } else {
      const k = seg(2.7, 0.3);
      g.position.lerpVectors(GUN_AIM, GUN_REST, k);
      g.quaternion.slerpQuaternions(a.aimQ, this.gunRestQ, k);
    }
    this.gunHold = e < 3.0 ? seg(0, 0.45) : 1 - seg(3.0, 0.2);

    // Corredera: atrás y adelante (dos veces: al preparar y tras el disparo).
    for (const [start, i] of [[1.05, 0], [2.35, 1]]) {
      if (e >= start && a.pumps === i) { a.pumps++; if (a.onPump) a.onPump(); }
    }
    const stroke = s => { const u = (e - s) / 0.3; return u <= 0 || u >= 1 ? 0 : u < 0.45 ? smooth(u / 0.45) : 1 - smooth((u - 0.45) / 0.55); };
    G.pump.position.z = 0.5 - 0.12 * Math.max(stroke(1.05), stroke(2.35));

    // Disparo.
    if (!a.fired && e >= 2.0) {
      a.fired = true;
      a.fireT = t;
      G.flash.rotation.z = Math.random() * Math.PI;
      G.flash.scale.setScalar(0.85 + Math.random() * 0.5);
      const m = G.muzzle.getWorldPosition(new THREE.Vector3());
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
      this.smoke.burst(m, dir, 18);
      const av = a.seat !== undefined && this.avatars[a.seat];
      if (av) av.hit(t);
      if (a.onFire) a.onFire();
    }
    const r = a.fired ? t - a.fireT : -1;
    const kick = r < 0 ? 0 : r < 0.04 ? r / 0.04 : Math.exp(-(r - 0.04) * 8);
    G.body.position.z = -0.15 * kick;
    G.body.rotation.x = -0.5 * kick;
    this.recoil = kick;
    const on = r >= 0 && r < 0.06;
    G.flashMat.opacity = on ? 1 : 0;
    G.coreMat.opacity = on ? 1 : 0;
    G.light.intensity = r >= 0 && r < 0.12 ? 140 * (1 - r / 0.12) : 0;
    // Hilo de humo saliendo del cañón un rato después.
    if (r > 0.1 && r < 1.4 && t > a.puffAt) {
      a.puffAt = t + 0.09;
      const m = G.muzzle.getWorldPosition(new THREE.Vector3());
      this.smoke.burst(m, new THREE.Vector3(0, 0.15, 0), 1);
    }
    // El cartucho vacío sale por la ventana al accionar la corredera.
    if (!a.ejected && e >= 2.47) {
      a.ejected = true;
      g.updateMatrixWorld(true);
      const p = g.localToWorld(G.port.clone());
      const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
      this.shells.eject(p, rightV.multiplyScalar(1.3).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.5, 0.3)));
    }

    if (e >= 3.2) {
      this.gunAnim = null;
      this.gunHold = 0;
      this.recoil = 0;
      G.flashMat.opacity = G.coreMat.opacity = 0;
      G.light.intensity = 0;
      G.body.position.z = 0;
      G.body.rotation.x = 0;
    }
  }

  // Lleva las manos del crupier a la empuñadura y a la corredera.
  holdGun() {
    const k = this.gunHold, G = this.gunParts, g = this.gun;
    g.updateMatrixWorld(true);
    const points = [G.pump.localToWorld(G.fore.clone()), G.body.localToWorld(G.grip.clone())];
    const gq = new THREE.Quaternion();
    G.body.getWorldQuaternion(gq);
    this.hands.forEach((h, i) => {
      h.position.lerp(points[i], k);
      h.quaternion.slerp(gq.clone().multiply(this.gripQ[i]), k);
      this.curlFingers(h, k);
    });
  }

  // Pasada de bloom: lo que no es MeshBasicMaterial se pinta en negro (para que
  // tape lo que haya detrás) y lo transparente que no brilla se oculta.
  renderBloom(dt) {
    const swapped = [], hidden = [];
    this.scene.traverse(o => {
      if (!o.visible || !(o.isMesh || o.isPoints || o.isSprite)) return;
      const m = o.material;
      if (m.isMeshBasicMaterial) return;
      if (o.isPoints || o.isSprite || (!Array.isArray(m) && m.transparent)) { o.visible = false; hidden.push(o); }
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

    // Cámara: detrás de tu asiento (girando alrededor de la mesa), o en la
    // visera del crupier cuando repartes tú.
    const v = this.view;
    const kv = 1 - Math.pow(0.04, dt);
    v.angle += (v.angleTarget - v.angle) * kv;
    v.mix += (v.mixTarget - v.mix) * kv;
    const mix = smooth(THREE.MathUtils.clamp(v.mix, 0, 1));
    const ca = Math.cos(v.angle), sa = Math.sin(v.angle);
    const around = (P, out) => {
      const rx = P.x, rz = P.z - ARC_CZ;
      return out.set(rx * ca + rz * sa, P.y, -rx * sa + rz * ca + ARC_CZ);
    };
    const camPos = around(CAM_POS, _v1).lerp(DEALER_CAM, mix);
    const camLook = around(CAM_LOOK, _v2).lerp(DEALER_LOOK, mix);
    camPos.y += Math.sin(t * 0.6) * 0.01;
    this.camera.position.copy(camPos);
    this.camera.lookAt(camLook);
    const right = _v3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const par = 1 - 0.6 * mix;
    camPos.addScaledVector(right, this.mouse.x * 0.18 * par);
    camPos.y -= this.mouse.y * 0.08 * par;
    camLook.addScaledVector(right, this.mouse.x * 0.1 * par);
    camLook.y -= this.mouse.y * 0.06 * par;
    this.camera.position.copy(camPos);
    this.camera.lookAt(camLook);
    if (this.shakeEnd && t < this.shakeEnd) {
      const k = (this.shakeEnd - t) / this.shakeDur * this.shakeAmp;
      this.camera.position.x += (Math.random() - 0.5) * k;
      this.camera.position.y += (Math.random() - 0.5) * k;
      this.camera.rotation.z += (Math.random() - 0.5) * k * 0.5;
    }
    // En la vista del crupier no se ve su propio cuerpo, solo los brazos.
    this.dealerBody.visible = mix < 0.5;
    if (this.gunAnim) this.updateGun(t, dt);
    this.smoke.update(dt);
    this.shells.update(dt);

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
    if (t > this.nextBlink) this.nextBlink = t + 2.5 + Math.random() * 4;
    const blink = this.nextBlink - t > 0.12 ? 1 : 0.15;   // la visera "parpadea"
    this.visorMat.color.copy(this.visorColor).multiplyScalar(pulse * blink);
    this.visorLight.color.copy(this.visorColor);
    this.accentMat.color.copy(this.visorColor);
    this.ledMat.color.copy(this.visorColor).multiplyScalar(0.8);

    // Crupier: respiración, mirada, retroceso del disparo y giro hacia la víctima.
    const breath = Math.sin(t * 1.1);
    this.dealer.position.y = breath * 0.01;
    this.torso.scale.x = 1 + breath * 0.008;
    this.torso.scale.z = 1 + breath * 0.012;
    this.gaze = lerp(this.gaze, this.gazeTarget, 1 - Math.pow(0.03, dt));
    this.dealer.rotation.y = this.gaze * 0.22 * this.gunHold;
    this.dealer.rotation.x = -0.07 * this.recoil;
    const h = this.head;
    const talking = this.dealerTalkUntil > t ? Math.sin(t * 14) * 0.04 : 0;
    h.rotation.y = this.gaze * (0.7 - 0.2 * this.gunHold) + Math.sin(t * 0.37) * 0.04;
    h.rotation.x = 0.1 + Math.sin(t * 0.5) * 0.02 + talking - 0.15 * this.recoil;
    h.rotation.z = Math.sin(t * 0.3) * 0.03 + 0.12 * this.gunHold;
    this.visorTex.offset.x = THREE.MathUtils.clamp(-this.gaze * 0.06, -0.12, 0.12);

    // Manos: la derecha saca cartas del zapato y las lanza; la izquierda recoge.
    const [lh, rh] = this.hands;
    lh.position.copy(lh.userData.base);
    lh.position.y += Math.sin(t * 1.3 + 1) * 0.006;
    rh.position.copy(rh.userData.base);
    lh.quaternion.copy(lh.userData.baseQ);
    rh.quaternion.copy(rh.userData.baseQ);
    if (this.reach) {
      const r = this.reach, rt = (t - r.t0) / 0.55;
      if (rt >= 1) this.reach = null;
      else if (r.flip) {
        rh.position.lerp(_v4.copy(r.to).setY(0.06), Math.sin(Math.PI * rt) * 0.8);
      } else {
        const shoe = _v4.copy(SHOE).setY(SHOE.y + 0.05);
        const mid = _v5.copy(SHOE).lerp(r.to, 0.42).setY(0.08);
        if (rt < 0.3) rh.position.lerpVectors(r.from, shoe, smooth(rt / 0.3));
        else if (rt < 0.65) rh.position.lerpVectors(shoe, mid, smooth((rt - 0.3) / 0.35));
        else rh.position.lerpVectors(mid, rh.userData.base, smooth((rt - 0.65) / 0.35));
      }
    } else rh.position.y += Math.sin(t * 1.2) * 0.006;
    if (this.sweep) {
      const st = (t - this.sweep.t0) / 0.8;
      if (st >= 1) this.sweep = null;
      else lh.position.lerp(_v4.set(-0.95, 0.05, -0.72), Math.sin(Math.PI * st));
    }
    for (const hand of this.hands) this.curlFingers(hand, 0.1);
    if (this.gunHold > 0) this.holdGun();
    this.dealer.updateMatrixWorld();
    for (const hand of this.hands) { hand.updateMatrixWorld(); this.solveArm(hand); }
    this.tipMat.color.setScalar(Math.sin(t * 3) > 0.6 ? 1 : 0.15).multiply(_red);

    for (const av of this.avatars) if (av) av.update(t, dt);

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
