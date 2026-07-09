"use strict";

import { CONSONANTS, JACKPOT_ROUND, LETTERS, MAX_PLAYERS, SHORT_TURN_SECONDS, TOTAL_ROUNDS, TURN_SECONDS, VOWELS, WEDGES } from "./config.js?v=mobile-ux-7";
import { $ } from "./dom.js";
import { ensureAudio, sfx, toggleSound, unlockAudio } from "./audio.js?v=mobile-ux-1";
import { createEffects } from "./effects.js?v=mobile-perf-1";
import { normalize, money } from "./format.js";
import { createHistory } from "./history.js";
import { selectProgressivePanels } from "./panels.js?v=board-resolve-4";
import { createOnlineController } from "./online.js?v=mobile-ux-9";
import { createWheel } from "./wheel.js?v=mobile-ux-7";

const state = {
  players: [], panels: [], round: 0, active: 0, used: new Set(),
  spinning: false, charging: false, choosing: false, currentRotation: 0,
  pendingWedge: null, finished: false, jackpot: 0, results: [],
  chargeStart: 0, charge: 0, chargeFrame: 0, velocity: 0, lastRevealed: null, lastTick: -1,
  activeWedges: [], jackpotClaimed: false, jackpotWinner: "", jackpotClaimedAmount: 0,
  jackpotCandidateIndex: -1, jackpotCandidateName: "",
  choiceMode: "", statusText: "Todo listo. ¡Gira la ruleta!", statusType: "", screen: "start",
  playerSlots: [], history: [],
  timerDeadline: 0, timerRemaining: TURN_SECONDS, timerFrame: 0, activity: "",
  solveDraft: "", turnAwaitingAck: false, turnSeconds: TURN_SECONDS, shortRound: false,
  turnId: 0, turnAcceptedAt: 0, turnAcceptedBy: -1, turnPhase: "idle",
  lastWarningSecond: 0, speechRecognition: null, speechState: "idle", solveSubmitting: false,
  lastEvent: null, resultDelayTimer: 0
};
const { animateElement, bumpJackpot, celebrate } = createEffects($);
const { addHistory, renderHistory } = createHistory($, state);
const { buildWheel, highlightWedge } = createWheel($, state);
let lastNotifiedTurnKey = "";
let activeTurnModalKey = "";
let pendingTurnNotification = false;

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
function clearJackpotCandidate() {
  state.jackpotCandidateIndex=-1;
  state.jackpotCandidateName="";
}
function currentTurnKey() {
  return `${state.round}:${state.turnId || 0}:${state.active}:${state.playerSlots[state.active] ?? state.active}`;
}
function canUseTurnAction() {
  return state.screen==="game" && state.players.length && !state.finished && onlineCanAct() && !state.turnAwaitingAck && state.turnPhase!=="showing_result";
}
function blockedTurnMessage() {
  if (!onlineCanAct()) return "Espera tu turno.";
  if (state.turnAwaitingAck) return "Pulsa Empezar turno para jugar.";
  if (state.turnPhase==="showing_result") return "Espera al resultado.";
  return "";
}
function rejectBlockedTurnAction() {
  const message=blockedTurnMessage();
  if (message) setStatus(message,"spin-result");
  return false;
}
function playTurnNotification() {
  try {
    const ctx=ensureAudio();
    if (ctx?.state === "running") sfx("turn");
    else pendingTurnNotification=true;
  } catch (error) {
    pendingTurnNotification=true;
    console.warn("Turn sound blocked by browser", error);
  }
  try { navigator.vibrate?.([80, 40, 80]); } catch (_) {}
}
function flushPendingTurnNotification() {
  if (!pendingTurnNotification) return;
  pendingTurnNotification=false;
  try {
    unlockAudio();
    sfx("turn");
  } catch (error) {
    pendingTurnNotification=true;
    console.warn("Turn sound blocked by browser", error);
  }
}
function notifyTurnIfNeeded() {
  const key=currentTurnKey();
  if (lastNotifiedTurnKey === key) return;
  lastNotifiedTurnKey=key;
  playTurnNotification();
}
function timerShouldRun() {
  return state.screen==="game" && state.players.length && !state.finished && !state.spinning && !state.charging && state.activity!=="solving" && state.turnPhase!=="showing_result" && !state.turnAwaitingAck && state.timerDeadline>0;
}
function updateTimerDisplay() {
  const timer=$("turnTimer"), fill=$("timerFill"), value=$("timerValue"), label=$("timerLabel");
  if (!timer || !fill || !value || !label) return;
  if (!state.players.length || state.screen!=="game" || state.finished) {
    timer.classList.add("paused"); fill.style.width="0%"; value.textContent="—"; label.textContent="TIEMPO"; return;
  }
  const remaining=state.timerDeadline ? Math.max(0,Math.ceil((state.timerDeadline-Date.now())/1000)) : state.timerRemaining;
  state.timerRemaining=remaining;
  const percent=Math.max(0,Math.min(100,(remaining/state.turnSeconds)*100));
  fill.style.width=`${percent}%`;
  value.textContent=`${remaining}s`;
  label.textContent=getTurnStatusUI().timerLabel;
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
function setNarrator(message="", severity="neutral", type="event") {
  state.lastEvent=message ? { message, severity, type, timestamp: Date.now() } : null;
  renderNarrator();
}
function renderNarrator() {
  const el=$("eventBanner");
  if (!el) return;
  const event=state.lastEvent;
  const hidden=!event?.message;
  el.classList.toggle("hidden",hidden);
  el.textContent=hidden ? "" : event.message;
  el.className=`event-banner ${event?.severity || "neutral"} ${hidden ? "hidden" : ""}`.trim();
}
function clearResultDelay() {
  if (state.resultDelayTimer) clearTimeout(state.resultDelayTimer);
  state.resultDelayTimer=0;
}
function delaySwitchTurn(message="", type="bad", delay=2800) {
  clearResultDelay();
  stopTurnTimer();
  state.turnPhase="showing_result";
  state.activity="showing_result";
  state.choosing=false;
  setStatus(message,type);
  setNarrator(message,type==="good"?"success":type==="bad"?"danger":"warning","turn_result");
  render();
  syncOnline("show_result");
  state.resultDelayTimer=setTimeout(()=>{
    state.resultDelayTimer=0;
    switchTurn(message);
  },delay);
}
function handleTurnTimeout() {
  if (state.finished || state.spinning || state.charging || !onlineCanAct()) return;
  stopTurnTimer();
  hideChoices();
  $("modalBackdrop").classList.add("hidden");
  state.choosing=false; state.activity="";
  addHistory(`${currentPlayer().name} agotó el tiempo`,"bad");
  sfx("bad");
  delaySwitchTurn("Tiempo agotado.","bad",2800);
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
function preventPageGesture(event) {
  if (document.body.classList.contains("playing")) event.preventDefault();
}
function bindMobileViewportGuards() {
  ["gesturestart","gesturechange","gestureend"].forEach(eventName=>{
    document.addEventListener(eventName,preventPageGesture,{ passive:false });
  });
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
  if (wedge.type === "half") return "MITAD";
  return wedge.label;
}
function wheelActionLabel(wedge) {
  if (!wedge) return "";
  if (wedge.type === "bankrupt") return "Pierdes el dinero del panel";
  if (wedge.type === "lose") return "Pierdes turno";
  if (wedge.type === "wildcard") return "Has ganado un comodín";
  if (wedge.type === "x2") return "X2 activado";
  if (wedge.type === "half") return "Pierdes la mitad de la ronda";
  if (wedge.type === "jackpot") return "Resuelve para cobrarlo";
  return "Elige una consonante";
}
function statusIsTurnOnly(text=state.statusText) {
  return /^(turno de|empieza|turno recuperado)/i.test(String(text || "").trim());
}
function statusFeedbackText() {
  const text=String(state.statusText || "").trim();
  if (!text || statusIsTurnOnly(text)) return "";
  if (state.choosing || ["choosing_letter","buying_vowel"].includes(state.activity)) return "";
  return text;
}
function getWheelActionChip(options={}) {
  return { text:"", type:"" };
}
function getTurnStatusUI(options={}) {
  const player=currentPlayer();
  const playerName=player?.name || "Jugador";
  const notMyTurn=state.players.length ? !onlineCanAct() : false;
  const canChooseConsonant=options.canChooseConsonant ?? (availableConsonants().length>0 && hiddenConsonants().length>0);
  const feedback=state.lastEvent?.message ? "" : statusFeedbackText();
  const turnText=`Turno de ${playerName}`;
  const wheelChip=getWheelActionChip(options);
  const ui={
    primaryText: feedback || turnText,
    primaryType: feedback ? state.statusType : "",
    secondaryText: "",
    wheelButtonText: wheelChip.text,
    wheelType: wheelChip.type,
    spinHintText: "",
    timerLabel: "Tiempo",
    hasFeedback: Boolean(feedback)
  };

  if (!state.players.length) return ui;
  if (state.finished) {
    ui.primaryText=feedback || "Panel terminado";
    return ui;
  }
  if (state.turnAwaitingAck) {
    ui.primaryText=notMyTurn ? turnText : (feedback || turnText);
    ui.primaryType=notMyTurn ? "" : ui.primaryType;
    ui.timerLabel=notMyTurn ? "Tiempo" : "Listo";
    return ui;
  }
  if (state.choosing || state.activity==="choosing_letter" || state.activity==="buying_vowel") {
    ui.primaryText=state.choiceMode==="vowel" || state.activity==="buying_vowel" ? "Elige una letra" : "Di una consonante";
    ui.primaryType="spin-result";
    return ui;
  }
  if (state.activity==="solving") {
    ui.primaryText=feedback || (notMyTurn ? `${playerName} está intentando resolver` : "Resolver panel");
    ui.timerLabel="Pausa";
    return ui;
  }
  if (state.spinning || state.activity==="spinning") {
    ui.primaryText=feedback || (notMyTurn ? `${playerName} está girando la ruleta` : "Girando la ruleta");
    return ui;
  }
  if (state.charging || state.activity==="charging") {
    ui.primaryText=feedback || (notMyTurn ? `${playerName} está cargando la ruleta` : "Cargando fuerza");
    return ui;
  }
  if (notMyTurn) {
    ui.primaryText=turnText;
    ui.primaryType="";
    ui.secondaryText=waitingText;
    return ui;
  }
  if (state.pendingWedge) {
    ui.secondaryText="";
    return ui;
  }
  ui.secondaryText="";
  return ui;
}
function renderTurnStatus(ui=getTurnStatusUI()) {
  const status=$("status");
  if (status) {
    const type=ui.primaryType || "";
    const narratorVisible=Boolean(state.lastEvent?.message);
    const redundantTurn=statusIsTurnOnly(ui.primaryText);
    status.textContent=ui.primaryText;
    status.className=`status ${type} ${feedbackClass(type)}`.trim();
    status.classList.toggle("hidden",narratorVisible || redundantTurn);
  }
  const secondary=$("remoteBanner");
  if (secondary) {
    secondary.classList.toggle("hidden",!ui.secondaryText);
    secondary.textContent=ui.secondaryText;
  }
}
function renderWheelResult(ui=getTurnStatusUI()) {
  const el = $("wheelResult");
  if (!el || !state.players.length) return;
  el.textContent = ui.wheelButtonText;
  el.className = `wheel-result ${ui.wheelType}`.trim();
  el.classList.toggle("hidden",!ui.wheelButtonText);
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
  const key=currentTurnKey();
  if (activeTurnModalKey === key && !$("modalBackdrop").classList.contains("hidden")) return;
  activeTurnModalKey=key;
  $("modal").className="modal turn-ready-modal";
  $("modal").innerHTML=`<div class="modal-icon">▶</div><h2>Es tu turno</h2><p><strong>${currentPlayer().name}</strong>, pulsa para empezar. El tiempo no corre hasta que aceptes.</p><button id="ackTurnBtn" class="modal-btn">EMPEZAR TURNO</button>`;
  $("modalBackdrop").classList.remove("hidden");
  notifyTurnIfNeeded();
  $("ackTurnBtn").addEventListener("click",()=>{
    unlockAudio();
    $("modalBackdrop").classList.add("hidden");
    activeTurnModalKey="";
    state.turnAwaitingAck=false;
    state.turnAcceptedAt=Date.now();
    state.turnAcceptedBy=state.active;
    state.turnPhase="active";
    state.activity="";
    resetTurnTimer();
    setStatus(`Turno de ${currentPlayer().name}`);
    render();
    syncOnline("turn_ack");
  });
}
function requestTurnAck(message=`Turno de ${currentPlayer().name}`, type="spin-result") {
  state.turnId=(state.turnId || 0) + 1;
  state.turnAwaitingAck=true;
  state.turnAcceptedAt=0;
  state.turnAcceptedBy=-1;
  state.turnPhase="waiting_ack";
  activeTurnModalKey="";
  stopTurnTimer();
  setStatus(message,type);
  render();
  showTurnReadyModal();
}

function initializeGame(names, panels=selectProgressivePanels(), playerSlots=names.map((_,i)=>i), options={}) {
  state.players = names.map((name,i) => ({ name:name||`Jugador ${i+1}`, roundMoney:0, total:0, wildcard:false }));
  state.playerSlots = playerSlots;
  state.panels = panels; state.round=0; state.active=0; state.currentRotation=0; state.finished=false; state.results=[]; state.jackpot=300;
  state.jackpotClaimed=false; state.jackpotWinner=""; state.jackpotClaimedAmount=0; clearJackpotCandidate(); state.screen="game"; state.history=[]; state.activity="";
  state.shortRound=Boolean(options.shortRound);
  state.turnSeconds=state.shortRound ? SHORT_TURN_SECONDS : TURN_SECONDS;
  state.turnAwaitingAck=false; state.turnId=0; state.turnAcceptedAt=0; state.turnAcceptedBy=-1; state.turnPhase="idle";
  state.lastEvent=null; clearResultDelay();
  lastNotifiedTurnKey=""; activeTurnModalKey=""; pendingTurnNotification=false;
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
  clearJackpotCandidate();
  updatePowerMeter(0);
  state.players.forEach(p => p.roundMoney=0);
  buildWheel();
  hideChoices(); setStatus(`Turno de ${currentPlayer().name}`);
  addHistory(`Panel ${state.round+1}: empieza ${currentPlayer().name}`,"turn");
  requestTurnAck(`Empieza ${currentPlayer().name}.`);
}

function render() {
  const notMyTurn=!onlineCanAct();
  const actionLocked=state.spinning||state.charging||state.choosing||state.finished||notMyTurn||state.turnAwaitingAck||state.turnPhase==="showing_result";
  const canChooseConsonant=availableConsonants().length>0 && hiddenConsonants().length>0;
  const noConsonants=hiddenConsonants().length===0 || availableConsonants().length===0;
  const turnStatusUI=getTurnStatusUI({ canChooseConsonant });
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
  $("gameScreen").classList.toggle("is-showing-result",state.turnPhase==="showing_result");
  $("gameScreen").classList.toggle("is-charging-spin",state.charging);
  $("gameScreen").classList.toggle("is-spinning",state.spinning);
  $("gameScreen").classList.toggle("is-turn-ended",state.activity==="wedge" && (state.pendingWedge?.type==="bankrupt" || state.pendingWedge?.type==="lose"));
  $("gameScreen").classList.toggle("is-bankrupt",state.activity==="wedge" && state.pendingWedge?.type==="bankrupt");
  $("gameScreen").classList.toggle("is-lose-turn",state.activity==="wedge" && state.pendingWedge?.type==="lose");
  $("gameScreen").classList.toggle("comodin-earned",state.activity==="wedge" && ["wildcard","x2","jackpot"].includes(state.pendingWedge?.type));
  $("roomLabel").classList.toggle("hidden",!online.enabled);
  $("roomLabel").textContent=online.enabled?`SALA ${online.roomCode} · J${(online.playerIndex??0)+1}`:"";
  $("roundLabel").textContent=state.round===JACKPOT_ROUND?"Panel con bote 🎯":`Panel ${state.round+1}/${TOTAL_ROUNDS}`;
  $("category").textContent=currentPanel().categoria;
  $("difficulty").textContent=currentPanel().dificultad;
  $("clue").textContent=currentPanel().clue;
  const showJackpot=state.round===JACKPOT_ROUND || state.jackpotClaimed || state.jackpotCandidateIndex>=0;
  $("jackpot").classList.toggle("hidden",!showJackpot);
  $("jackpotRule").classList.toggle("hidden",!showJackpot);
  $("jackpot").classList.toggle("compact",false);
  $("jackpot").classList.toggle("claimed",state.jackpotClaimed);
  if (showJackpot) {
    $("jackpot").textContent=state.jackpotClaimed
      ? `🏆 BOTE GANADO: ${money(state.jackpotClaimedAmount)} · ${state.jackpotWinner}`
      : state.jackpotCandidateIndex>=0
        ? `🎯 BOTE ACTIVADO: ${money(state.jackpot)} · ${state.jackpotCandidateName}`
        : `🎯 BOTE: ${money(state.jackpot)}`;
    $("jackpotRule").textContent=state.jackpotClaimed
      ? "EL BOTE YA HA SIDO COBRADO"
      : state.jackpotCandidateIndex>=0
        ? "RESUELVE EL PANEL PARA COBRARLO"
        : "CAE EN BOTE Y RESUELVE PARA COBRARLO";
  }
  for (let i=0;i<MAX_PLAYERS;i++) {
    const card=$("playerCard"+i), p=state.players[i];
    card.classList.toggle("hidden",!p);
    if (!p) continue;
    card.querySelector(".player-tag").textContent=i===state.active ? "Turno" : `J${i+1}`;
    $("playerName"+i).textContent=p.name; $("roundMoney"+i).textContent=money(p.roundMoney); $("totalMoney"+i).textContent=money(p.total);
    card.classList.toggle("active",i===state.active);
    card.classList.toggle("has-wildcard",Boolean(p.wildcard));
    const wc=$("wildcard"+i); wc.textContent="Comodín";
    wc.classList.toggle("owned",p.wildcard);
    wc.classList.toggle("hidden",!p.wildcard);
  }
  renderBoard(state.finished);
  renderUsedLetters();
  $("wheel").setAttribute("aria-disabled",String(actionLocked || !canChooseConsonant));
  const wheelVisuallyDisabled=(actionLocked||!canChooseConsonant) && !state.charging && !state.spinning;
  document.querySelector(".wheel-zone").classList.toggle("disabled",wheelVisuallyDisabled);
  $("spinHint").textContent="";
  $("spinHint").classList.add("hidden");
  renderTurnStatus(turnStatusUI);
  renderNarrator();
  renderWheelResult(turnStatusUI);
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
function setDictateButtonState(stateName) {
  const button=$("dictateSolveBtn");
  if (!button) return;
  button.classList.toggle("is-starting",stateName==="starting");
  button.classList.toggle("is-listening",stateName==="listening");
  button.classList.toggle("is-stopping",stateName==="stopping");
  button.textContent=stateName==="idle" ? "🎙" : "■";
  button.setAttribute("aria-pressed",String(stateName==="starting" || stateName==="listening"));
  button.title=stateName==="idle" ? "Dictar respuesta" : "Detener dictado";
}
function setSpeechState(nextState) {
  state.speechState=nextState;
  setDictateButtonState(nextState);
}
function cleanupSpeechRecognition() {
  if (!state.speechRecognition) return;
  state.speechRecognition.onstart=null;
  state.speechRecognition.onresult=null;
  state.speechRecognition.onerror=null;
  state.speechRecognition.onend=null;
  state.speechRecognition=null;
}
function stopVoiceDictation(mode="stop") {
  const recognition=state.speechRecognition;
  if (!recognition || state.speechState==="idle" || state.speechState==="stopping") return;
  setSpeechState("stopping");
  try {
    if (mode==="abort") recognition.abort();
    else recognition.stop();
  } catch (_) {
    cleanupSpeechRecognition();
    setSpeechState("idle");
  }
}
function startVoiceDictation(input) {
  const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setStatus("Dictado no disponible en este navegador.","bad");
    return;
  }
  if (state.speechState==="starting") { stopVoiceDictation("abort"); return; }
  if (state.speechState==="listening") { stopVoiceDictation("stop"); return; }
  if (state.speechState==="stopping") return;
  try {
    cleanupSpeechRecognition();
    const recognition=new SpeechRecognition();
    state.speechRecognition=recognition;
    recognition.lang="es-ES";
    recognition.interimResults=true;
    recognition.continuous=false;
    recognition.onstart=()=>setSpeechState("listening");
    recognition.onresult=event=>{
      const transcript=Array.from(event.results).map(result=>result[0]?.transcript||"").join(" ").trim();
      if (!transcript) return;
      input.value=transcript.toUpperCase();
      input.dispatchEvent(new Event("input", { bubbles:true }));
    };
    recognition.onerror=event=>{
      if (event.error !== "aborted") setStatus("No he podido usar el dictado en este navegador.","bad");
    };
    recognition.onend=()=>{
      cleanupSpeechRecognition();
      setSpeechState("idle");
    };
    setSpeechState("starting");
    recognition.start();
  } catch (error) {
    cleanupSpeechRecognition();
    setSpeechState("idle");
    setStatus("Dictado no disponible en este navegador.","bad");
  }
}
function setStatus(text,type="") {
  state.statusText=text; state.statusType=type;
  if (!online.applyingRemote && state.screen==="game" && state.players.length && text && type && !statusIsTurnOnly(text)) {
    setNarrator(text,type==="good"?"success":type==="bad"?"danger":"neutral","status");
  }
  const el=$("status");
  if (state.screen==="game" && state.players.length) renderTurnStatus();
  else {
    el.textContent=text;
    el.className=`status ${type} ${feedbackClass(type)}`.trim();
    el.classList.toggle("hidden",statusIsTurnOnly(text));
  }
  if (!el.classList.contains("hidden")) {
    el.classList.add("status-ping");
    setTimeout(() => el.classList.remove("status-ping"), 460);
  }
}
function hideChoices() { state.choosing=false; state.choiceMode=""; state.activity=""; $("choicePanel").classList.add("hidden"); $("keyboard").innerHTML=""; }
function showChoices(letters,title,handler,kind="",options={}) {
  if (!canUseTurnAction()) {
    rejectBlockedTurnAction();
    return;
  }
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
      if (!canUseTurnAction()) { rejectBlockedTurnAction(); return; }
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
  return state.spinning||state.charging||state.choosing||!canUseTurnAction()||availableConsonants().length===0||hiddenConsonants().length===0;
}
function updatePowerMeter(value) {
  const rounded=Math.round(value); $("forceFill").style.width=`${value}%`;
  document.querySelector(".power-label span:first-child").textContent=value?"Cargando fuerza":"Fuerza";
  $("forceFill").setAttribute("aria-valuenow",String(rounded)); $("powerValue").textContent=value?`Suelta para girar · ${rounded}%`:"Mantén pulsado";
}
function startCharge(event) {
  if (wheelLocked()) { rejectBlockedTurnAction(); return; }
  event.preventDefault(); stopTurnTimer(); state.activity="charging"; state.turnPhase="charging"; state.charging=true; state.charge=0; state.chargeStart=performance.now();
  $("wheel").classList.add("charging"); $("wheel").setPointerCapture?.(event.pointerId);
  sfx("charge"); setStatus("Cargando fuerza","spin-result"); render();
  syncOnline("charge");
  sendOnlineEvent("wheel_charge", { charge: 0 });
  let lastChargeSync = 0;
  let lastChargePaint = 0;
  function charge(now) {
    if (!state.charging) return;
    state.charge=Math.min(100,(now-state.chargeStart)/18);
    if (now-lastChargePaint>33 || state.charge>=100) {
      lastChargePaint=now;
      updatePowerMeter(state.charge);
    }
    if (now-lastChargeSync>120) {
      lastChargeSync=now;
      sendOnlineEvent("wheel_charge", { charge: state.charge });
    }
    state.chargeFrame=requestAnimationFrame(charge);
  }
  state.chargeFrame=requestAnimationFrame(charge);
}
function endCharge(event) {
  if (!canUseTurnAction()) { if (state.charging) cancelCharge(event); else rejectBlockedTurnAction(); return; }
  if (!state.charging) return; state.charging=false; cancelAnimationFrame(state.chargeFrame); $("wheel").classList.remove("charging");
  try { $("wheel").releasePointerCapture?.(event.pointerId); } catch (_) {}
  if (state.charge<8) {
    state.charge=0; state.activity=""; state.turnPhase="active"; updatePowerMeter(0); resetTurnTimer(); sfx("bad");
    setStatus("Giro demasiado flojo. Inténtalo con más fuerza.","bad");
    render(); syncOnline("weak_spin");
    return;
  }
  state.velocity=-(5+state.charge*.3); state.spinning=true; state.activity="spinning"; state.turnPhase="spinning"; state.lastTick=-1; sfx("spin"); render();
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
  state.activity=""; state.turnPhase="active"; resetTurnTimer();
  setStatus(`Turno de ${currentPlayer().name}`); render(); syncOnline("charge_cancel");
  sendOnlineEvent("wheel_charge_cancel");
}
function stopWheel() {
  state.spinning=false; state.velocity=0;
  const normalized=((state.currentRotation%360)+360)%360;
  const winner=Math.floor(normalized/(360/WEDGES.length))%WEDGES.length;
  sendOnlineEvent("wheel_spin_end", { rotation: state.currentRotation, winner });
  state.pendingWedge=state.activeWedges[winner]; state.activity="wedge"; state.turnPhase="wedge"; highlightWedge(winner); resolveWedge(state.pendingWedge);
}
function resolveWedge(w) {
  addHistory(`${currentPlayer().name} cayó en ${w.label}${w.value?` (${money(w.value)})`:""}`,"spin");
  if (w.type==="jackpot") {
    state.jackpotCandidateIndex=state.active;
    state.jackpotCandidateName=currentPlayer().name;
    sfx("win"); celebrate(70); render(); bumpJackpot();
    addHistory(`${currentPlayer().name} activa el bote: debe resolver el panel`,"jackpot");
    pulseCurrentPlayer("comodin-earned");
    setStatus("BOTE: resuelve el panel para llevártelo.","good");
    setNarrator(`${currentPlayer().name} activa el bote. Debe resolver el panel para cobrar ${money(state.jackpot)}.`,"success","jackpot_candidate");
    if (!hiddenConsonants().length || !availableConsonants().length) {
      resetTurnTimer();
      syncOnline("jackpot_candidate");
      return;
    }
    showChoices(availableConsonants(),"Elige una consonante",chooseConsonant);
    syncOnline("jackpot_candidate");
    return;
  }
  if (w.type==="bankrupt") {
    stopTurnTimer();
    const lost=currentPlayer().roundMoney; currentPlayer().roundMoney=0;
    sfx("bankrupt"); render(); animateElement("board","shake");
    pulseCurrentPlayer("is-bankrupt");
    pulseId(`roundMoney${state.active}`,"money-lost");
    addHistory(`${currentPlayer().name} hace quiebra y pierde ${money(lost)}`,"bad");
    offerWildcard({ type:"bankrupt", reason:"quiebra", lost, message:`Quiebra: ${currentPlayer().name} pierde ${money(lost)}.` }); return;
  }
  if (w.type==="lose") {
    stopTurnTimer(); sfx("bad"); addHistory(`${currentPlayer().name} pierde turno`,"bad"); pulseCurrentPlayer("is-lose-turn");
    offerWildcard({ type:"lose", reason:"pierde turno", message:`${currentPlayer().name} pierde el turno.` }); return;
  }
  if (w.type==="wildcard" && !currentPlayer().wildcard) { currentPlayer().wildcard=true; addHistory(`${currentPlayer().name} consigue comodín`,"wildcard"); setNarrator(`${currentPlayer().name} ha ganado un comodín.`,"success","wildcard_gained"); }
  if (["wildcard","x2"].includes(w.type)) pulseCurrentPlayer("comodin-earned");
  if (!hiddenConsonants().length || !availableConsonants().length) {
    resetTurnTimer();
    render();
    setStatus("No quedan consonantes disponibles. Puedes comprar vocal, resolver o pasar.","spin-result");
    syncOnline("no_consonants");
    return;
  }
  setStatus(`Ha salido ${wheelDisplayLabel(w)}. ${wheelActionLabel(w)}.`,"spin-result");
  setNarrator(`${currentPlayer().name} ha caído en ${wheelDisplayLabel(w)}.`,"neutral","wheel_result");
  showChoices(availableConsonants(),"Elige una consonante",chooseConsonant);
  if (w.type==="wildcard") pulseId(`wildcard${state.active}`,"comodin-earned");
}
function chooseConsonant(letter) {
  if (!canUseTurnAction() || state.choiceMode!=="consonant") { rejectBlockedTurnAction(); return; }
  hideChoices(); state.used.add(letter); const count=occurrences(letter), w=state.pendingWedge, p=currentPlayer();
  setNarrator(`${p.name} dice ${letter}.`,"neutral","letter_called");
  if (count>0) {
    state.lastRevealed=letter; let detail="", moneyChanged=false;
    if (w.type==="x2") {
      const before=p.roundMoney; p.roundMoney*=2; detail=before ? `X2: ${p.name} duplica su dinero: ${money(before)} → ${money(p.roundMoney)}.` : `X2: ${p.name} no tenía dinero que duplicar.`; moneyChanged=true;
    } else if (w.type==="half") {
      const before=p.roundMoney; p.roundMoney=Math.floor(p.roundMoney/2); detail=before ? `Mitad: ${p.name} pasa de ${money(before)} a ${money(p.roundMoney)}.` : `Mitad: ${p.name} no tenía dinero que reducir.`; moneyChanged=before>0;
    } else if (w.type==="jackpot") {
      detail=`BOTE activado: ${p.name} debe resolver el panel para cobrar ${money(state.jackpot)}.`;
    } else {
      const gain=w.value*count; p.roundMoney+=gain; detail=`+${money(w.value)} × ${count} = ${money(gain)}.`; moneyChanged=true;
    }
    addHistory(`${p.name} eligió ${letter}: ${count} acierto${count>1?"s":""}`,"letter");
    const statusMessage=`Correcto: ${letter} aparece ${count} ${count===1?"vez":"veces"}. ${detail}`;
    const narratorMessage=w.type==="x2" || w.type==="half" || w.type==="jackpot" ? detail : `${letter} aparece ${count} ${count===1?"vez":"veces"}. ${detail}`;
    resetTurnTimer(); sfx("good"); setStatus(statusMessage,"good"); setNarrator(narratorMessage,"success","letter_correct"); render();
    sendOnlineEvent("letter_result", { letter, count, statusMessage, narratorMessage, severity:"success" });
    if (moneyChanged) pulseId(`roundMoney${state.active}`,"money-bump");
    pulseCurrentPlayer("feedback-positive");
    setTimeout(()=>state.lastRevealed=null,650); checkAutoSolved(); syncOnline("consonant");
  } else {
    addHistory(`${p.name} eligió ${letter}: no está`,"bad");
    const message=`${letter} no está. ${p.name} pierde el turno.`;
    stopTurnTimer(); sfx("bad"); setStatus(`No hay ${letter}.`,"bad"); setNarrator(message,"danger","letter_wrong"); render();
    sendOnlineEvent("letter_result", { letter, count, statusMessage:`No hay ${letter}.`, narratorMessage:message, severity:"danger" });
    animateElement("board","miss-shake"); pulseCurrentPlayer("feedback-negative"); offerWildcard({ type:"letter_wrong", reason:"consonante fallida", message });
  }
}

function buyVowel() {
  if (!canUseTurnAction() || state.spinning || state.charging || state.choosing || currentPlayer().roundMoney<50 || hiddenVowels().length===0) {
    rejectBlockedTurnAction();
    return;
  }
  setStatus("Elige una vocal","spin-result");
  showChoices(hiddenVowels(),"Elige una vocal",chooseVowel,"vowel");
}
function chooseVowel(letter) {
  if (!canUseTurnAction() || state.choiceMode!=="vowel") { rejectBlockedTurnAction(); return; }
  hideChoices(); const p=currentPlayer(); p.roundMoney-=50; state.used.add(letter); const count=occurrences(letter);
  if (count>0) {
    state.lastRevealed=letter; addHistory(`${p.name} compró ${letter}: ${count} acierto${count>1?"s":""}`,"vowel");
    const statusMessage=`Correcto: ${letter} aparece ${count} ${count===1?"vez":"veces"}. La vocal ha costado 50 €.`;
    const narratorMessage=`${p.name} compra ${letter}. ${letter} aparece ${count} ${count===1?"vez":"veces"}.`;
    resetTurnTimer(); sfx("good"); setStatus(statusMessage,"good"); setNarrator(narratorMessage,"success","letter_correct"); render();
    sendOnlineEvent("letter_result", { letter, count, statusMessage, narratorMessage, severity:"success" });
    pulseId(`roundMoney${state.active}`,"money-lost"); pulseCurrentPlayer("feedback-positive"); setTimeout(()=>state.lastRevealed=null,650); checkAutoSolved(); syncOnline("vowel");
  }
  else {
    const message=`${letter} no está. ${p.name} pierde el turno.`;
    const statusMessage=`No hay ${letter}. Pierdes 50 €.`;
    addHistory(`${p.name} compró ${letter}: no está`,"bad"); stopTurnTimer(); sfx("bad"); setStatus(statusMessage,"bad"); setNarrator(message,"danger","letter_wrong"); render();
    sendOnlineEvent("letter_result", { letter, count, statusMessage, narratorMessage:message, severity:"danger" });
    pulseId(`roundMoney${state.active}`,"money-lost"); animateElement("board","miss-shake"); pulseCurrentPlayer("feedback-negative"); offerWildcard({ type:"vowel_wrong", reason:"vocal fallida", message });
  }
}
function checkAutoSolved() {
  const remaining=LETTERS.some(l=>currentPanel().answer.includes(l)&&!state.used.has(l));
  if (!remaining) setTimeout(()=>finishRound(state.active),650);
}
function passTurn() {
  if (!canUseTurnAction() || hiddenConsonants().length>0) { rejectBlockedTurnAction(); return; }
  const passer=currentPlayer().name;
  stopTurnTimer();
  addHistory(`${passer} pasa turno sin consonantes disponibles`,"turn");
  switchTurn(`No quedan consonantes disponibles. ${passer} pasa turno.`);
}

function openSolve() {
  if (!canUseTurnAction() || state.spinning || state.charging || state.choosing) { rejectBlockedTurnAction(); return; }
  state.solveDraft=""; state.solveSubmitting=false; setSpeechState("idle");
  state.choosing=true; state.activity="solving"; state.turnPhase="resolving"; stopTurnTimer(); setStatus("Resolver panel. El tiempo está pausado.","spin-result"); setNarrator(`${currentPlayer().name} está resolviendo...`,"neutral","resolving_started"); render(); syncOnline("solving");
  $("modal").className="modal solve-modal";
  $("modal").innerHTML=`<div class="modal-icon">💡</div><h2>Resolver panel</h2>${solvePanelPreview()}<p>Escribe la solución completa. Las tildes no son necesarias.</p><form id="solveForm"><div class="solve-input-wrap"><textarea id="solutionInput" aria-label="Solución" autocomplete="off" autocapitalize="sentences" autocorrect="on" spellcheck="true" rows="2" placeholder="ESCRIBE AQUÍ..."></textarea><button id="dictateSolveBtn" class="dictate-btn" type="button" aria-label="Dictar respuesta" aria-pressed="false" title="Dictar respuesta">🎙</button></div><div class="modal-actions"><button type="button" id="cancelSolve" class="modal-btn alt">CANCELAR</button><button id="checkSolveBtn" class="modal-btn" type="submit" disabled>COMPROBAR</button></div></form>`;
  $("modalBackdrop").classList.remove("hidden"); syncVisibleViewport();
  const input=$("solutionInput");
  const focusInput=()=>{ try { input.focus({ preventScroll:true }); } catch (_) { input.focus(); } syncVisibleViewport(); };
  focusInput();
  requestAnimationFrame(focusInput);
  $("cancelSolve").addEventListener("click",closeModal);
  const SpeechRecognition=window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $("dictateSolveBtn").disabled=true;
    $("dictateSolveBtn").title="Dictado no disponible en este navegador";
  }
  $("dictateSolveBtn").addEventListener("click",()=>startVoiceDictation(input));
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
    $("checkSolveBtn").disabled=!state.solveDraft.trim();
  };
  input.addEventListener("compositionstart",()=>{ composing=true; });
  input.addEventListener("compositionend",event=>{ composing=false; handleSolveInput(event); });
  input.addEventListener("input",handleSolveInput);
  input.addEventListener("change",handleSolveInput);
  input.addEventListener("paste",()=>setTimeout(()=>handleSolveInput({ target:input }),0));
  autoResizeSolveInput(input);
}
function closeModal(shouldSync=true) {
  const wasSolving = state.activity === "solving";
  stopVoiceDictation("abort");
  cleanupSpeechRecognition();
  setSpeechState("idle");
  $("modalBackdrop").classList.add("hidden");
  document.body.classList.remove("keyboard-visible");
  state.choosing=false; state.activity=""; state.solveDraft=""; state.solveSubmitting=false;
  if (wasSolving) state.turnPhase="active";
  if (wasSolving) setStatus(`Turno de ${currentPlayer().name}`);
  resetTurnTimer(); render();
  if (wasSolving) sendOnlineEvent("solve_draft", { draft: "" });
  if (wasSolving && shouldSync) syncOnline("solve_cancel");
}
function checkSolution(e) {
  e.preventDefault();
  if (!canUseTurnAction() || state.activity!=="solving") { rejectBlockedTurnAction(); return; }
  if (state.solveSubmitting) return;
  const attempt=$("solutionInput").value;
  const cleanAttempt=attempt.trim();
  if (!cleanAttempt) return;
  state.solveSubmitting=true;
  $("checkSolveBtn").disabled=true;
  const spokenAttempt=cleanAttempt || "sin respuesta";
  const correct=normalize(attempt)===normalize(currentPanel().answer);
  if (correct) {
    closeModal(false);
    sendOnlineEvent("solve_result", { attempt: spokenAttempt, correct: true, answer: currentPanel().answer });
    addHistory(`${currentPlayer().name} resolvió: "${spokenAttempt}"`,"solve");
    stopTurnTimer(); renderBoard(true); pulseId("board","panel-complete"); setStatus(`Respuesta correcta: "${spokenAttempt}".`,"good"); setNarrator(`${currentPlayer().name} ha resuelto el panel.`,"success","resolving_success"); setTimeout(()=>finishRound(state.active),1500);
  }
  else {
    closeModal(false);
    sendOnlineEvent("solve_result", { attempt: spokenAttempt, correct: false });
    stopTurnTimer(); sfx("bad");
    addHistory(`${currentPlayer().name} respondió "${spokenAttempt}" y falló`,"bad");
    const message=`${currentPlayer().name} ha fallado al resolver.`;
    delaySwitchTurn(message,"bad",2800);
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

function offerWildcard(options={}) {
  const data=typeof options==="string" ? { reason:options, message:`${currentPlayer().name} pierde el turno.` } : options;
  const player=currentPlayer();
  const baseMessage=data.message || `${player.name} pierde el turno.`;
  setNarrator(baseMessage,data.type==="bankrupt"?"warning":"danger",data.type || "lose_turn");
  if (!player.wildcard) { delaySwitchTurn(baseMessage,"bad",2800); return; }
  if (!onlineCanAct()) { delaySwitchTurn(baseMessage,"bad",2800); return; }
  stopTurnTimer();
  state.turnPhase="showing_result";
  state.activity="showing_result";
  state.choosing=true;
  render();
  syncOnline("wildcard_offer_pending");
  clearResultDelay();
  state.resultDelayTimer=setTimeout(()=>{
    state.resultDelayTimer=0;
    $("modal").className="modal";
    $("modal").innerHTML=`<div class="modal-icon">◆</div><h2>¿Usar comodín?</h2><p>Has sufrido ${data.reason || "pierde turno"}. Puedes gastar tu comodín para conservar el turno.</p><div class="modal-actions"><button id="declineWild" class="modal-btn alt">NO, PASAR TURNO</button><button id="useWild" class="modal-btn">USAR COMODÍN</button></div>`;
    $("modalBackdrop").classList.remove("hidden");
    $("useWild").addEventListener("click",()=>{
      if (!onlineCanAct()) { rejectBlockedTurnAction(); return; }
      const message=data.type==="bankrupt"
        ? `Quiebra: ${player.name} pierde ${money(data.lost || 0)}. Usa comodín y sigue desde 0 €.`
        : `${player.name} usa un comodín y conserva el turno.`;
      addHistory(`${player.name} usa comodín y conserva turno`,"wildcard");
      player.wildcard=false;
      closeModal(false);
      state.turnPhase="active"; state.activity=""; state.choosing=false;
      setStatus("Comodín usado. Conservas el turno.","good");
      setNarrator(message,"success","wildcard_used");
      render(); resetTurnTimer(); syncOnline("wildcard");
    });
    $("declineWild").addEventListener("click",()=>{
      if (!onlineCanAct()) { rejectBlockedTurnAction(); return; }
      addHistory(`${player.name} no usa comodín`,"turn");
      closeModal(false);
      delaySwitchTurn(data.type==="bankrupt" ? `Quiebra: ${player.name} pierde ${money(data.lost || 0)} y el turno.` : baseMessage,"bad",1800);
    });
  },1500);
}
function switchTurn(message="") {
  if (state.jackpotCandidateIndex===state.active) {
    addHistory(`${state.jackpotCandidateName} pierde la opción de bote`,"jackpot");
    clearJackpotCandidate();
  }
  clearResultDelay(); hideChoices(); state.active=nextPlayerIndex(); state.pendingWedge=null; state.activity="";
  addHistory(`Turno de ${currentPlayer().name}`,"turn");
  requestTurnAck(message||`Turno de ${currentPlayer().name}`,message?"bad":"spin-result");
  pulseCurrentPlayer("is-turn-changing"); syncOnline("turn");
}

function finishRound(winnerIndex) {
  if (state.finished) return; state.finished=true;
  state.choiceMode=""; state.screen="game"; state.activity=""; stopTurnTimer();
  const last=state.round===TOTAL_ROUNDS-1;
  const winner=state.players[winnerIndex], panelMoney=winner.roundMoney, earned=panelMoney;
  const jackpotEarned=last && state.jackpotCandidateIndex===winnerIndex && !state.jackpotClaimed ? state.jackpot : 0;
  if (jackpotEarned) {
    state.jackpotClaimed=true;
    state.jackpotWinner=winner.name;
    state.jackpotClaimedAmount=jackpotEarned;
  }
  winner.total+=earned+jackpotEarned; state.active=winnerIndex;
  state.results.push({ panel:state.round+1, winner:winner.name, panelMoney, earned, jackpotWinner:last?state.jackpotWinner:"", jackpotAmount:last?state.jackpotClaimedAmount:0 });
  if (!last) state.jackpot+=100;
  addHistory(`${winner.name} cierra el panel y suma ${money(earned + jackpotEarned)}`,"round");
  sfx("round"); celebrate(last?110:55);
  renderBoard(true); render(); pulseId("board","panel-complete"); pulseId(`totalMoney${winnerIndex}`,"money-bump"); pulseId(`playerCard${winnerIndex}`,"feedback-positive");
  syncOnline("round_finished");
  const boteLine=last?state.jackpotClaimed
    ? `<br><strong>${state.jackpotWinner}</strong> cobra el bote de <strong>${money(state.jackpotClaimedAmount)}</strong> al resolver el panel.`
    : `<br>El bote queda desierto: había que caer en BOTE y resolver el panel.`:"";
  $("modal").className="modal panel-complete-modal";
  $("modal").innerHTML=`<div class="modal-icon">${last?"🏁":"✨"}</div><h2>Panel resuelto</h2><p>La respuesta era: <strong>“${currentPanel().answer}”</strong><br><strong>${winner.name}</strong> suma <strong>${money(earned)}</strong> del panel.${boteLine}<br><br>Marcador: ${scoreboardLine()}</p><button id="nextRound" class="modal-btn">${last?"VER RESULTADO":"SIGUIENTE PANEL →"}</button>`;
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
  $("finalMessage").textContent=tie?"La suerte ha quedado perfectamente repartida.":state.jackpotClaimed?`${state.jackpotWinner} consiguió el bote al resolver el panel final.`:"El bote quedó desierto; había que caer en BOTE y resolver.";
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
  updatePowerMeter, updateTimerDisplay, ensureTimerLoop, showTurnReadyModal, setNarrator
});

bindVisibleViewport();
bindMobileViewportGuards();
buildWheel();
initSharedRoom();
document.addEventListener("pointerdown",unlockAudio,{ passive:true });
document.addEventListener("touchstart",unlockAudio,{ passive:true });
document.addEventListener("pointerdown",flushPendingTurnNotification,{ passive:true });
document.addEventListener("touchstart",flushPendingTurnNotification,{ passive:true });
document.addEventListener("keydown",flushPendingTurnNotification,{ passive:true });
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
