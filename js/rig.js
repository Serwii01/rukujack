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
