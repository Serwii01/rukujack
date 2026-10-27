// Escopeta de corredera que el crupier saca de debajo de la mesa, con sus efectos:
// fogonazo, luz, humo y el cartucho que sale despedido al recargar.
// Ejes locales: +z = hacia la boca del cañón; el origen está en la empuñadura.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as T from './textures.js';

const GRAVITY = -5.5;

export function buildShotgun() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1b20, metalness: 0.85, roughness: 0.32 });
  const steelDark = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.7, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ map: T.wood(), color: 0xb07a4a, roughness: 0.48, metalness: 0.02 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.9 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28 });

  const g = new THREE.Group();
  const body = new THREE.Group();   // lo que retrocede con el disparo
  g.add(body);

  // Cajón de mecanismos con la ventana de expulsión.
  const recv = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.13, 0.36, 3, 0.018), steel);
  recv.position.set(0, 0.0, 0.05);
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.045, 0.11), steelDark);
  port.position.set(0.046, 0.02, 0.08);
  // Cañón, banda ventilada, punto de mira y depósito tubular.
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.031, 0.95, 24), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.035, 0.7);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.02, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  bore.position.set(0, 0.035, 1.176);
  const rib = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.92), steel);
  rib.position.set(0, 0.072, 0.69);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 8), brass);
  bead.position.set(0, 0.083, 1.15);
  const mag = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.74, 18), steel);
  mag.rotation.x = Math.PI / 2;
  mag.position.set(0, -0.032, 0.6);
  const clamp = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.11, 0.035, 2, 0.012), steelDark);
  clamp.position.set(0, 0.002, 0.95);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 16), steelDark);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(0, -0.032, 0.985);
  body.add(recv, port, barrel, bore, rib, bead, mag, clamp, cap);

  // Guardamonte y gatillo.
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.008, 8, 20, Math.PI), steelDark);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.065, -0.03);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.012), steelDark);
  trigger.position.set(0, -0.08, -0.025);
  trigger.rotation.x = 0.3;
  body.add(guard, trigger);

  // Culata con empuñadura de pistola (perfil extruido).
  const p = new THREE.Shape();
  p.moveTo(-0.12, 0.05);
  p.lineTo(-0.36, 0.03);
  p.quadraticCurveTo(-0.6, 0.02, -0.78, 0.035);
  p.lineTo(-0.8, -0.17);
  p.quadraticCurveTo(-0.55, -0.12, -0.36, -0.09);
  p.quadraticCurveTo(-0.27, -0.09, -0.24, -0.16);
  p.lineTo(-0.2, -0.3);
  p.quadraticCurveTo(-0.15, -0.33, -0.11, -0.28);
  p.lineTo(-0.1, -0.06);
  p.closePath();
  const stockGeo = new THREE.ExtrudeGeometry(p, { depth: 0.058, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 4, curveSegments: 16 });
  stockGeo.translate(0, 0, -0.029);
  stockGeo.rotateY(-Math.PI / 2);
  const stock = new THREE.Mesh(stockGeo, wood);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.22, 0.03, 2, 0.01), rubber);
  pad.position.set(0, -0.065, -0.8);
  pad.rotation.x = -0.05;
  body.add(stock, pad);

  // Corredera (se desliza hacia atrás al recargar).
  const pump = new THREE.Group();
  pump.position.set(0, -0.032, 0.5);
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.04, 0.3, 20), wood);
  fore.rotation.x = Math.PI / 2;
  pump.add(fore);
  for (let i = 0; i < 6; i++) {
    const ribbing = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.004, 6, 20), steelDark);
    ribbing.position.z = -0.1 + i * 0.04;
    pump.add(ribbing);
  }
  body.add(pump);

  // Efectos de boca: núcleo, cono y dos aspas cruzadas con la textura de fogonazo.
  const muzzle = new THREE.Group();
  muzzle.position.set(0, 0.035, 1.2);
  body.add(muzzle);
  const flashMat = new THREE.MeshBasicMaterial({
    map: T.flash(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flash = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), coreMat);
  core.scale.set(1, 1, 1.8);
  core.position.z = 0.06;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 14, 1, true), coreMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = 0.27;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), flashMat);
  const side1 = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.42), flashMat);
  side1.rotation.y = Math.PI / 2;
  side1.position.z = 0.28;
  const side2 = side1.clone();
  side2.rotation.z = Math.PI / 2;
  flash.add(core, cone, front, side1, side2);
  muzzle.add(flash);
  const light = new THREE.PointLight(0xffa24a, 0, 9, 2);
  muzzle.add(light);

  g.traverse(o => { if (o.isMesh && o.material !== flashMat && o.material !== coreMat) o.castShadow = true; });

  // Cartucho de repuesto (plantilla para los expulsados).
  const shell = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.09, 14),
    new THREE.MeshStandardMaterial({ color: 0xb3151f, roughness: 0.45 }));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.026, 14), brass);
  head.position.y = -0.055;
  shell.add(hull, head);
  shell.traverse(o => { o.castShadow = true; });

  return {
    group: g, body, pump, muzzle, flash, flashMat, coreMat, light, shell,
    // Puntos donde van las manos del crupier y por donde sale el cartucho.
    grip: new THREE.Vector3(0.06, -0.17, -0.17),
    fore: new THREE.Vector3(0, -0.085, 0.0),   // relativo a la corredera
    port: new THREE.Vector3(0.06, 0.02, 0.08),
  };
}

