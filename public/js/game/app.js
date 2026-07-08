"use strict";

import { CONSONANTS, JACKPOT_ROUND, LETTERS, MAX_PLAYERS, SHORT_TURN_SECONDS, TOTAL_ROUNDS, TURN_SECONDS, VOWELS, WEDGES } from "./config.js?v=mobile-ux-1";
import { $ } from "./dom.js";
import { ensureAudio, sfx, toggleSound, unlockAudio } from "./audio.js?v=mobile-ux-1";
import { createEffects } from "./effects.js";
import { normalize, money } from "./format.js";
import { createHistory } from "./history.js";
import { selectProgressivePanels } from "./panels.js?v=board-resolve-1";
import { createOnlineController } from "./online.js?v=mobile-ux-1";
import { createWheel } from "./wheel.js?v=mobile-ux-1";

const state = {
  players: [], panels: [], round: 0, active: 0, used: new Set(),
  spinning: false, charging: false, choosing: false, currentRotation: 0,
  pendingWedge: null, finished: false, jackpot: 0, results: [],
  chargeStart: 0, charge: 0, chargeFrame: 0, velocity: 0, lastRevealed: null, lastTick: -1,
  activeWedges: [], jackpotClaimed: false, jackpotWinner: "", jackpotClaimedAmount: 0,
  choiceMode: "", statusText: "Todo listo. ¡Gira la ruleta!", statusType: "", screen: "start",
  playerSlots: [], history: [],
  timerDeadline: 0, timerRemaining: TURN_SECONDS, timerFrame: 0, activity: "",
  solveDraft: "", turnAwaitingAck: false, turnSeconds: TURN_SECONDS, shortRound: false,
  lastWarningSecond: 0, speechRecognition: null
};
const { animateElement, bumpJackpot, celebrate } = createEffects($);
const { addHistory, renderHistory } = createHistory($, state);
const { buildWheel, highlightWedge } = createWheel($, state);

const online = {
  enabled: false, connected: false, socket: null, roomCode: "", playerIndex: null,
  isHost: false, applyingRemote: false, started: false, players: [], token: "",
  pendingOpenActions: [], autoRejoining: false,
  heartbeatTimer: 0, reconnectTimer: 0, reconnectAttempts: 0, manualClose: false
};

