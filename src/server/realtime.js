const { WebSocketServer } = require("ws");
const {
  MAX_PLAYERS,
  rooms,
  send,
  makeToken,
  cleanToken,
  broadcast,
  publicRoom,
  broadcastRoomUpdate,
  compactWaitingRoom,
  makeCode,
  findRoomForSocket
} = require("./rooms");

function createRoom(socket, message) {
  const existing = findRoomForSocket(socket);
  if (existing) {
    send(socket, { type: "error", message: `Ya estás en la sala ${existing.code}.` });
    return;
  }

  const code = makeCode();
  const token = cleanToken(message.token) || makeToken();
  const room = {
    code,
    players: Array.from({ length: MAX_PLAYERS }, (_, index) => index === 0
      ? { name: String(message.name || "Jugador 1").slice(0, 16), socket, token }
      : null),
    state: null,
    started: false,
    lastActivity: Date.now()
  };

  rooms.set(code, room);
  send(socket, { type: "room_created", code, playerIndex: 0, isHost: true, players: publicRoom(room), token });
}

function joinRoom(socket, message) {
  const code = String(message.code || "").toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    send(socket, { type: "error", message: "No existe una sala con ese código." });
    return;
  }

  const token = cleanToken(message.token) || makeToken();
  const existingIndex = room.players.findIndex(player => player?.socket === socket);

  if (existingIndex !== -1) {
    send(socket, {
      type: "room_joined",
      code,
      playerIndex: existingIndex,
      isHost: existingIndex === 0,
      players: publicRoom(room),
      started: room.started,
      state: room.state,
      token: room.players[existingIndex].token
    });
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
    send(socket, {
      type: "room_joined",
      code,
      playerIndex: tokenIndex,
      isHost: tokenIndex === 0,
      players: publicRoom(room),
      started: room.started,
      state: room.state,
      token
    });
    broadcastRoomUpdate(room);
    return;
  }

  const index = room.players.findIndex(player => !player);
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
  send(socket, {
    type: "room_joined",
    code,
    playerIndex: index,
    isHost: index === 0,
    players: publicRoom(room),
    started: room.started,
    state: room.state,
    token
  });
  broadcastRoomUpdate(room);
}

function leaveRoom(socket, message) {
  const code = String(message.code || "").toUpperCase();
  const room = rooms.get(code);
  const index = room ? room.players.findIndex(player => player?.socket === socket) : -1;

  if (!room || index === -1) {
    send(socket, { type: "left_room", code });
    return;
  }

  send(socket, { type: "left_room", code });
  if (room.started) {
    room.players[index].socket = null;
    room.lastActivity = Date.now();
    broadcast(room, { type: "peer_left", players: publicRoom(room) }, socket);
    broadcastRoomUpdate(room);
    return;
  }

  room.players[index] = null;
  room.lastActivity = Date.now();
  if (!room.players.some(Boolean)) {
    rooms.delete(code);
    return;
  }

  compactWaitingRoom(room);
  broadcastRoomUpdate(room);
}

function saveSnapshot(socket, message) {
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

function handleMessage(socket, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    send(socket, { type: "error", message: "Mensaje no válido." });
    return;
  }

  if (message.type === "ping") {
    send(socket, { type: "pong", time: Date.now() });
    return;
  }

  if (message.type === "create_room") createRoom(socket, message);
  if (message.type === "join_room") joinRoom(socket, message);
  if (message.type === "leave_room") leaveRoom(socket, message);
  if (message.type === "snapshot") saveSnapshot(socket, message);
}

function handleClose(socket) {
  const found = findRoomForSocket(socket);
  if (!found) return;

  const { room, index } = found;
  if (room.players[index]?.socket === socket) room.players[index].socket = null;
  broadcast(room, { type: "peer_left", players: publicRoom(room) });
  broadcastRoomUpdate(room);
}

function startHeartbeat(wss) {
  return setInterval(() => {
    wss.clients.forEach(socket => {
      if (socket.isAlive === false) {
        socket.terminate();
        return;
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 25 * 1000);
}

function startRoomCleanup() {
  return setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const hasConnectedPlayer = room.players.some(player => player?.socket?.readyState === player.socket?.OPEN);
      if (!hasConnectedPlayer && now - room.lastActivity > 30 * 60 * 1000) rooms.delete(code);
    }
  }, 60 * 1000);
}

function attachRealtimeServer(server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", socket => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("message", raw => handleMessage(socket, raw));
    socket.on("close", () => handleClose(socket));
  });

  startHeartbeat(wss);
  startRoomCleanup();
  return wss;
}

module.exports = { attachRealtimeServer };
