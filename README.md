# RUKUJACK — Blackjack online

Blackjack multijugador para **1 a 6 jugadores** en el navegador. Estética de sala oscura con neones, lámpara colgante que parpadea, crupier enmascarado con visera luminosa y una escopeta bajo la mesa para quien se arruine del todo (con un guiño a *Buckshot Roulette*).

Es una **web 100 % estática**: no necesita servidor, base de datos ni pagar nada.

## Modos de juego

- **Jugar solo**: tú contra la casa (IA).
- **Abrir mesa online**: te da un código de 5 letras y un botón **Copiar enlace**. Quien lo abra solo tiene que firmar y pulsar **Unirse**. Caben hasta 6 personas, y se pueden ir sumando o marchando entre rondas.

## Chat

En las mesas online hay chat (abajo a la izquierda; en el móvil, botón **Chat**). Pulsa `T` para escribir y `Esc` para salir. Hay frases rápidas y cada mensaje aparece unos segundos en un bocadillo sobre el asiento de quien habla.

- Los mensajes van por la misma conexión P2P que la partida: el anfitrión los reparte a todos. **No se guardan en ningún servidor**; al cerrar la mesa desaparecen.
- Quien se une recibe los últimos 40 mensajes. Máximo 140 caracteres y 4 mensajes cada 5 s por jugador.

## Roles: quién reparte y quién apuesta

Pulsa **MESA** (arriba a la derecha) para ver el panel de la mesa.

- **Crupier**: el anfitrión elige si reparte **la casa (IA)** o **cualquier jugador**. El crupier humano es la banca: cobra lo que pierden los demás y paga lo que ganan, con sus propias fichas (puede quedarse en negativo).
  - Con 16 o menos **tiene que pedir**. Con 17 o más **decide**: plantarse o arriesgar.
  - Puede pulsar **Repartir** sin esperar a que todos apuesten.
  - Si no decide en 20 s, o si se va de la mesa, la IA termina la mano.
- **Apostar / Mirar**: cada jugador puede levantarse a mirar o volver a apostar. El anfitrión también puede cambiar el rol de los demás.
- Los cambios de rol se hacen entre rondas, durante las apuestas.

## Cómo funciona el online