function currentPanel() { return state.panels[state.round]; }
function currentPlayer() { return state.players[state.active]; }
function nextPlayerIndex(from=state.active) { return (from + 1) % state.players.length; }
function scoreboardLine() { return state.players.map(p=>`${p.name} ${money(p.total)}`).join(" · "); }
function timerShouldRun() {
  return state.screen==="game" && state.players.length && !state.finished && !state.spinning && !state.charging && state.activity!=="solving" && !state.turnAwaitingAck && state.timerDeadline>0;
}
function updateTimerDisplay() {
  const timer=$("turnTimer"), fill=$("timerFill"), value=$("timerValue"), label=$("timerLabel");
  if (!timer || !fill || !value || !label) return;
  if (!state.players.length || state.screen!=="game" || state.finished) {
    timer.classList.add("paused"); fill.style.width="0%"; value.textContent="—"; label.textContent="TURNO"; return;
  }
  const remaining=state.timerDeadline ? Math.max(0,Math.ceil((state.timerDeadline-Date.now())/1000)) : state.timerRemaining;
  state.timerRemaining=remaining;
  const percent=Math.max(0,Math.min(100,(remaining/state.turnSeconds)*100));
  fill.style.width=`${percent}%`;
  value.textContent=`${remaining}s`;
  label.textContent=state.turnAwaitingAck ? "Listo" : (state.activity==="solving" ? "Pausa" : (online.enabled && !onlineCanAct() ? "Espera" : "Turno"));
  timer.classList.toggle("danger",remaining<=8 && state.timerDeadline>0);
  timer.classList.toggle("paused",!timerShouldRun());
  if (timerShouldRun() && onlineCanAct() && remaining<=5 && remaining>0 && state.lastWarningSecond!==remaining) {
    state.lastWarningSecond=remaining;
    sfx(remaining<=3 ? "timeCritical" : "timeWarning");
  }
}
function timerLoop() {
  updateTimerDisplay();
  if (timerShouldRun() && state.timerRemaining<=0 && (!online.enabled || onlineCanAct())) handleTurnTimeout();
  state.timerFrame=setTimeout(timerLoop,250);
}
function ensureTimerLoop() {
  if (!state.timerFrame) state.timerFrame=setTimeout(timerLoop,250);
}
function resetTurnTimer() {
  state.timerDeadline=Date.now()+state.turnSeconds*1000;
  state.timerRemaining=state.turnSeconds;
  state.lastWarningSecond=0;
  ensureTimerLoop();
  updateTimerDisplay();
}
function stopTurnTimer() {
  state.timerDeadline=0;
  state.timerRemaining=state.turnSeconds;
  state.lastWarningSecond=0;
  updateTimerDisplay();
}
function handleTurnTimeout() {
  if (state.finished || state.spinning || state.charging || !onlineCanAct()) return;
  stopTurnTimer();
  hideChoices();
  $("modalBackdrop").classList.add("hidden");
  state.choosing=false; state.activity="";
  addHistory(`${currentPlayer().name} agotó el tiempo`,"bad");
  sfx("bad");
  switchTurn(`Tiempo agotado. Turno de ${state.players[nextPlayerIndex()].name}.`);
}
function activityText() {
  const name=currentPlayer()?.name || "el otro jugador";
  return {
    charging: `${name} está cargando la ruleta`,
    spinning: `${name} está girando la ruleta`,
    wedge: `${name} cayó en ${state.pendingWedge?.label || "un gajo"}`,
    choosing_letter: `${name} está eligiendo consonante`,
    buying_vowel: `${name} está comprando vocal`,
    solving: state.solveDraft ? `${name} escribe: ${state.solveDraft}` : `${name} está intentando resolver`
  }[state.activity] || `Turno de ${name}`;
}
function resetViewportPosition() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}
function syncVisibleViewport() {
  const viewport=window.visualViewport;
  const height=Math.round(viewport?.height || window.innerHeight || document.documentElement.clientHeight);
  const top=Math.round(viewport?.offsetTop || 0);
  const keyboardOpen=Boolean(viewport && window.innerHeight - viewport.height > 120 && document.activeElement?.id==="solutionInput");
  document.documentElement.style.setProperty("--visible-viewport-height",`${height}px`);
  document.documentElement.style.setProperty("--visible-viewport-top",`${top}px`);
  document.body.classList.toggle("keyboard-visible",keyboardOpen);
}
function bindVisibleViewport() {
  syncVisibleViewport();
  window.visualViewport?.addEventListener("resize",syncVisibleViewport);
  window.visualViewport?.addEventListener("scroll",syncVisibleViewport);
  window.addEventListener("resize",syncVisibleViewport);
  document.addEventListener("focusin",syncVisibleViewport);
  document.addEventListener("focusout",()=>setTimeout(syncVisibleViewport,0));
}
function showGameScreen() {
  document.body.classList.add("playing");
  $("startScreen").classList.add("hidden");
  $("finalScreen").classList.add("hidden");
  $("gameScreen").classList.remove("hidden");
  resetViewportPosition();
}
function showStartScreen() {
  document.body.classList.remove("playing");
  $("finalScreen").classList.add("hidden");
  $("gameScreen").classList.add("hidden");
  $("startScreen").classList.remove("hidden");
  resetViewportPosition();
}
function showFinalScreen() {
  document.body.classList.remove("playing");
  $("gameScreen").classList.add("hidden");
  $("startScreen").classList.add("hidden");
  $("finalScreen").classList.remove("hidden");
  resetViewportPosition();
}
function localPlayerNames() {
  return Array.from({ length: MAX_PLAYERS }, (_, i) => $("name"+(i+1)).value.trim())
    .map((name,i)=>name || (i < 2 ? `Jugador ${i+1}` : ""))
    .filter(Boolean)
    .slice(0, MAX_PLAYERS);
}
function occurrences(letter) { return [...currentPanel().answer].filter(c => c === letter).length; }
function hiddenLetters(pool) { return pool.filter(l => currentPanel().answer.includes(l) && !state.used.has(l)); }
function availableConsonants() { return CONSONANTS.filter(l => !state.used.has(l)); }
function hiddenConsonants() { return hiddenLetters(CONSONANTS); }
function hiddenVowels() { return hiddenLetters(VOWELS); }
function wheelDisplayLabel(wedge) {
  if (!wedge) return "";
  if (wedge.type === "money") return `${wedge.value} €`;
  if (wedge.type === "wildcard") return wedge.value ? `COMODÍN + ${wedge.value} €` : "COMODÍN";
  if (wedge.type === "jackpot") return "BOTE";
  if (wedge.type === "bankrupt") return "QUIEBRA";
  if (wedge.type === "lose") return "PIERDE";
  if (wedge.type === "x2") return "X2";
  if (wedge.type === "half") return "1/2";
  return wedge.label;
}
function wheelActionLabel(wedge) {
  if (!wedge) return "";
  if (wedge.type === "bankrupt") return "Pierdes el dinero del panel";
  if (wedge.type === "lose") return "Pierdes turno";
  if (wedge.type === "wildcard") return "Has conseguido comodín";
  if (wedge.type === "x2") return "X2 activado";
  if (wedge.type === "half") return "Mitad activada";
  if (wedge.type === "jackpot") return "Ganas el bote";
  return "Elige una consonante";
}
function renderWheelResult() {
  const el = $("wheelResult");
  if (!el || !state.players.length) return;
  const notMyTurn = !onlineCanAct();
  let text = "Lista para girar";
  let type = "";
  if (state.finished) text = "Panel terminado";
  else if (state.turnAwaitingAck) text = onlineCanAct() ? "Confirma tu turno" : `Es turno de ${currentPlayer().name}`;
  else if (state.spinning) { text = "La ruleta está en marcha"; type = "spinning"; }
  else if (state.charging) { text = "Suelta para lanzar"; type = "charging"; }
  else if (notMyTurn) text = `Espera a ${currentPlayer().name}`;
  else if (state.pendingWedge) {
    text = `Ha salido: ${wheelDisplayLabel(state.pendingWedge)}`;
    type = state.pendingWedge.type === "bankrupt" || state.pendingWedge.type === "lose" ? "bad" : "result";
  }
  el.textContent = text;
  el.className = `wheel-result ${type}`.trim();
}
function renderUsedLetters() {
  const used = LETTERS.filter(l => state.used.has(l));
  $("usedLetters").innerHTML = used.length ? used.map(l => `<span class="used-letter-chip">${l}</span>`).join("") : "—";
}
function feedbackClass(type) {
  if (type === "good") return "feedback-positive";
  if (type === "bad") return "feedback-negative";
  if (type === "spin-result") return "feedback-neutral";
  return "";
}
function pulseElement(el, className, duration = 650) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), duration);
}
function pulseId(id, className, duration) {
  pulseElement($(id), className, duration);
}
function pulseCurrentPlayer(className, duration) {
  pulseId(`playerCard${state.active}`, className, duration);
}
function canAcknowledgeTurn() {
  return state.screen==="game" && state.players.length && !state.finished && (!online.enabled || onlineCanAct());
}
function showTurnReadyModal() {
  if (!state.turnAwaitingAck || !canAcknowledgeTurn()) return;
  $("modal").className="modal turn-ready-modal";
  $("modal").innerHTML=`<div class="modal-icon">▶</div><h2>Es tu turno</h2><p><strong>${currentPlayer().name}</strong>, pulsa para empezar. El tiempo no corre hasta que aceptes.</p><button id="ackTurnBtn" class="modal-btn">EMPEZAR TURNO</button>`;
  $("modalBackdrop").classList.remove("hidden");
  sfx("turn");
  $("ackTurnBtn").addEventListener("click",()=>{
    $("modalBackdrop").classList.add("hidden");
    state.turnAwaitingAck=false;
    state.activity="";
    resetTurnTimer();
    setStatus(`Turno de ${currentPlayer().name}`);
    render();
    syncOnline("turn_ack");
  });
}
function requestTurnAck(message=`Turno de ${currentPlayer().name}`) {
  state.turnAwaitingAck=true;
  stopTurnTimer();
  setStatus(message,"spin-result");
  render();
  showTurnReadyModal();
}

