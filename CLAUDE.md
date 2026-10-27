# RUKUJACK

Blackjack multijugador (1–6 jugadores) en el navegador, con escena 3D de sala oscura con neones y crupier enmascarado (guiño a *Buckshot Roulette*). Web 100 % estática, sin servidor ni base de datos. Reglas y modos detallados en `README.md`.

## Stack
- JavaScript vanilla con módulos ES, sin build ni dependencias npm.
- Three.js 0.160 vía import map desde unpkg (escena 3D).
- PeerJS 1.5.4 (WebRTC P2P): el navegador del anfitrión ejecuta la partida; el servidor público de PeerJS solo hace de punto de encuentro.

## Estructura
- `index.html` — interfaz, panel de la mesa y lobby; import map y scripts.
- `js/main.js` — une todo: lobby, HUD, panel de roles, red, entradas, chat en partida.
- `js/blackjack.js` — reglas, roles y estado de la mesa (`Table`); solo lo ejecuta el anfitrión.
- `js/net.js` — red P2P (`HostNet`, `ClientNet`, códigos de mesa).
- `js/scene.js` — escena 3D: mesa en D, crupier, cartas, luces, cámara.
- `js/characters.js` — personajes de los jugadores y sus gestos.
- `js/shotgun.js` — escopeta, humo y cartuchos.
- `js/rig.js` — IK de brazos y piernas compartida.
- `js/layout.js`, `js/textures.js` — posiciones/colores de los 6 asientos, texturas procedurales (modo nítido y retro).
- `js/audio.js` — efectos y ambiente sintetizados.
- `css/style.css`, `dev-server.mjs` — estilos y servidor local.

## Comandos
```bash
node dev-server.mjs     # http://localhost:8080 (PORT para cambiar el puerto)
```
Para probar online: abrir una mesa en una pestaña y unirse desde otra.

## Convenciones
- Textos de interfaz en español.
- Sin paso de build: cualquier librería nueva va por import map/CDN.
- Despliegue estático (Netlify Drop, GitHub Pages, Cloudflare Pages o itch.io).

> El estado del trabajo (qué se hizo, qué falta) está en `STATUS.md`.