- El navegador del anfitrión ejecuta la partida. Los demás se conectan directamente a él por **WebRTC** (P2P) usando [PeerJS](https://peerjs.com). El servidor público y gratuito de PeerJS solo sirve para que los navegadores se encuentren.
- Si el anfitrión cierra la pestaña, la mesa se cierra para todos.
- En redes muy restrictivas (algunas de institutos o empresas) la conexión entre navegadores puede fallar. Desde casa o con datos móviles suele funcionar bien.

## Probar en tu ordenador

Los módulos JavaScript no funcionan abriendo `index.html` con doble clic. Necesitas Node.js:

```bash
node dev-server.mjs
```

Después abre http://localhost:8080. Para probar el multijugador, abre una mesa en una pestaña y únete desde otra. Para usar otro puerto, ejecuta antes `PORT=8090` (en PowerShell: `$env:PORT=8090`).

## Alojarlo gratis (elige una opción)

### Vercel
Importa el repositorio en Vercel sin *framework* ni comando de build ("Other"); sirve los archivos tal cual. Cada `git push` vuelve a publicar.

### Opción A: Netlify Drop (la más rápida)
1. Entra en https://app.netlify.com/drop.
2. Arrastra **la carpeta entera** del proyecto.
3. Te da una URL `https://algo.netlify.app`. Puedes cambiarle el nombre en *Site settings*.

### Opción B: GitHub Pages
1. Crea un repositorio público en GitHub y sube todos los archivos (con `index.html` en la raíz).
2. Ve a *Settings → Pages → Build and deployment → Deploy from a branch*, elige `main` y la carpeta `/ (root)`.
3. En un minuto estará en `https://TU_USUARIO.github.io/NOMBRE_REPO/`.

### Opción C: Cloudflare Pages
*Workers & Pages → Create → Pages → Upload assets* y sube la carpeta.

### Opción D: itch.io
1. Comprime la carpeta en un `.zip` (con `index.html` en la raíz del zip).
2. Crea un proyecto nuevo, *Kind of project: HTML*, sube el zip y marca *This file will be played in the browser*.
3. Tamaño recomendado del marco: 1280×720, con el botón de pantalla completa activado.

`dev-server.mjs` y la carpeta `.claude/` no hacen falta en el servidor. No pasa nada si se suben.

## Reglas

- 6 barajas. Blackjack paga 3 a 2. Doblar con las dos primeras cartas de cada mano (también tras separar). No hay seguro.
- **Separar**: con dos cartas del mismo valor (8-8, K-10…) puedes partir la mano en dos, poniendo otra apuesta igual. Hasta 3 manos por jugador. Al separar ases, cada mano recibe solo una carta más. Un 21 tras separar no cuenta como blackjack.
- La casa (IA) pide hasta llegar a 17. El crupier humano debe pedir con 16 o menos y decide con 17 o más.
- Apuesta mínima: 10. Empiezas con 500 fichas.
- **Pasar**: si no quieres jugar una mano, pulsa *Pasar* (o `X`) durante las apuestas. Puedes arrepentirte con *Volver a apostar* mientras sigan abiertas. Si pasan todos, la mano se salta.
- **Exenciones**: si te quedas sin fichas, puedes firmar una exención para recibir 500 más. **Solo hay 3.** Si te arruinas sin exenciones, el crupier saca la escopeta y quedas **eliminado**: ya solo puedes mirar.
- En multijugador hay 20 s para apostar (desde la primera apuesta) y 30 s por turno. Si se acaba el tiempo, te plantas automáticamente.

Teclas: `H` pedir · `S` plantarse · `D` doblar · `P` separar · `Enter` apostar (o repartir, si eres el crupier) · `X` pasar · `T` chat.

## Gráficos

Por defecto se ve nítido, con texturas en alta resolución, materiales PBR que reflejan los neones de la sala y *bloom* selectivo (solo brillan neones, visera, LED y detalles de acento). El crupier tiene brazos articulados que siguen a la mano al repartir. Las fichas apostadas se descomponen en denominaciones reales (10, 25, 50, 100, 500…) y se apilan en varias pilas según la cantidad. El botón **Retro** (arriba a la derecha) activa el modo pixelado de baja resolución. La elección se guarda en el navegador.

## Recursos y licencias

| Recurso | Origen | Licencia |
|---|---|---|
| Motor 3D | [three.js](https://threejs.org) 0.160 (CDN unpkg) | MIT |
| Red P2P | [PeerJS](https://peerjs.com) 1.5.4 (CDN unpkg) | MIT |
| Fuente de interfaz | [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) (Google Fonts) | SIL OFL |
| Fuente pixel | [VT323](https://fonts.google.com/specimen/VT323) (Google Fonts) | SIL OFL |
| Fuente máquina de escribir | [Special Elite](https://fonts.google.com/specimen/Special+Elite) (Google Fonts) | Apache 2.0 |
| Cartas, tapete, paredes, visera, neones | Generados por código (`js/textures.js`) | Propios |
| Sonidos y ambiente | Sintetizados con WebAudio (`js/audio.js`) | Propios |

No hay imágenes ni audios de terceros que acreditar.

## Estructura

```
index.html          interfaz, panel de la mesa y lobby (la "exención" que firmas)
css/style.css       estilos: paneles de cristal, neón, efecto CRT suave
js/main.js          une todo: lobby, HUD, panel de roles, red, entradas
js/blackjack.js     reglas, roles y estado de la mesa (solo lo ejecuta el anfitrión)
js/net.js           conexión P2P con PeerJS
js/scene.js         escena 3D: mesa en D, crupier, cartas, luces
js/textures.js      texturas procedurales
js/audio.js         efectos y ambiente sintetizados
js/layout.js        posiciones y colores de los 6 asientos
```

## Ideas para ampliar

- Rotación automática del crupier cada X rondas.
- Objetos estilo Buckshot (p. ej. "lupa": ver la carta tapada; "cigarro": deshacer la última carta).
- Separar parejas y seguro.