function initializeGame(names, panels=selectProgressivePanels(), playerSlots=names.map((_,i)=>i), options={}) {
  state.players = names.map((name,i) => ({ name:name||`Jugador ${i+1}`, roundMoney:0, total:0, wildcard:false }));
  state.playerSlots = playerSlots;
  state.panels = panels; state.round=0; state.active=0; state.currentRotation=0; state.finished=false; state.results=[]; state.jackpot=300;
  state.jackpotClaimed=false; state.jackpotWinner=""; state.jackpotClaimedAmount=0; state.screen="game"; state.history=[]; state.activity="";
  state.shortRound=Boolean(options.shortRound);
  state.turnSeconds=state.shortRound ? SHORT_TURN_SECONDS : TURN_SECONDS;
  state.turnAwaitingAck=false;
  stopTurnTimer();
  $("wheel").style.transform="rotate(0deg)";
}
function startGame(e) {
  e.preventDefault();
  online.enabled=false; online.started=false;
  const names = localPlayerNames();
  initializeGame(names, selectProgressivePanels(), names.map((_,i)=>i), { shortRound:$("shortRoundToggle")?.checked });
  unlockAudio(); ensureAudio(); sfx("charge");
  showGameScreen();
  beginRound();
}
function startOnlineMatch() {
  if (!online.isHost) { setOnlineStatus("Solo el anfitrión puede empezar la partida.", "bad"); return; }
  const connected=online.players.map((p,i)=>p?.connected?{...p,slot:i}:null).filter(Boolean).slice(0, MAX_PLAYERS);
  const names=connected.map(p=>p.name);
  if (names.length<2) return;
  initializeGame(names, selectProgressivePanels(), connected.map(p=>p.slot), { shortRound:$("shortRoundToggle")?.checked });
  online.started=true; unlockAudio(); ensureAudio(); sfx("charge");
  showGameScreen();
  beginRound(); syncOnline("start");
}
function beginRound() {
  state.used = new Set(); state.choosing=false; state.pendingWedge=null; state.charging=false; state.spinning=false; state.charge=0;
  state.choiceMode=""; state.screen="game"; state.activity="";
  updatePowerMeter(0);
  state.players.forEach(p => p.roundMoney=0);
  buildWheel();
  hideChoices(); setStatus(`Turno de ${currentPlayer().name}`);
  addHistory(`Panel ${state.round+1}: empieza ${currentPlayer().name}`,"turn");
  requestTurnAck(`Empieza ${currentPlayer().name}.`);
}

