export function safeStorageGet(key) {
  try { return localStorage.getItem(key) || ""; } catch (_) { return ""; }
}

export function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
}

export function safeStorageRemove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}

export function getPlayerToken() {
  let token = safeStorageGet("ruletaPlayerToken");
  if (!token) {
    token = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`).replace(/[^a-zA-Z0-9-]/g, "");
    safeStorageSet("ruletaPlayerToken", token);
  }
  return token;
}

export function rememberOnlineSeat(code, token) {
  if (code) safeStorageSet("ruletaLastRoom", code);
  if (token) safeStorageSet("ruletaPlayerToken", token);
}

export function rememberedRoomCode() {
  return safeStorageGet("ruletaLastRoom").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function rememberedPlayerToken() {
  return safeStorageGet("ruletaPlayerToken").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
}
