let audioContext = null;
let soundEnabled = true;

export function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}

function tone(frequency, duration = .1, type = "sine", volume = .05, delay = 0) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}

export function sfx(name) {
  if (!soundEnabled) return;
  if (name === "tick") tone(900, .035, "square", .018);
  if (name === "charge") tone(260, .08, "sine", .035);
  if (name === "spin") { tone(220, .28, "sawtooth", .035); tone(440, .22, "sine", .025, .08); }
  if (name === "good") { tone(523, .14, "sine", .06); tone(659, .16, "sine", .06, .11); tone(784, .2, "sine", .06, .22); }
  if (name === "bad") { tone(190, .2, "sawtooth", .055); tone(135, .28, "sawtooth", .05, .13); }
  if (name === "bankrupt") { tone(130, .38, "square", .07); tone(82, .5, "sawtooth", .06, .18); }
  if (name === "round") { [523, 659, 784, 1047].forEach((f, i) => tone(f, .28, "sine", .055, i * .1)); }
  if (name === "win") { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .38, "triangle", .06, i * .11)); }
}

export function toggleSound($) {
  soundEnabled = !soundEnabled;
  $("soundBtn").textContent = soundEnabled ? "🔊" : "🔇";
  $("soundBtn").setAttribute("aria-label", soundEnabled ? "Silenciar sonidos" : "Activar sonidos");
  if (soundEnabled) {
    ensureAudio();
    sfx("good");
  }
}