function render() {
  const notMyTurn=!onlineCanAct();
  const actionLocked=state.spinning||state.charging||state.choosing||state.finished||notMyTurn||state.turnAwaitingAck;
  const canChooseConsonant=availableConsonants().length>0 && hiddenConsonants().length>0;
  const noConsonants=hiddenConsonants().length===0 || availableConsonants().length===0;
  const canBuyVowel=!actionLocked && currentPlayer().roundMoney>=50 && hiddenVowels().length>0;
  const canSolve=!actionLocked;
  const canPass=!actionLocked && noConsonants;
  const waitingSpin=!actionLocked && canChooseConsonant;
  $("gameScreen").classList.toggle("is-choosing",state.choosing);
  $("gameScreen").classList.toggle("is-choosing-letter",state.choiceMode==="consonant");
  $("gameScreen").classList.toggle("is-buying-vowel",state.choiceMode==="vowel");
  $("gameScreen").classList.toggle("is-solving",state.activity==="solving");
  $("gameScreen").classList.toggle("is-waiting-spin",waitingSpin);
  $("gameScreen").classList.toggle("is-no-consonants",noConsonants);
  $("gameScreen").classList.toggle("is-turn-awaiting",state.turnAwaitingAck);
  $("gameScreen").classList.toggle("is-charging-spin",state.charging);
  $("gameScreen").classList.toggle("is-spinning",state.spinning);
  $("gameScreen").classList.toggle("is-turn-ended",state.activity==="wedge" && (state.pendingWedge?.type==="bankrupt" || state.pendingWedge?.type==="lose"));
  $("gameScreen").classList.toggle("is-bankrupt",state.activity==="wedge" && state.pendingWedge?.type==="bankrupt");
  $("gameScreen").classList.toggle("is-lose-turn",state.activity==="wedge" && state.pendingWedge?.type==="lose");
  $("gameScreen").classList.toggle("comodin-earned",state.activity==="wedge" && ["wildcard","x2","half","jackpot"].includes(state.pendingWedge?.type));
  $("roomLabel").classList.toggle("hidden",!online.enabled);
  $("roomLabel").textContent=online.enabled?`SALA ${online.roomCode} · J${(online.playerIndex??0)+1}`:"";
  $("roundLabel").textContent=state.round===JACKPOT_ROUND?"Panel con bote 🎯":`Panel ${state.round+1}/${TOTAL_ROUNDS}`;
  $("category").textContent=currentPanel().categoria;
  $("difficulty").textContent=currentPanel().dificultad;
  $("clue").textContent=currentPanel().clue;
  $("jackpot").classList.remove("hidden"); $("jackpot").classList.toggle("compact",state.round!==JACKPOT_ROUND);
  $("jackpot").classList.toggle("claimed",state.jackpotClaimed);
  $("jackpot").textContent=state.jackpotClaimed
    ? `🏆 BOTE GANADO: ${money(state.jackpotClaimedAmount)} · ${state.jackpotWinner}`
    : `🎯 ${state.round===JACKPOT_ROUND?"BOTE":"BOTE FINAL"}: ${money(state.jackpot)}`;
  $("jackpotRule").textContent=state.jackpotClaimed
    ? "EL GAJO BOTE YA HA SIDO COBRADO"
    : state.round===JACKPOT_ROUND?"CAE EN EL GAJO BOTE PARA GANARLO":"+100 € POR PANEL · QUIEBRAS E INTENTOS FALLIDOS LO ALIMENTAN";
  for (let i=0;i<MAX_PLAYERS;i++) {
    const card=$("playerCard"+i), p=state.players[i];
    card.classList.toggle("hidden",!p);
    if (!p) continue;
    card.querySelector(".player-tag").textContent=`Jugador ${i+1}`;
    $("playerName"+i).textContent=p.name; $("roundMoney"+i).textContent=money(p.roundMoney); $("totalMoney"+i).textContent=money(p.total);
    card.classList.toggle("active",i===state.active);
    const wc=$("wildcard"+i); wc.textContent=p.wildcard?"◆ Comodín":"";
    wc.classList.toggle("owned",p.wildcard);
    wc.classList.toggle("hidden",!p.wildcard);
  }
  renderBoard(state.finished);
  renderUsedLetters();
  $("wheel").setAttribute("aria-disabled",String(actionLocked || !canChooseConsonant));
  document.querySelector(".wheel-zone").classList.toggle("disabled",actionLocked||!canChooseConsonant);
  $("spinHint").textContent=state.spinning?"Buscando gajo ganador":(state.charging?"Cargando giro":(state.turnAwaitingAck?"Confirma el turno para empezar":(notMyTurn?`Esperando a ${currentPlayer().name}`:(!canChooseConsonant?"No quedan consonantes: compra vocal, resuelve o pasa":"Mantén y suelta para girar"))));
  renderWheelResult();
  $("remoteBanner").classList.toggle("hidden",!(online.enabled && notMyTurn && !state.finished && state.activity!=="solving"));
  $("remoteBanner").textContent=activityText();
  $("vowelBtn").disabled=!canBuyVowel;
  $("solveBtn").disabled=!canSolve;
  $("passTurnBtn").disabled=!canPass;
  updateTimerDisplay();
  renderHistory();
}
function renderBoard(revealAll=false) {
  const board=$("board"); board.innerHTML="";
  const lettersOnly = currentPanel().answer.replace(/[^A-ZÑ0-9]/g, "").length;
  board.classList.toggle("long", lettersOnly > 22);
  board.classList.toggle("extra-long", lettersOnly > 32);
  board.classList.toggle("ultra-long", lettersOnly > 42);
  currentPanel().answer.split(" ").forEach(wordText => {
    const word=document.createElement("span"); word.className="word";
    [...wordText].forEach(char => {
      const cell=document.createElement("span"); cell.className="letter";
      const isLetter=LETTERS.includes(char);
      const isCovered=isLetter && !revealAll && !state.used.has(char);
      if (isCovered) cell.classList.add("covered");
      if (!isCovered && state.lastRevealed===char) cell.classList.add("revealed","letter-revealed");
      if (!isLetter) cell.classList.add("punctuation");
      cell.textContent=isCovered?"":char; word.appendChild(cell);
    }); board.appendChild(word);
  });
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}
function solvePanelPreview() {
  const panel=currentPanel();
  const words=panel.answer.split(" ").map(wordText => {
    const letters=[...wordText].map(char => {
      const isLetter=LETTERS.includes(char);
      const isCovered=isLetter && !state.used.has(char);
      const classes=["solve-preview-letter"];
      if (isCovered) classes.push("covered");
      if (!isLetter) classes.push("punctuation");
      return `<span class="${classes.join(" ")}">${isCovered ? "" : escapeHtml(char)}</span>`;
    }).join("");
    return `<span class="solve-preview-word">${letters}</span>`;
  }).join("");
  return `<div class="solve-context">
    <div class="solve-meta"><span>Categoría <strong>${escapeHtml(panel.categoria)}</strong></span><span>Dificultad <strong>${escapeHtml(panel.dificultad)}</strong></span></div>
    <div class="solve-clue">${escapeHtml(panel.clue)}</div>
    <div class="solve-preview-board" aria-label="Panel actual">${words}</div>
  </div>`;
}
function autoResizeSolveInput(input) {
  if (!input) return;
  input.style.height="auto";
  input.style.height=`${Math.min(input.scrollHeight,138)}px`;
}
function setSolveDraft(value) {
  state.solveDraft=String(value || "").toUpperCase();
}
function startVoiceDictation(input) {
  const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Dictado no disponible en este navegador.","bad");
    return;
  }
  try {
    state.speechRecognition?.stop?.();
    const recognition=new SpeechRecognition();
    state.speechRecognition=recognition;
    recognition.lang="es-ES";
    recognition.interimResults=true;
    recognition.continuous=false;
    recognition.onresult=event=>{
      const transcript=Array.from(event.results).map(result=>result[0]?.transcript||"").join(" ").trim();
      if (!transcript) return;
      input.value=transcript.toUpperCase();
      input.dispatchEvent(new Event("input", { bubbles:true }));
    };
    recognition.onerror=()=>setStatus("No he podido usar el dictado en este navegador.","bad");
    recognition.start();
  } catch (_) {
    setStatus("Dictado no disponible en este navegador.","bad");
  }
}
function setStatus(text,type="") {
  state.statusText=text; state.statusType=type;
  const el=$("status"); el.textContent=text; el.className=`status ${type} ${feedbackClass(type)} status-ping`.trim();
  setTimeout(() => el.classList.remove("status-ping"), 460);
}
function hideChoices() { state.choosing=false; state.choiceMode=""; state.activity=""; $("choicePanel").classList.add("hidden"); $("keyboard").innerHTML=""; }
function showChoices(letters,title,handler,kind="",options={}) {
  if (!letters.length) {
    state.choosing=false;
    state.choiceMode="";
    $("choicePanel").classList.add("hidden");
    $("keyboard").innerHTML="";
    setStatus("No quedan consonantes disponibles. Puedes comprar vocal, resolver o pasar.","spin-result");
    resetTurnTimer();
    render();
    if (options.sync!==false) syncOnline("no_letters");
    return;
  }
  state.choosing=true; state.choiceMode=kind||"consonant"; state.activity=kind==="vowel"?"buying_vowel":"choosing_letter"; $("choiceTitle").textContent=title; const keys=$("keyboard"); keys.innerHTML="";
  resetTurnTimer();
  letters.forEach(letter => {
    const b=document.createElement("button"); b.type="button"; b.className=`key ${kind}`; b.textContent=letter; b.dataset.letter=letter;
    let used=false;
    const choose=event=>{
      event.preventDefault();
      event.stopPropagation();
      if (used || b.disabled) return;
      used=true; b.disabled=true;
      handler(letter);
    };
    b.addEventListener("pointerup",choose,{ passive:false });
    b.addEventListener("touchend",choose,{ passive:false });
    b.addEventListener("click",choose);
    keys.appendChild(b);
  });
  $("choicePanel").classList.remove("hidden"); render();
  if (options.sync!==false) syncOnline(kind==="vowel"?"choose_vowel":"choose_consonant");
}

