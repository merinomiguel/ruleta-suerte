# La Ruleta de la Suerte — Juego online

Juego web inspirado en los concursos clásicos de ruleta y paneles de palabras, desarrollado como proyecto de portfolio. Permite jugar partidas locales u online con salas privadas, códigos de invitación y sincronización en tiempo real entre varios jugadores.

> Proyecto fan/no oficial. No está afiliado a Antena 3 ni a ningún programa, marca o productora.

## Demo local

```bash
npm install
npm start
```

Después abre:

```text
http://localhost:3000
```

## El reto

La idea inicial era crear una versión jugable en navegador de un concurso de paneles: ruleta, letras ocultas, compra de vocales, turnos, bote, rondas y resolución final.

El reto fue evolucionarlo de una experiencia local a una partida online sincronizada:

- crear salas privadas con código;
- permitir de 2 a 4 jugadores;
- controlar turnos y acciones en tiempo real;
- mantener una interfaz responsive;
- permitir reconexión si alguien recarga o se cae;
- conservar una experiencia rápida, sin frameworks ni build step;
- mantener el código separado por responsabilidad para que sea fácil de ampliar.

## Stack

- HTML, CSS y JavaScript vanilla
- Node.js
- WebSockets con [`ws`](https://www.npmjs.com/package/ws)
- Web Audio API para sonidos generados en el navegador
- SVG para dibujar la ruleta

## Funcionalidades principales

- Partida de 5 rondas.
- Dificultad progresiva por ronda.
- Base de datos integrada con 200 paneles en español de España.
- Modo local para 2 a 4 jugadores.
- Modo online con salas privadas.
- Código de sala y enlace compartible.
- Lobby visual con plazas J1–J4.
- El anfitrión es el único que puede empezar la partida.
- Reconexión por `playerToken` guardado en `localStorage`.
- Turnos circulares entre jugadores.
- Compra de vocales.
- Resolución de panel.
- Ruleta con gajos de dinero, quiebra, pierde turno, x2, mitad, comodín y bote.
- Bote variable con regla propia:
  - crece entre rondas;
  - recibe dinero de quiebras y fallos;
  - solo se gana cayendo en el gajo de bote en la ronda final.
- Historial de partida en vivo.
- Sonidos y animaciones.
- Diseño responsive para escritorio y móvil.

## Decisiones técnicas

### 1. Una aplicación ligera y sin framework

El juego usa HTML, CSS y JavaScript vanilla servidos como archivos estáticos desde `public/`. No requiere bundler ni paso de compilación, pero mantiene separadas la estructura, los estilos, la lógica de cliente y el banco de paneles.

Ventajas:

- fácil de ejecutar;
- fácil de desplegar;
- sin build step;
- ideal para portfolio y prototipado rápido.

### 2. WebSockets para sincronización online

El servidor Node mantiene las salas y retransmite el estado entre jugadores mediante WebSockets.

La comunicación principal se basa en snapshots de estado del juego. Esto es suficiente para una experiencia casual entre amigos y permite que el cliente siga siendo muy simple.

### 3. Reconexión por token

Cada navegador genera o reutiliza un `playerToken` guardado en `localStorage`.

Esto permite que, si un jugador recarga la página o pierde conexión, pueda volver a ocupar su misma plaza en la sala. Si la partida ya empezó, el servidor no permite entrar a jugadores nuevos, solo reconectar a plazas existentes.

### 4. Servidor modular como gestor de sala

El backend separa el servidor estático, la gestión de salas y la capa WebSocket. Se encarga de:

- crear salas;
- asignar plazas;
- recordar tokens;
- marcar jugadores conectados/desconectados;
- limitar las salas a 4 jugadores;
- impedir que un invitado empiece la partida;
- rechazar entradas nuevas cuando la partida ya está en curso.

El juego en sí todavía vive principalmente en el cliente. Para una versión competitiva real, el siguiente paso sería convertir el servidor en autoridad completa de las reglas.

### 5. Ruleta en SVG

La ruleta se genera como SVG para poder dibujar los gajos, colores, textos y estados especiales sin depender de imágenes externas.

El giro funciona manteniendo pulsada la ruleta para cargar fuerza. La fuerza determina la velocidad inicial y la inercia decide el gajo final.

## Estructura del proyecto

```text
.
├── public
│   ├── index.html              # Estructura HTML de la interfaz
│   ├── css
│   │   ├── styles.css          # Índice de estilos
│   │   └── modules
│   │       ├── base.css        # Variables, reset y base visual
│   │       ├── start.css       # Portada, lobby y formulario local
│   │       ├── game.css        # Tablero, jugadores y estado de partida
│   │       ├── wheel.css       # Ruleta y controles de giro
│   │       ├── dialogs.css     # Modales, teclado y final
│   │       └── responsive.css  # Adaptación móvil y modo plató
│   └── js
│       ├── data
│       │   └── panels.js       # Banco de paneles
│       └── game
│           ├── app.js          # Flujo principal de partida
│           ├── audio.js        # Sonidos Web Audio
│           ├── config.js       # Constantes de juego y ruleta
│           ├── dom.js          # Accesos DOM compartidos
│           ├── effects.js      # Animaciones puntuales y confeti
│           ├── format.js       # Normalización y formato de dinero
│           ├── history.js      # Historial de acciones
│           ├── online.js       # Lobby, WebSocket y reconexión
│           ├── panels.js       # Selección progresiva de paneles
│           ├── storage.js      # LocalStorage y tokens
│           └── wheel.js        # Construcción SVG de la ruleta
├── src
│   └── server
│       ├── realtime.js         # WebSocket y sincronización online
│       ├── rooms.js            # Estado y utilidades de salas
│       └── static-server.js    # Servidor HTTP de archivos estáticos
├── server.js                   # Punto de entrada Node
├── package.json      # Scripts y dependencias
├── package-lock.json
└── README.md
```

## Scripts

```bash
npm start
```

Arranca el servidor en:

```text
http://localhost:3000
```

El puerto se puede cambiar con la variable `PORT`:

```bash
PORT=8080 npm start
```

## Cómo jugar

### Modo online

1. Un jugador crea una sala.
2. Comparte el código o enlace.
3. Los demás jugadores entran con el código.
4. Cuando hay al menos 2 jugadores, el anfitrión puede empezar.
5. La partida admite hasta 4 jugadores.

### Modo local

1. Pulsa “Jugar partida local”.
2. Introduce los nombres de 2 a 4 jugadores.
3. Empieza la partida en el mismo dispositivo.

## Despliegue

El proyecto puede desplegarse en servicios que soporten Node.js y WebSockets, por ejemplo:

- Render
- Railway
- Fly.io
- VPS propio

Comando de arranque:

```bash
npm start
```

Si el proveedor define `PORT`, el servidor lo usa automáticamente:

```js
const PORT = process.env.PORT || 3000;
```

## Limitaciones actuales

- El servidor gestiona salas y reconexión, pero no valida todas las reglas del juego acción por acción.
- La sincronización se basa en snapshots, suficiente para uso casual pero no anti-trampas.
- No hay persistencia en base de datos: si el servidor se reinicia, las salas se pierden.
- Los paneles viven en un módulo JavaScript estático; no hay base de datos externa.

## Próximas mejoras

- Servidor autoritativo por acciones en vez de snapshots.
- Temporizador opcional por turno.
- QR para compartir sala desde móvil.
- Pantalla de configuración de partida.
- Modo partida corta de 3 rondas.
- Persistencia temporal de salas.
- Tests automáticos de reglas principales.

## Autor

Proyecto desarrollado por Miguel como ejercicio de producto, frontend interactivo y juego online en tiempo real para portfolio.
