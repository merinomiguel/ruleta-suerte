const crypto = require("crypto");

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

function publicRoom(room) {
  return room.players.map(player => player ? {
    name: player.name,
    connected: player.socket?.readyState === player.socket?.OPEN
  } : null);
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

function compactWaitingRoom(room) {
  if (room.started || room.players[0]) return;
  const nextHostIndex = room.players.findIndex(Boolean);
  if (nextHostIndex > 0) {
    room.players[0] = room.players[nextHostIndex];
    room.players[nextHostIndex] = null;
  }
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

module.exports = {
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
};