// Giro por carga: mantener pulsado aumenta la fuerza y soltar inicia la inercia.
function wheelLocked() {
  return state.spinning||state.charging||state.choosing||state.finished||state.turnAwaitingAck||!onlineCanAct()||availableConsonants().length===0||hiddenConsonants().length===0;
}
function updatePowerMeter(value) {
  const rounded=Math.round(value); $("forceFill").style.width=`${value}%`;
  document.querySelector(".power-label span:first-child").textContent=value?"Cargando fuerza":"Fuerza";
  $("forceFill").setAttribute("aria-valuenow",String(rounded)); $("powerValue").textContent=value?`Suelta para girar · ${rounded}%`:"Mantén pulsado";
}
function startCharge(event) {
  if (wheelLocked()) return;
  event.preventDefault(); stopTurnTimer(); state.activity="charging"; state.charging=true; state.charge=0; state.chargeStart=performance.now();
  $("wheel").classList.add("charging"); $("wheel").setPointerCapture?.(event.pointerId);
  sfx("charge"); setStatus("Cargando fuerza","spin-result"); render();
  syncOnline("charge");
  sendOnlineEvent("wheel_charge", { charge: 0 });
  let lastChargeSync = 0;
  function charge(now) {
    if (!state.charging) return;
    state.charge=Math.min(100,(now-state.chargeStart)/18); updatePowerMeter(state.charge);
    if (now-lastChargeSync>120) {
      lastChargeSync=now;
      sendOnlineEvent("wheel_charge", { charge: state.charge });
    }
    state.chargeFrame=requestAnimationFrame(charge);
  }
  state.chargeFrame=requestAnimationFrame(charge);
}
function endCharge(event) {
  if (!state.charging) return; state.charging=false; cancelAnimationFrame(state.chargeFrame); $("wheel").classList.remove("charging");
  try { $("wheel").releasePointerCapture?.(event.pointerId); } catch (_) {}
  if (state.charge<8) {
    state.charge=0; state.activity=""; updatePowerMeter(0); resetTurnTimer(); sfx("bad");
    setStatus("Giro demasiado flojo. Inténtalo con más fuerza.","bad");
    render(); syncOnline("weak_spin");
    return;
  }
  state.velocity=-(5+state.charge*.3); state.spinning=true; state.activity="spinning"; state.lastTick=-1; sfx("spin"); render();
  setStatus("Girando la ruleta");
  syncOnline("spin_start");
  sendOnlineEvent("wheel_spin_start", { rotation: state.currentRotation });
  let previous=performance.now();
  let lastSpinSync = 0;
  function inertia(now) {
    const frame=Math.min((now-previous)/16.67,2.5); previous=now;
    state.currentRotation+=state.velocity*frame; state.velocity*=Math.pow(.97,frame);
    $("wheel").style.transform=`rotate(${state.currentRotation}deg)`;
    if (now-lastSpinSync>45) {
      lastSpinSync=now;
      sendOnlineEvent("wheel_rotation", { rotation: state.currentRotation });
    }
    const tick=Math.floor(Math.abs(state.currentRotation)/15);
    if (tick!==state.lastTick) { state.lastTick=tick; sfx("tick"); }
    if (Math.abs(state.velocity)>=.1) requestAnimationFrame(inertia);
    else stopWheel();
  }
  requestAnimationFrame(inertia);
}
function cancelCharge(event) {
  if (!state.charging) return; state.charging=false; cancelAnimationFrame(state.chargeFrame); state.charge=0;
  $("wheel").classList.remove("charging"); updatePowerMeter(0);
  try { $("wheel").releasePointerCapture?.(event.pointerId); } catch (_) {}
  state.activity=""; resetTurnTimer();
  setStatus(`Turno de ${currentPlayer().name}`); render(); syncOnline("charge_cancel");
  sendOnlineEvent("wheel_charge_cancel");
}
function stopWheel() {
  state.spinning=false; state.velocity=0;
  const normalized=((state.currentRotation%360)+360)%360;
  const winner=Math.floor(normalized/(360/WEDGES.length))%WEDGES.length;
  sendOnlineEvent("wheel_spin_end", { rotation: state.currentRotation, winner });
  state.pendingWedge=state.activeWedges[winner]; state.activity="wedge"; highlightWedge(winner); resolveWedge(state.pendingWedge);
}
function resolveWedge(w) {
  addHistory(`${currentPlayer().name} cayó en ${w.label}${w.value?` (${money(w.value)})`:""}`,"spin");
  if (w.type==="jackpot") {
    state.jackpotClaimed=true; state.jackpotWinner=currentPlayer().name; state.jackpotClaimedAmount=state.jackpot;
    currentPlayer().total+=state.jackpot; resetTurnTimer(); sfx("win"); celebrate(100); buildWheel(); render();
    addHistory(`${currentPlayer().name} gana el bote: ${money(state.jackpotClaimedAmount)}`,"jackpot");
    pulseCurrentPlayer("comodin-earned");
    pulseId(`totalMoney${state.active}`,"money-bump");
    pulseId(`roundMoney${state.active}`,"money-bump");
    setStatus(`Ha salido BOTE. ${currentPlayer().name} gana ${money(state.jackpotClaimedAmount)} y mantiene el turno.`,"good"); syncOnline("jackpot"); return;
  }
  if (w.type==="bankrupt") {
    stopTurnTimer();
    const lost=currentPlayer().roundMoney; currentPlayer().roundMoney=0; if(!state.jackpotClaimed) state.jackpot+=lost;
    sfx("bankrupt"); render(); animateElement("board","shake"); if(lost) bumpJackpot();
    pulseCurrentPlayer("is-bankrupt");
    pulseId(`roundMoney${state.active}`,"money-lost");
    addHistory(`${currentPlayer().name} hace quiebra y pierde ${money(lost)}`,"bad");
    setStatus(`QUIEBRA: pierdes ${money(lost)}${lost?" y pasan al bote final":""}.`,"bad");
    offerWildcard("quiebra"); return;
  }
  if (w.type==="lose") { stopTurnTimer(); sfx("bad"); addHistory(`${currentPlayer().name} pierde turno`,"bad"); pulseCurrentPlayer("is-lose-turn"); setStatus(`Pierdes turno. Juega ${state.players[nextPlayerIndex()].name}.`,"bad"); offerWildcard("pierde turno"); return; }
  if (w.type==="wildcard" && !currentPlayer().wildcard) { currentPlayer().wildcard=true; addHistory(`${currentPlayer().name} consigue comodín`,"wildcard"); }
  if (["wildcard","x2","half"].includes(w.type)) pulseCurrentPlayer("comodin-earned");
  if (!hiddenConsonants().length || !availableConsonants().length) {
    resetTurnTimer();
    render();
    setStatus("No quedan consonantes disponibles. Puedes comprar vocal, resolver o pasar.","spin-result");
    syncOnline("no_consonants");
    return;
  }
  setStatus(`Ha salido ${wheelDisplayLabel(w)}. ${wheelActionLabel(w)}.`,"spin-result");
  showChoices(availableConsonants(),"Elige una consonante",chooseConsonant);
  if (w.type==="wildcard") pulseId(`wildcard${state.active}`,"comodin-earned");
}
function chooseConsonant(letter) {
  hideChoices(); state.used.add(letter); const count=occurrences(letter), w=state.pendingWedge, p=currentPlayer();
  if (count>0) {
    state.lastRevealed=letter; let detail="", boteDetail="", jackpotChanged=false, moneyChanged=false;
    if (w.type==="x2") {
      p.roundMoney*=2; detail=`Tu marcador se duplica: ${money(p.roundMoney)}.`; moneyChanged=true;
      if (state.round===JACKPOT_ROUND && !state.jackpotClaimed) { state.jackpot*=2; jackpotChanged=true; boteDetail=` Bote duplicado: ${money(state.jackpot)}.`; }
    } else if (w.type==="half") {
      p.roundMoney=Math.round(p.roundMoney/2); detail=`Tu marcador queda en ${money(p.roundMoney)}.`; moneyChanged=true;
      if (state.round===JACKPOT_ROUND && !state.jackpotClaimed) { state.jackpot=Math.round(state.jackpot/2); jackpotChanged=true; boteDetail=` Bote dividido: ${money(state.jackpot)}.`; }
    } else {
      const gain=w.value*count; p.roundMoney+=gain; detail=`+${money(w.value)} × ${count} = ${money(gain)}.`; moneyChanged=true;
      if (state.round===JACKPOT_ROUND && !state.jackpotClaimed && w.type==="money") { state.jackpot+=w.value; jackpotChanged=true; boteDetail=` +${money(w.value)} al bote.`; }
    }
    addHistory(`${p.name} eligió ${letter}: ${count} acierto${count>1?"s":""}`,"letter");
    resetTurnTimer(); sfx("good"); setStatus(`Correcto: ${letter} aparece ${count} ${count===1?"vez":"veces"}. ${detail}${boteDetail}`,"good"); render();
    if (moneyChanged) pulseId(`roundMoney${state.active}`,"money-bump");
    pulseCurrentPlayer("feedback-positive");
    if(jackpotChanged) bumpJackpot(); setTimeout(()=>state.lastRevealed=null,650); checkAutoSolved(); syncOnline("consonant");
  } else {
    addHistory(`${p.name} eligió ${letter}: no está`,"bad");
    stopTurnTimer(); sfx("bad"); setStatus(`No hay ${letter}. Turno para ${state.players[nextPlayerIndex()].name}.`,"bad"); render(); animateElement("board","miss-shake"); pulseCurrentPlayer("feedback-negative"); offerWildcard("consonante fallida");
  }
}

