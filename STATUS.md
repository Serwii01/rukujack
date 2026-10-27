# Estado del proyecto

> Lo mantiene Claude con `/cerrar`. Es la memoria de trabajo: dónde se quedó y qué viene después.

## Estado actual
Juego jugable: modo solo contra la IA y mesa online P2P de hasta 6 jugadores, con roles de crupier/apostador, chat en partida, personajes animados por jugador, vista de crupier, escopeta, modo retro y sonido.

## Siguientes pasos
- [ ] Publicarlo en un hosting estático si aún no lo está
- [ ] Ideas del README: rotación automática del crupier, objetos estilo Buckshot (lupa, cigarro), separar parejas y seguro

## Última sesión
### 2026-10-16 (reconstruido desde git, hecho en otro equipo)
- Personajes para cada jugador y crupier más realistas, vista de crupier y disparo más realista.
- Antes (2026-10-15): mejoras del 3D, chat en partida y botón Pasar.

## Decisiones
- P2P con PeerJS para no necesitar servidor propio; si el anfitrión se va, la mesa se cierra.

## Problemas conocidos
- En redes restrictivas (institutos, empresas) WebRTC puede fallar.
