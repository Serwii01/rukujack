# Estado del proyecto

> Lo mantiene Claude con `/cerrar`. Es la memoria de trabajo: dónde se quedó y qué viene después.

## Estado actual
Juego jugable: modo solo contra la IA y mesa online P2P de hasta 6 jugadores, con roles de crupier/apostador, modo retro y sonido.

## Siguientes pasos
- [ ] Publicarlo en un hosting estático si aún no lo está
- [ ] Ideas del README: rotación automática del crupier, objetos estilo Buckshot (lupa, cigarro), separar parejas y seguro, chat rápido

## Última sesión
### 2026-10-15 (reconstruido desde git)
- Versión jugable del juego.

## Decisiones
- P2P con PeerJS para no necesitar servidor propio; si el anfitrión se va, la mesa se cierra.

## Problemas conocidos
- En redes restrictivas (institutos, empresas) WebRTC puede fallar.