function buyVowel() {
  if (!onlineCanAct() || currentPlayer().roundMoney<50) return;
  setStatus("Elige una vocal","spin-result");
  showChoices(hiddenVowels(),"Elige una vocal",chooseVowel,"vowel");
}
function chooseVowel(letter) {
  hideChoices(); const p=currentPlayer(); p.roundMoney-=50; state.used.add(letter); const count=occurrences(letter);
  if (count>0) { state.lastRevealed=letter; addHistory(`${p.name} compró ${letter}: ${count} acierto${count>1?"s":""}`,"vowel"); resetTurnTimer(); sfx("good"); setStatus(`Correcto: ${letter} aparece ${count} ${count===1?"vez":"veces"}. La vocal ha costado 50 €.`,"good"); render(); pulseId(`roundMoney${state.active}`,"money-lost"); pulseCurrentPlayer("feedback-positive"); setTimeout(()=>state.lastRevealed=null,650); checkAutoSolved(); syncOnline("vowel"); }
  else { addHistory(`${p.name} compró ${letter}: no está`,"bad"); stopTurnTimer(); sfx("bad"); setStatus(`No hay ${letter}. Pierdes 50 € y juega ${state.players[nextPlayerIndex()].name}.`,"bad"); render(); pulseId(`roundMoney${state.active}`,"money-lost"); animateElement("board","miss-shake"); pulseCurrentPlayer("feedback-negative"); offerWildcard("vocal fallida"); }
}
function checkAutoSolved() {
  const remaining=LETTERS.some(l=>currentPanel().answer.includes(l)&&!state.used.has(l));
  if (!remaining) setTimeout(()=>finishRound(state.active),650);
}
function passTurn() {
  if (!onlineCanAct() || state.finished || state.turnAwaitingAck || hiddenConsonants().length>0) return;
  const passer=currentPlayer().name;
  stopTurnTimer();
  addHistory(`${passer} pasa turno sin consonantes disponibles`,"turn");
  switchTurn(`No quedan consonantes disponibles. ${passer} pasa turno.`);
}

