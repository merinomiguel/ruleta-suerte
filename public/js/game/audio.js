let audioContext = null;
let soundEnabled = true;

export function ensureAudio() {
  if (!soundEnabled) return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioContext) audioContext = new AudioCtor();
  if (audioContext.state === "suspended") audioContext.resume().catch?.(()=>{});
  return audioContext;
}

export function unlockAudio() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  try { source.start(0); } catch (_) {}
}

function tone(frequency, duration = .1, type = "sine", volume = .05, delay = 0) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;
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
  if (name === "turn") { tone(440, .12, "triangle", .055); tone(660, .16, "triangle", .052, .12); }
  if (name === "timeWarning") tone(720, .07, "sine", .04);
  if (name === "timeCritical") { tone(880, .055, "square", .038); tone(660, .045, "square", .026, .065); }
}

export function toggleSound($) {
  soundEnabled = !soundEnabled;
  $("soundBtn").textContent = soundEnabled ? "🔊" : "🔇";
  $("soundBtn").setAttribute("aria-label", soundEnabled ? "Silenciar sonidos" : "Activar sonidos");
  if (soundEnabled) {
    unlockAudio();
    sfx("good");
  }
}

["pointerdown","touchstart","keydown"].forEach(eventName=>{
  window.addEventListener(eventName, unlockAudio, { once:true, passive:true });
});
