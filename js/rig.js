// Utilidades de "esqueleto" compartidas por el crupier y los jugadores:
// extremidades de dos tramos (brazo/pierna) resueltas con IK analítica.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _dir = new THREE.Vector3();

// Cilindro de altura 1 con la base en el origen: se coloca entre dos puntos con placeLimb.
// r0 = radio del extremo final (codo/muñeca), r1 = radio del arranque (hombro/codo).
export function limbMesh(mat, r0, r1, seg = 14) {
  const g = new THREE.CylinderGeometry(r0, r1, 1, seg);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

export function placeLimb(m, A, B) {
  _dir.subVectors(B, A);
  m.position.copy(A);
  m.scale.set(1, Math.max(1e-4, _dir.length()), 1);
  m.quaternion.setFromUnitVectors(UP, _dir.normalize());
}

// IK de dos huesos: dado el arranque S y el extremo W, escribe en `out` la
// articulación intermedia, doblada hacia el vector `pole`.
export function solveTwoBone(S, W, L1, L2, pole, out) {
  _d.subVectors(W, S);
  const dist = THREE.MathUtils.clamp(_d.length(), 0.02, L1 + L2 - 0.005);
  _d.normalize();
  const cosA = THREE.MathUtils.clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1);
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_p.lengthSq() < 1e-8) _p.set(0, -1, 0);
  _p.normalize();
  return out.copy(S).addScaledVector(_d, L1 * cosA).addScaledVector(_p, L1 * Math.sqrt(1 - cosA * cosA));
}

// Coloca un brazo/pierna completo (dos mallas y la esfera de la articulación).
const _e = new THREE.Vector3();
export function poseLimb(limb, S, W, L1, L2, pole) {
  solveTwoBone(S, W, L1, L2, pole, _e);
  placeLimb(limb.a, S, _e);
  placeLimb(limb.b, _e, W);
  if (limb.joint) limb.joint.position.copy(_e);
  return _e;
}

// Generador pseudoaleatorio con semilla (para que cada jugador tenga siempre el mismo aspecto).
export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

export const ease = t => 1 - Math.pow(1 - t, 3);
export const smooth = t => t * t * (3 - 2 * t);

// Cuerpo "loft": secciones superelípticas apiladas de abajo arriba.
// rings: [{ y, w, d, z = 0, p = 2 }] — w/d semiancho y semifondo, z desplaza la
// sección hacia delante (pecho) y p > 2 la vuelve más cuadrada (hombros).
// La costura queda en la espalda.
export function loftGeometry(rings, seg = 40) {
  const pos = [], uv = [], idx = [];
  const n = rings.length;
  rings.forEach((r, i) => {
    const e = 2 / (r.p || 2);
    for (let j = 0; j <= seg; j++) {
      const a = Math.PI + j / seg * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      pos.push(r.w * Math.sign(s) * Math.pow(Math.abs(s), e), r.y, (r.z || 0) + r.d * Math.sign(c) * Math.pow(Math.abs(c), e));
      uv.push(j / seg, i / (n - 1));
    }
  });
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // Tapas.
  const capV = (r, up) => {
    const ci = pos.length / 3;
    pos.push(0, r.y, r.z || 0);
    uv.push(0.5, up ? 1 : 0);
    const base = up ? (n - 1) * (seg + 1) : 0;
    for (let j = 0; j < seg; j++) {
      if (up) idx.push(base + j, base + j + 1, ci);
      else idx.push(base + j + 1, base + j, ci);
    }
  };
  capV(rings[0], false);
  capV(rings[n - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Cabeza esculpida a partir de una esfera: mandíbula más estrecha, mentón,
// nuca, frente y laterales algo planos. Radio ~1 (se escala después).
export function headGeometry(jaw = 1) {
  const g = new THREE.SphereGeometry(1, 48, 36);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y < 0) {
      const k = Math.pow(-y, 1.4);
      x *= 1 - 0.3 * k * jaw;
      z *= z > 0 ? 1 - 0.08 * k : 1 - 0.45 * k;
      if (z > 0) z += 0.12 * k * Math.max(0, z);          // mentón hacia delante
    } else if (z < 0) {
      z *= 1.06;                                           // nuca
    }
    // Cuencas de los ojos y arco de las cejas.
    const ex = Math.abs(x) - 0.36, ey = y - 0.1, dd = Math.hypot(ex, ey);
    if (z > 0.5 && dd < 0.24) z -= 0.07 * (1 - dd / 0.24);
    if (z > 0.5 && Math.abs(y - 0.3) < 0.08 && Math.abs(x) < 0.6) z += 0.025 * (1 - Math.abs(y - 0.3) / 0.08);
    x *= 0.9;                                              // laterales más planos
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// Mano con palma, cuatro dedos de dos falanges y pulgar. size escala todo.
// Devuelve el grupo con userData.fingers / userData.thumb para curvarlos.
export function buildHand(mat, side, size = 1) {
  const h = new THREE.Group();
  const s = size;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.066 * s, 0.024 * s, 0.068 * s), mat);
  palm.position.z = 0.03 * s;
  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.03 * s, 12, 8), mat);
  heel.scale.set(1.15, 0.45, 0.9);
  heel.position.z = 0.008 * s;
  h.add(palm, heel);
  const fingers = [];
  const lens = [0.85, 1, 0.95, 0.75];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Group();
    f.position.set((-0.024 + i * 0.016) * s * -side, 0, 0.064 * s);
    const L = lens[i] * s;
    const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085 * s, 0.022 * L, 3, 8), mat);
    p1.rotation.x = Math.PI / 2;
    p1.position.z = 0.016 * L;
    const tip = new THREE.Group();
    tip.position.z = 0.033 * L;
    const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0078 * s, 0.018 * L, 3, 8), mat);
    p2.rotation.x = Math.PI / 2;
    p2.position.z = 0.013 * L;
    tip.add(p2);
    f.add(p1, tip);
    f.userData.tip = tip;
    h.add(f);
    fingers.push(f);
  }
  const thumb = new THREE.Group();
  thumb.position.set(0.034 * s * -side, -0.004 * s, 0.018 * s);
  thumb.rotation.set(0.2, -side * 0.75, 0);
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0095 * s, 0.024 * s, 3, 8), mat);
  t1.rotation.x = Math.PI / 2;
  t1.position.z = 0.016 * s;
  const tTip = new THREE.Group();
  tTip.position.z = 0.034 * s;
  const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085 * s, 0.016 * s, 3, 8), mat);
  t2.rotation.x = Math.PI / 2;
  t2.position.z = 0.011 * s;
  tTip.add(t2);
  thumb.add(t1, tTip);
  thumb.userData.tip = tTip;
  h.add(thumb);
  h.userData.fingers = fingers;
  h.userData.thumb = thumb;
  h.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return h;
}

// Curva los dedos: 0 mano abierta, 1 puño. point = índice estirado (señalar/tocar).
export function curlHand(h, k, point = 0) {
  h.userData.fingers.forEach((f, i) => {
    const kk = i === 1 ? k * (1 - point) : k;
    f.rotation.x = 0.1 + kk * 1.2;
    f.userData.tip.rotation.x = 0.15 + kk * 1.3;
  });
  const th = h.userData.thumb;
  th.userData.tip.rotation.x = 0.1 + k * 0.6;
}