function openSolve() {
  if (!onlineCanAct()) return;
  state.solveDraft="";
  state.choosing=true; state.activity="solving"; stopTurnTimer(); setStatus("Resolver panel. El tiempo está pausado.","spin-result"); render(); syncOnline("solving");
  $("modal").className="modal solve-modal";
  $("modal").innerHTML=`<div class="modal-icon">💡</div><h2>Resolver panel</h2>${solvePanelPreview()}<p>Escribe la solución completa. Las tildes no son necesarias.</p><form id="solveForm"><div class="solve-input-wrap"><textarea id="solutionInput" aria-label="Solución" autocomplete="off" autocapitalize="sentences" autocorrect="on" spellcheck="true" rows="2" placeholder="ESCRIBE AQUÍ..."></textarea><button id="dictateSolveBtn" class="dictate-btn" type="button" aria-label="Dictar respuesta" title="Dictar respuesta">🎙</button></div><div class="modal-actions"><button type="button" id="cancelSolve" class="modal-btn alt">CANCELAR</button><button class="modal-btn">COMPROBAR</button></div></form>`;
  $("modalBackdrop").classList.remove("hidden"); syncVisibleViewport(); setTimeout(()=>{ $("solutionInput").focus(); syncVisibleViewport(); },50);
  $("cancelSolve").addEventListener("click",closeModal);
  $("dictateSolveBtn").addEventListener("click",()=>startVoiceDictation($("solutionInput")));
  $("solveForm").addEventListener("submit",checkSolution);
  let lastSolveDraftSync = 0;
  let composing=false;
  const handleSolveInput=event=>{
    autoResizeSolveInput(event.target);
    if (composing) return;
    setSolveDraft(event.target.value);
    const now=performance.now();
    if (now-lastSolveDraftSync>90) {
      lastSolveDraftSync=now;
      sendOnlineEvent("solve_draft", { draft: state.solveDraft });
    }
  };
  $("solutionInput").addEventListener("compositionstart",()=>{ composing=true; });
  $("solutionInput").addEventListener("compositionend",event=>{ composing=false; handleSolveInput(event); });
  $("solutionInput").addEventListener("input",handleSolveInput);
  $("solutionInput").addEventListener("change",handleSolveInput);
  $("solutionInput").addEventListener("paste",()=>setTimeout(()=>handleSolveInput({ target:$("solutionInput") }),0));
  autoResizeSolveInput($("solutionInput"));
}
function closeModal(shouldSync=true) {
  const wasSolving = state.activity === "solving";
  state.speechRecognition?.stop?.();
  state.speechRecognition=null;
  $("modalBackdrop").classList.add("hidden");
  document.body.classList.remove("keyboard-visible");
  state.choosing=false; state.activity=""; state.solveDraft="";
  if (wasSolving) setStatus(`Turno de ${currentPlayer().name}`);
  resetTurnTimer(); render();
  if (wasSolving) sendOnlineEvent("solve_draft", { draft: "" });
  if (wasSolving && shouldSync) syncOnline("solve_cancel");
}
function checkSolution(e) {
  e.preventDefault(); const attempt=$("solutionInput").value;
  const cleanAttempt=attempt.trim();
  const spokenAttempt=cleanAttempt || "sin respuesta";
  const correct=normalize(attempt)===normalize(currentPanel().answer);
  if (correct) {
    closeModal(false);
    sendOnlineEvent("solve_result", { attempt: spokenAttempt, correct: true, answer: currentPanel().answer });
    addHistory(`${currentPlayer().name} resolvió: "${spokenAttempt}"`,"solve");
    stopTurnTimer(); renderBoard(true); pulseId("board","panel-complete"); setStatus(`Respuesta correcta: "${spokenAttempt}".`,"good"); setTimeout(()=>finishRound(state.active),600);
  }
  else {
    closeModal(false);
    sendOnlineEvent("solve_result", { attempt: spokenAttempt, correct: false });
    stopTurnTimer(); if(!state.jackpotClaimed) state.jackpot+=50; sfx("bad");
    const next=state.players[nextPlayerIndex()].name;
    addHistory(`${currentPlayer().name} respondió "${spokenAttempt}" y falló`,"bad");
    switchTurn(`No es correcto: "${spokenAttempt}".${state.jackpotClaimed?"":" +50 € al bote final."} Turno de ${next}.`); if(!state.jackpotClaimed) bumpJackpot();
  }
}

function openExitConfirm() {
  if (state.screen!=="game") return;
  stopTurnTimer();
  const detail=online.enabled
    ? "Abandonarás la sala y volverás a la pantalla inicial. Los demás jugadores verán que te has desconectado."
    : "La partida local actual se perderá y volverás a la pantalla inicial.";
  $("modal").className="modal";
  $("modal").innerHTML=`<div class="modal-icon">⚠️</div><h2>¿Salir de la partida?</h2><p>${detail}</p><div class="modal-actions"><button id="cancelExitGame" class="modal-btn alt" type="button">Cancelar</button><button id="confirmExitGame" class="modal-btn danger" type="button">Salir</button></div>`;
  $("modalBackdrop").classList.remove("hidden");
  $("cancelExitGame").addEventListener("click",()=>{ $("modalBackdrop").classList.add("hidden"); if (state.screen==="game" && !state.finished) resetTurnTimer(); });
  $("confirmExitGame").addEventListener("click",leaveCurrentGame);
}

function offerWildcard(reason) {
  if (!currentPlayer().wildcard) { setTimeout(switchTurn,700); return; }
  state.choosing=true; render();
  $("modal").className="modal";
  $("modal").innerHTML=`<div class="modal-icon">◆</div><h2>¿Usar comodín?</h2><p>Has sufrido ${reason}. Puedes gastar tu comodín para conservar el turno.</p><div class="modal-actions"><button id="declineWild" class="modal-btn alt">NO, PASAR TURNO</button><button id="useWild" class="modal-btn">USAR COMODÍN</button></div>`;
  $("modalBackdrop").classList.remove("hidden");
  $("useWild").addEventListener("click",()=>{ addHistory(`${currentPlayer().name} usa comodín y conserva turno`,"wildcard"); currentPlayer().wildcard=false; closeModal(); setStatus("Comodín usado. Conservas el turno.","good"); render(); syncOnline("wildcard"); });
  $("declineWild").addEventListener("click",()=>{ addHistory(`${currentPlayer().name} no usa comodín`,"turn"); closeModal(); switchTurn(); });
}
function switchTurn(message="") {
  hideChoices(); state.active=nextPlayerIndex(); state.pendingWedge=null; state.activity="";
  addHistory(`Turno de ${currentPlayer().name}`,"turn");
  state.turnAwaitingAck=true;
  stopTurnTimer();
  setStatus(message||`Turno de ${currentPlayer().name}`,message?"bad":"spin-result");
  render(); pulseCurrentPlayer("is-turn-changing"); showTurnReadyModal(); syncOnline("turn");
}