// Humo del disparo: sprites que se expanden, frenan, suben y se desvanecen.
export class Smoke {
  constructor(scene) {
    this.scene = scene;
    this.puffs = [];
  }

  burst(origin, dir, n = 16) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.SpriteMaterial({ map: T.smoke(), color: 0xc9c6c0, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.position.copy(origin);
      const speed = 0.4 + Math.random() * 2.2;
      const v = dir.clone().multiplyScalar(speed)
        .add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.3, (Math.random() - 0.5) * 0.5));
      s.material.rotation = Math.random() * Math.PI * 2;
      this.scene.add(s);
      this.puffs.push({ s, v, life: 1.6 + Math.random() * 1.4, age: 0, size: 0.12 + Math.random() * 0.1, spin: (Math.random() - 0.5) * 0.8 });
    }
  }

  update(dt) {
    this.puffs = this.puffs.filter(p => {
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { this.scene.remove(p.s); p.s.material.dispose(); return false; }
      p.v.multiplyScalar(Math.pow(0.08, dt));
      p.v.y += dt * 0.25;
      p.s.position.addScaledVector(p.v, dt);
      const sz = p.size * (1 + k * 5);
      p.s.scale.set(sz, sz, 1);
      p.s.material.rotation += p.spin * dt;
      p.s.material.opacity = Math.min(1, p.age / 0.05) * (1 - k) * 0.55;
      return true;
    });
  }
}

// Cartuchos expulsados: caen con gravedad, rebotan en la mesa o el suelo y se quedan un rato.
export class Shells {
  constructor(scene, template, floorAt) {
    this.scene = scene;
    this.template = template;
    this.floorAt = floorAt;   // (x, z) -> altura de la superficie bajo ese punto
    this.list = [];
  }

  eject(pos, vel) {
    const s = this.template.clone();
    s.position.copy(pos);
    s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.scene.add(s);
    this.list.push({ s, v: vel.clone(), w: new THREE.Vector3(14, 6, 9).multiplyScalar(Math.random() + 0.5), age: 0, rest: false });
  }

  update(dt) {
    this.list = this.list.filter(c => {
      c.age += dt;
      if (c.age > 12) { this.scene.remove(c.s); return false; }
      if (c.rest) return true;
      c.v.y += GRAVITY * dt;
      c.s.position.addScaledVector(c.v, dt);
      c.s.rotation.x += c.w.x * dt; c.s.rotation.y += c.w.y * dt; c.s.rotation.z += c.w.z * dt;
      const floor = this.floorAt(c.s.position.x, c.s.position.z) + 0.026;
      if (c.s.position.y < floor) {
        c.s.position.y = floor;
        if (Math.abs(c.v.y) < 0.4) {
          // Se queda tumbado.
          c.rest = true;
          c.s.rotation.set(Math.PI / 2, c.s.rotation.y, 0);
        } else {
          c.v.y *= -0.35;
          c.v.x *= 0.6; c.v.z *= 0.6;
          c.w.multiplyScalar(0.5);
        }
      }
      return true;
    });
  }
}
