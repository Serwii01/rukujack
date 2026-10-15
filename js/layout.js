// Geometría compartida de la mesa (unidades del mundo 3D).
// Mesa en forma de "D": borde recto en el lado del crupier (z negativo) y un
// arco hacia los jugadores. Seis asientos repartidos por el arco.

export const TABLE_W = 4.4;
export const TABLE_D = 2.6;
export const TABLE_R = 2.2;          // radio del arco del tapete
export const ARC_CZ = -0.9;          // centro del arco (z)
export const BACK_Z = -1.3;          // borde recto
export const DEALER_CARDS_Z = -0.62;

export const SEAT_COLORS = ['#38f0ff', '#ff3d7f', '#ffd23f', '#7dff9a', '#b18cff', '#ff8a3d'];

const SEAT_R = 1.72;
export const SEATS = [-65, -39, -13, 13, 39, 65].map((deg, i) => {
  const a = deg * Math.PI / 180;
  const ox = Math.sin(a), oz = Math.cos(a);
  const x = SEAT_R * ox, z = ARC_CZ + SEAT_R * oz;
  return {
    x, z, rot: a, color: SEAT_COLORS[i],
    out: { x: ox, z: oz },
    chip: { x: x - ox * 0.42, z: z - oz * 0.42 },
  };
});

// Mundo (x, z) -> píxel en la textura del tapete.
export function feltPx(x, z, w, h) {
  return [(x + TABLE_W / 2) / TABLE_W * w, (z + TABLE_D / 2) / TABLE_D * h];
}