function finishRound(winnerIndex) {
  if (state.finished) return; state.finished=true;
  state.choiceMode=""; state.screen="game"; state.activity=""; stopTurnTimer();
  const last=state.round===TOTAL_ROUNDS-1;
  const winner=state.players[winnerIndex], panelMoney=winner.roundMoney, earned=panelMoney;
  winner.total+=earned; state.active=winnerIndex;
  state.results.push({ panel:state.round+1, winner:winner.name, panelMoney, earned, jackpotWinner:last?state.jackpotWinner:"", jackpotAmount:last?state.jackpotClaimedAmount:0 });
  if (!last) state.jackpot+=100;
  addHistory(`${winner.name} cierra el panel y suma ${money(earned)}`,"round");
  sfx("round"); celebrate(last?110:55);
  renderBoard(true); render(); pulseId("board","panel-complete"); pulseId(`totalMoney${winnerIndex}`,"money-bump"); pulseId(`playerCard${winnerIndex}`,"feedback-positive");
  syncOnline("round_finished");
  const boteLine=last?state.jackpotClaimed
    ? `<br>El bote de ${money(state.jackpotClaimedAmount)} ya lo ganó <strong>${state.jackpotWinner}</strong> al caer en su gajo.`
    : `<br>Nadie cayó en el gajo BOTE: queda desierto.`:"";
  const growthLine=!last?`<br>El bote final crece 100 € y alcanza <strong>${money(state.jackpot)}</strong>.`:"";
  $("modal").className="modal panel-complete-modal";
  $("modal").innerHTML=`<div class="modal-icon">${last?"🏁":"✨"}</div><h2>Panel resuelto</h2><p>La respuesta era: <strong>“${currentPanel().answer}”</strong><br><strong>${winner.name}</strong> gana <strong>${money(earned)}</strong>.${boteLine}${growthLine}<br><br>Marcador: ${scoreboardLine()}</p><button id="nextRound" class="modal-btn">${last?"VER RESULTADO":"SIGUIENTE PANEL →"}</button>`;
  $("modalBackdrop").classList.remove("hidden");
  $("nextRound").addEventListener("click",()=>{ $("modalBackdrop").classList.add("hidden"); if(last) showFinal(); else { state.round++; state.finished=false; beginRound(); syncOnline("next_round"); } });
}
function showFinal(shouldSync=true) {
  state.screen="final"; state.activity=""; stopTurnTimer();
  showFinalScreen();
  const topScore=Math.max(...state.players.map(p=>p.total)), winners=state.players.filter(p=>p.total===topScore), tie=winners.length>1, winner=winners[0];
  sfx("win"); celebrate(150);
  $("winnerName").textContent=tie?`¡EMPATE ENTRE ${winners.map(p=>p.name.toUpperCase()).join(" Y ")}!`:`¡GANA ${winner.name.toUpperCase()}!`;
  $("winnerScore").textContent=money(topScore);
  $("finalMessage").textContent=tie?"La suerte ha quedado perfectamente repartida.":state.jackpotClaimed?`${state.jackpotWinner} consiguió el bote al caer en su gajo.`:"El bote quedó desierto; nadie cayó en su gajo.";
  const ranking=[...state.players].sort((a,b)=>b.total-a.total);
  $("finalScores").innerHTML=ranking.map((p,i)=>`<div class="score-item ${i===0?"winner":""}"><span>${i+1}. ${p.name}</span><strong>${money(p.total)}</strong></div>`).join("");
  $("roundResults").innerHTML=state.results.map(r=>`<div class="round-result"><span>Panel ${r.panel}</span><strong>${r.winner}</strong><span>${money(r.earned)}</span></div>`).join("")
    +(state.jackpotClaimed?`<div class="round-result"><span>Bote 🎯</span><strong>${state.jackpotWinner}</strong><span>${money(state.jackpotClaimedAmount)}</span></div>`:`<div class="round-result"><span>Bote 🎯</span><strong>DESIERTO</strong><span>—</span></div>`);
  if (shouldSync) syncOnline("final");
}
function restart() {
  showStartScreen();
  $("modalBackdrop").classList.add("hidden");
}
function toggleLocalSetup() {
  $("localSetup").classList.toggle("hidden");
  const localVisible=!$("localSetup").classList.contains("hidden");
  $("startScreen").classList.toggle("is-local-mode",localVisible);
  if (localVisible) $("startScreen").classList.remove("is-manual-code-mode");
  $("showLocalBtn").textContent=localVisible?"Ocultar partida local":"Jugar en este dispositivo";
}
const {
  copyRoomCode, copyRoomLink, createRoom, initSharedRoom, joinRoom,
  leaveCurrentGame, leaveRoom, onlineCanAct, resumeOnlineConnection,
  resetInviteMode, setOnlineStatus, showInviteManualCodeMode, showManualCodeMode, syncOnline, sendOnlineEvent
} = createOnlineController({
  $, state, online, addHistory, buildWheel, chooseConsonant, chooseVowel,
  currentPlayer, hideChoices, render, renderHistory, resetTurnTimer, setStatus,
  showChoices, showFinal, showGameScreen, showStartScreen, stopTurnTimer,
  updatePowerMeter, updateTimerDisplay, ensureTimerLoop, showTurnReadyModal
});

bindVisibleViewport();
buildWheel();
initSharedRoom();
document.addEventListener("pointerdown",unlockAudio,{ passive:true });
document.addEventListener("touchstart",unlockAudio,{ passive:true });
$("startForm").addEventListener("submit",startGame);
$("showLocalBtn").addEventListener("click",toggleLocalSetup);
$("createRoomBtn").addEventListener("click",createRoom);
$("joinRoomBtn").addEventListener("click",joinRoom);
$("showCodeEntryBtn").addEventListener("click",showManualCodeMode);
$("backToHomeBtn").addEventListener("click",resetInviteMode);
$("changeCodeBtn").addEventListener("click",showInviteManualCodeMode);
$("resetInviteBtn").addEventListener("click",resetInviteMode);
$("leaveRoomBtn").addEventListener("click",leaveRoom);
$("onlineStartBtn").addEventListener("click",startOnlineMatch);
$("copyCodeBtn").addEventListener("click",copyRoomCode);
$("copyLinkBtn").addEventListener("click",copyRoomLink);
$("exitGameBtn").addEventListener("click",openExitConfirm);
$("roomCodeInput").addEventListener("input",event=>{ event.target.value=event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""); });
$("soundBtn").addEventListener("click",()=>toggleSound($));
$("wheel").addEventListener("pointerdown",startCharge);
$("wheel").addEventListener("pointerup",endCharge);
$("wheel").addEventListener("pointercancel",cancelCharge);
["selectstart","contextmenu","dragstart"].forEach(eventName=>{
  $("wheel").addEventListener(eventName,event=>event.preventDefault());
  document.querySelector(".wheel-zone").addEventListener(eventName,event=>event.preventDefault());
});
$("vowelBtn").addEventListener("click",buyVowel);
$("solveBtn").addEventListener("click",openSolve);
$("passTurnBtn").addEventListener("click",passTurn);
$("restartBtn").addEventListener("click",restart);
window.addEventListener("online",resumeOnlineConnection);
window.addEventListener("pageshow",resumeOnlineConnection);
document.addEventListener("visibilitychange",()=>{ if (!document.hidden) resumeOnlineConnection(); });
