const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const MAX_PLAYERS = 4;
const rooms = new Map();

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function makeToken() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function cleanToken(token) {
  return String(token || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
}

function broadcast(room, payload, except = null) {
  room.players.forEach(player => {
    if (player?.socket && player.socket !== except) send(player.socket, payload);
  });
}

function broadcastRoomUpdate(room) {
  room.players.forEach((player, index) => {
    if (player?.socket) {
      send(player.socket, {
        type: "room_update",
        code: room.code,
        players: publicRoom(room),
        playerIndex: index,
        isHost: index === 0
      });
    }
  });
}

function publicRoom(room) {
  return room.players.map(player => player ? {
    name: player.name,
    connected: player.socket?.readyState === player.socket?.OPEN
  } : null);
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function findRoomForSocket(socket) {
  for (const [code, room] of rooms) {
    const index = room.players.findIndex(player => player?.socket === socket);
    if (index !== -1) return { code, room, index };
  }
  return null;
}

const server = http.createServer((req, res) => {
  const rawPath = decodeURIComponent(req.url.split("?")[0]);
  const safePath = rawPath === "/" ? "/index.html" : rawPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on("connection", socket => {
  socket.on("message", raw => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(socket, { type: "error", message: "Mensaje no válido." });
      return;
    }

    if (message.type === "create_room") {
      const existing = findRoomForSocket(socket);
      if (existing) {
        send(socket, { type: "error", message: `Ya estás en la sala ${existing.code}.` });
        return;
      }
      const code = makeCode();
      const token = cleanToken(message.token) || makeToken();
      const room = {
        code,
        players: Array.from({ length: MAX_PLAYERS }, (_, index) => index === 0 ? { name: String(message.name || "Jugador 1").slice(0, 16), socket, token } : null),
        state: null,
        started: false,
        lastActivity: Date.now()
      };
      rooms.set(code, room);
      send(socket, { type: "room_created", code, playerIndex: 0, isHost: true, players: publicRoom(room), token });
      return;
    }

    if (message.type === "join_room") {
      const code = String(message.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(socket, { type: "error", message: "No existe una sala con ese código." });
        return;
      }

      const token = cleanToken(message.token) || makeToken();
      const existingIndex = room.players.findIndex(player => player?.socket === socket);
      if (existingIndex !== -1) {
        send(socket, { type: "room_joined", code, playerIndex: existingIndex, isHost: existingIndex === 0, players: publicRoom(room), started: room.started, state: room.state, token: room.players[existingIndex].token });
        return;
      }

      const otherRoom = findRoomForSocket(socket);
      if (otherRoom && otherRoom.code !== code) {
        send(socket, { type: "error", message: `Ya estás en la sala ${otherRoom.code}. Recarga para cambiar de sala.` });
        return;
      }

      const tokenIndex = room.players.findIndex(player => player?.token && player.token === token);
      if (tokenIndex !== -1) {
        const reconnectName = String(message.name || "").trim();
        if (reconnectName && reconnectName !== "Jugador") room.players[tokenIndex].name = reconnectName.slice(0, 16);
        room.players[tokenIndex].socket = socket;
        room.lastActivity = Date.now();
        send(socket, { type: "room_joined", code, playerIndex: tokenIndex, isHost: tokenIndex === 0, players: publicRoom(room), started: room.started, state: room.state, token });
        broadcastRoomUpdate(room);
        return;
      }

      let index = room.players.findIndex(player => !player);
      if (index === -1) {
        send(socket, { type: "error", message: "La sala ya está completa." });
        return;
      }
      if (room.started) {
        send(socket, { type: "error", message: "La partida ya ha empezado. Solo pueden volver jugadores desconectados." });
        return;
      }

      room.players[index] = { name: String(message.name || `Jugador ${index + 1}`).slice(0, 16), socket, token };
      room.lastActivity = Date.now();
      send(socket, { type: "room_joined", code, playerIndex: index, isHost: index === 0, players: publicRoom(room), started: room.started, state: room.state, token });
      broadcastRoomUpdate(room);
      return;
    }

    if (message.type === "snapshot") {
      const code = String(message.code || "").toUpperCase();
      const room = rooms.get(code);
      const senderIndex = room ? room.players.findIndex(player => player?.socket === socket) : -1;
      if (!room || senderIndex === -1) {
        send(socket, { type: "error", message: "No estás dentro de esa sala." });
        return;
      }
      if (!room.started && senderIndex !== 0) {
        send(socket, { type: "error", message: "Solo el anfitrión puede empezar la partida." });
        return;
      }
      room.state = message.state;
      room.started = true;
      room.lastActivity = Date.now();
      broadcast(room, { type: "snapshot", code, state: room.state, reason: message.reason || "state" }, socket);
    }
  });

  socket.on("close", () => {
    const found = findRoomForSocket(socket);
    if (!found) return;
    const { room, index } = found;
    if (room.players[index]?.socket === socket) room.players[index].socket = null;
    broadcast(room, { type: "peer_left", players: publicRoom(room) });
    broadcastRoomUpdate(room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const hasConnectedPlayer = room.players.some(player => player?.socket?.readyState === player.socket?.OPEN);
    if (!hasConnectedPlayer && now - room.lastActivity > 30 * 60 * 1000) rooms.delete(code);
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`La Ruleta de la Suerte online: http://localhost:${PORT}`);
});
