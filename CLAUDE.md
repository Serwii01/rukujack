# RUKUJACK

Blackjack multijugador (1–6 jugadores) en el navegador, con escena 3D de sala oscura con neones y crupier enmascarado (guiño a *Buckshot Roulette*). Web 100 % estática, sin servidor ni base de datos. Reglas y modos detallados en `README.md`.

## Stack
- JavaScript vanilla con módulos ES, sin build ni dependencias npm.
- Three.js 0.160 vía import map desde unpkg (escena 3D).
- PeerJS 1.5.4 (WebRTC P2P): el navegador del anfitrión ejecuta la partida; el servidor público de PeerJS solo hace de punto de encuentro.

## Estructura
- `index.html` — entrada, import map y scripts.
- `js/main.js` — orquestación de UI y partida.
- `js/blackjack.js` — reglas y estado de la mesa (`Table`, apuestas, crupier).
- `js/net.js` — red P2P (`HostNet`, `ClientNet`, códigos de mesa).
- `js/scene.js`, `js/layout.js`, `js/textures.js` — escena 3D, posiciones de asientos, texturas (modo nítido y retro).
- `js/audio.js` — sonido.
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
