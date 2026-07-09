import { CONSONANTS, MAX_PLAYERS, TURN_SECONDS, VOWELS } from "./config.js?v=mobile-ux-7";
import { getPlayerToken, rememberOnlineSeat, rememberedRoomCode, safeStorageGet, safeStorageRemove, safeStorageSet } from "./storage.js";

export function createOnlineController(ctx) {
  const {
    $, state, online, addHistory, buildWheel, chooseConsonant, chooseVowel,
    currentPlayer, hideChoices, render, renderHistory, resetTurnTimer, setStatus,
    showChoices, showFinal, showGameScreen, showStartScreen, stopTurnTimer,
    updatePowerMeter, updateTimerDisplay, ensureTimerLoop, showTurnReadyModal, setNarrator
  } = ctx;

  function setOnlineStatus(text,type="") {
    const el=$("onlineStatus");
    if (!el) return;
    el.innerHTML=text; el.className=`online-status ${type}`.trim();
  }
  function roomCodeMarkup(code) { return `<span class="room-code">${code}</span>`; }
  function shareUrl(code=online.roomCode) {
    const url = new URL(location.protocol==="file:" ? "http://localhost:3000/" : location.href);
    url.searchParams.set("sala", code);
    return url.toString();
  }
  async function copyText(text, okMessage) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input=document.createElement("input"); input.value=text; document.body.appendChild(input);
        input.select(); document.execCommand("copy"); input.remove();
      }
      setOnlineStatus(okMessage,"good");
    } catch (_) {
      setOnlineStatus(`No he podido copiarlo automáticamente. Copia esto: ${text}`,"bad");
    }
  }
  function updateRoomTools() {
    $("onlineTools").classList.toggle("hidden",!online.roomCode);
    document.querySelector(".online-card")?.classList.toggle("room-active",Boolean(online.roomCode));
    $("startScreen").classList.toggle("is-lobby-active",Boolean(online.roomCode));
  }
  function setInviteMode(code="") {
    const active=Boolean(code);
    $("startScreen").classList.toggle("is-home-mode",!active);
    $("startScreen").classList.toggle("is-invite-mode",active);
    $("startScreen").classList.remove("is-manual-code-mode","is-local-mode");
    document.querySelector(".online-card")?.classList.toggle("invite-mode",active);
    document.querySelector(".create-room-card")?.classList.toggle("hidden",active);
    const kicker=document.querySelector(".online-card .section-kicker");
    const copy=document.querySelector(".online-card .section-copy");
    const joinTitle=document.querySelector(".join-room-card h3");
    const joinCopy=document.querySelector(".join-room-card p");
    const inviteCode=$("inviteCodeBadge");
    const joinButton=$("joinRoomBtn");
    if (kicker) kicker.textContent=active ? "Invitación recibida" : "Jugar online";
    if (copy) copy.textContent=active ? "Escribe tu nombre para unirte." : "Crea una sala y juega con amigos desde casa.";
    if (joinTitle) joinTitle.textContent=active ? "Entrar en la sala" : "Entrar con código";
    if (joinCopy) joinCopy.textContent=active ? "Tu código ya está preparado." : "Introduce el código que te han pasado.";
    if (inviteCode) inviteCode.textContent=active ? `Sala ${code}` : "Sala";
    if (joinButton) joinButton.textContent=active ? "Entrar en la sala" : "Entrar";
  }
  function showManualCodeMode() {
    $("startScreen").classList.add("is-home-mode","is-manual-code-mode");
    $("startScreen").classList.remove("is-invite-mode","is-local-mode");
    document.querySelector(".online-card")?.classList.remove("invite-mode");
    document.querySelector(".create-room-card")?.classList.remove("hidden");
    const kicker=document.querySelector(".online-card .section-kicker");
    const copy=document.querySelector(".online-card .section-copy");
    const joinTitle=document.querySelector(".join-room-card h3");
    const joinCopy=document.querySelector(".join-room-card p");
    if (kicker) kicker.textContent="Entrar manualmente";
    if (copy) copy.textContent="Introduce el código que te han pasado.";
    if (joinTitle) joinTitle.textContent="Entrar con código";
    if (joinCopy) joinCopy.textContent="Introduce el código que te han pasado.";
    $("backToHomeBtn").textContent="Volver a crear sala";
    $("joinRoomBtn").textContent="Entrar";
    setOnlineStatus("");
  }
  function showInviteManualCodeMode() {
    $("startScreen").classList.add("is-invite-mode","is-manual-code-mode");
    $("startScreen").classList.remove("is-home-mode","is-local-mode");
    document.querySelector(".online-card")?.classList.add("invite-mode");
    document.querySelector(".create-room-card")?.classList.add("hidden");
    const kicker=document.querySelector(".online-card .section-kicker");
    const copy=document.querySelector(".online-card .section-copy");
    const joinTitle=document.querySelector(".join-room-card h3");
    const joinCopy=document.querySelector(".join-room-card p");
    if (kicker) kicker.textContent="Cambiar código";
    if (copy) copy.textContent="Introduce otro código de sala.";
    if (joinTitle) joinTitle.textContent="Entrar con otro código";
    if (joinCopy) joinCopy.textContent="Introduce el código que te han pasado.";
    $("backToHomeBtn").textContent="Volver al inicio";
    $("joinRoomBtn").textContent="Entrar";
    setOnlineStatus("");
  }
  function resetInviteMode() {
    const url=new URL(location.href);
    url.searchParams.delete("sala");
    url.searchParams.delete("room");
    history.replaceState(null,"",url.pathname + url.search + url.hash);
    $("roomCodeInput").value="";
    setInviteMode("");
    setOnlineStatus("");
  }
  function restoreOnlineControls() {
    const card=document.querySelector(".online-card"), actions=document.querySelector(".online-actions");
    if (!card || !actions) return;
    ["onlineTools","onlineStartBtn","onlineStatus"].forEach(id=>{
      const el=$(id);
      if (el && el.parentElement!==card) card.insertBefore(el,actions);
    });
  }
  function renderLobby(players=online.players) {
    const panel=$("lobbyPanel");
    if (!panel) return;
    restoreOnlineControls();
    panel.classList.toggle("hidden",!online.roomCode);
    if (!online.roomCode) {
      panel.innerHTML="";
      return;
    }
    panel.innerHTML="";
    const summary=document.createElement("div"); summary.className="lobby-summary";
    const copy=document.createElement("div");
    const title=document.createElement("h3"); title.textContent="Sala privada";
    const hint=document.createElement("p"); hint.textContent="Compártelo con tus jugadores.";
    const currentSeat=players[online.playerIndex];
    const note=document.createElement("p"); note.className="lobby-player-note";
    note.textContent=currentSeat ? `${currentSeat.name} · ${online.isHost ? "Anfitrión" : "Invitado"}` : "";
    copy.append(title,hint,note);
    const code=document.createElement("div"); code.className="lobby-code";
    const codeLabel=document.createElement("span"); codeLabel.textContent="Código";
    const codeValue=document.createElement("strong"); codeValue.textContent=online.roomCode;
    code.append(codeLabel,codeValue);
    summary.append(copy,code); panel.appendChild(summary);
    const settings=document.createElement("div"); settings.className="lobby-settings";
    const settingCopy=document.createElement("div"); settingCopy.className="lobby-setting-copy";
    const settingTitle=document.createElement("strong"); settingTitle.textContent="Ajustes de sala";
    const settingHint=document.createElement("span"); settingHint.textContent=online.isHost ? "Configura la partida antes de empezar." : "Configurado por el anfitrión.";
    settingCopy.append(settingTitle,settingHint);
    const shortLabel=document.createElement("label"); shortLabel.className="setup-option lobby-setup-option";
    const shortInput=document.createElement("input"); shortInput.id="shortRoundToggle"; shortInput.type="checkbox"; shortInput.checked=Boolean(state.shortRound); shortInput.disabled=!online.isHost;
    shortInput.addEventListener("change",()=>{ state.shortRound=shortInput.checked; });
    shortLabel.append(shortInput,document.createTextNode(" Turnos rápidos · 20s"));
    settings.append(settingCopy,shortLabel);
    panel.appendChild(settings);
    const playersTitle=document.createElement("p"); playersTitle.className="lobby-players-title"; playersTitle.textContent="Jugadores conectados";
    panel.appendChild(playersTitle);
    const list=document.createElement("div"); list.className="lobby-list";
    for (let i=0;i<MAX_PLAYERS;i++) {
      const player=players[i], slot=document.createElement("div");
      const host=i===0 && player, me=i===online.playerIndex;
      const connectionClass=player ? (player.connected ? "connected" : "disconnected") : "empty";
      slot.className=`lobby-slot ${connectionClass} ${host?"host":""} ${me?"me":""}`.trim();
      const index=document.createElement("span"); index.className="slot-index"; index.textContent=`J${i+1}`;
      const info=document.createElement("span"); info.className="slot-info";
      const name=document.createElement("span"); name.className="slot-name"; name.textContent=player ? player.name : "Hueco libre";
      const meta=document.createElement("span"); meta.className="slot-meta";
      meta.textContent=player ? (host ? "Anfitrión" : (player.connected ? "Listo para jugar" : "Sin conexión")) : "Esperando jugador";
      info.append(name,meta);
      const badge=document.createElement("span"); badge.className="slot-badge";
      badge.textContent=host?"ANFITRIÓN":(player?(player.connected?"LISTO":"OFF"):"LIBRE");
      slot.append(index,info,badge); list.appendChild(slot);
    }
    panel.appendChild(list);
  }
  function copyRoomCode() {
    if (!online.roomCode) return;
    copyText(online.roomCode, `Código ${roomCodeMarkup(online.roomCode)} copiado.`);
  }
  async function copyRoomLink() {
    if (!online.roomCode) return;
    const url=shareUrl();
    const shareData={
      title:"La Ruleta de la Suerte",
      text:`Únete a mi sala ${online.roomCode} en La Ruleta de la Suerte.`,
      url
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setOnlineStatus(`Enlace de sala compartido. Quien lo abra tendrá el código ${roomCodeMarkup(online.roomCode)} listo.`,"good");
        return;
      } catch (error) {
        if (error?.name==="AbortError") return;
      }
    }
    copyText(url, `Enlace de sala copiado. Quien lo abra tendrá el código ${roomCodeMarkup(online.roomCode)} listo.`);
  }
  function resetOnlineRoom(message="Has salido de la sala.") {
    const socket=online.socket;
    online.manualClose=true;
    stopHeartbeat();
    clearTimeout(online.reconnectTimer);
    online.reconnectTimer=0;
    online.pendingOpenActions=[];
    online.enabled=false; online.connected=false; online.socket=null; online.roomCode=""; online.playerIndex=null;
    online.isHost=false; online.applyingRemote=false; online.started=false; online.players=[]; online.autoRejoining=false;
    safeStorageRemove("ruletaLastRoom");
    if (socket && socket.readyState!==WebSocket.CLOSED && socket.readyState!==WebSocket.CLOSING) {
      try { socket.close(1000,"leave_room"); } catch (_) {}
    }
    $("roomCodeInput").value="";
    $("createRoomBtn").disabled=false;
    $("joinRoomBtn").disabled=false;
    $("onlineStartBtn").classList.add("hidden");
    updateRoomTools();
    renderLobby([]);
    setOnlineStatus(message,"good");
    showStartScreen();
  }
  function leaveRoom() {
    if (!online.roomCode) { resetOnlineRoom(); return; }
    const code=online.roomCode;
    sendOnline({type:"leave_room",code});
    resetOnlineRoom("Has salido de la sala.");
  }
  function leaveCurrentGame() {
    $("modalBackdrop").classList.add("hidden");
    hideChoices();
    stopTurnTimer();
    state.finished=true; state.screen="start"; state.activity="";
    if (online.enabled && online.roomCode) leaveRoom();
    else {
      online.enabled=false; online.started=false;
      showStartScreen();
    }
  }
  function wsUrl() {
    const protocol=location.protocol==="https:"?"wss":"ws";
    const host=location.protocol==="file:"?"localhost:3000":location.host;
    return `${protocol}://${host}`;
  }
  function appUrl() {
    return location.protocol==="file:" ? "http://localhost:3000" : `${location.protocol}//${location.host}`;
  }
  function stopHeartbeat() {
    clearInterval(online.heartbeatTimer);
    online.heartbeatTimer=0;
  }
  function startHeartbeat() {
    stopHeartbeat();
    online.heartbeatTimer=setInterval(()=>sendOnline({ type:"ping", time:Date.now() }),15000);
  }
  function scheduleReconnect(reason="") {
    if (!online.enabled || !online.roomCode || !online.token || state.screen==="final") return;
    clearTimeout(online.reconnectTimer);
    const delay=Math.min(1000*Math.pow(1.7,online.reconnectAttempts),8000);
    online.reconnectAttempts++;
    const message=reason==="visible"?"Reconectando al volver a la partida…":"Reconectando con la sala…";
    if (state.screen==="game") setStatus(message,"spin-result");
    online.reconnectTimer=setTimeout(()=>reconnectOnlineSeat(),delay);
  }
  function reconnectOnlineSeat() {
    if (!online.roomCode || !online.token) return;
    const name=safeStorageGet("ruletaPlayerName") || state.players[online.playerIndex]?.name || $("onlineName").value.trim() || "Jugador";
    online.autoRejoining=true;
    connectOnline(()=>sendOnline({type:"join_room",code:online.roomCode,name,token:online.token}),true);
  }
  function connectOnline(onOpen) {
    if (online.socket && online.socket.readyState===WebSocket.OPEN) { onOpen(); return; }
    if (online.socket && online.socket.readyState===WebSocket.CONNECTING) {
      if (onOpen) online.pendingOpenActions.push(onOpen);
      return;
    }
    online.pendingOpenActions = onOpen ? [onOpen] : [];
    online.manualClose=false;
    setOnlineStatus(`Conectando con ${location.protocol==="file:"?"localhost:3000":location.host}…`);
    const socket=new WebSocket(wsUrl()); online.socket=socket;
    socket.addEventListener("open",()=>{
      if (online.socket!==socket) return;
      online.connected=true; online.reconnectAttempts=0; startHeartbeat();
      const actions=[...online.pendingOpenActions];
      online.pendingOpenActions=[];
      actions.forEach(action=>action());
    });
    socket.addEventListener("message",event=>{
      if (online.socket!==socket) return;
      handleOnlineMessage(JSON.parse(event.data));
    });
    socket.addEventListener("close",()=>{
      if (online.socket!==socket) return;
      online.connected=false; stopHeartbeat();
      online.socket=null;
      online.pendingOpenActions=[];
      if (online.enabled && !state.finished) setStatus("Conexión online perdida. Intentando reconectar…","bad");
      if (!online.started) setOnlineStatus(`No hay conexión con el servidor. Arranca Node y entra por ${appUrl()}`,"bad");
      if (!online.manualClose) scheduleReconnect();
    });
    socket.addEventListener("error",()=>{
      if (online.socket!==socket) return;
      if (!online.enabled) setOnlineStatus(`No puedo conectar. Asegúrate de ejecutar npm start y abrir ${appUrl()}`,"bad");
    });
  }
  function sendOnline(message) {
    if (online.socket?.readyState===WebSocket.OPEN) online.socket.send(JSON.stringify(message));
  }
  function createRoom() {
    if (online.roomCode) { setOnlineStatus(`Ya estás en la sala ${roomCodeMarkup(online.roomCode)}.`, "good"); return; }
    const name=$("onlineName").value.trim()||"Jugador 1";
    safeStorageSet("ruletaPlayerName",name);
    online.token=getPlayerToken();
    setOnlineStatus("Creando sala…", "good");
    connectOnline(()=>sendOnline({type:"create_room",name,token:online.token}));
  }
  function joinRoom() {
    const name=$("onlineName").value.trim()||"Jugador 2";
    const code=$("roomCodeInput").value.trim().toUpperCase();
    joinRoomByCode(code,name);
  }
  function joinRoomByCode(code,name,auto=false) {
    if (!code) { setOnlineStatus("Escribe el código de sala para entrar.","bad"); return; }
    if (online.roomCode===code) { setOnlineStatus(`Ya estás dentro de la sala ${roomCodeMarkup(code)}.`, "good"); return; }
    if (online.roomCode) { setOnlineStatus(`Ya estás en la sala ${roomCodeMarkup(online.roomCode)}. Recarga para cambiar de sala.`, "bad"); return; }
    safeStorageSet("ruletaPlayerName",name);
    online.token=getPlayerToken();
    online.autoRejoining=auto;
    if (auto) setOnlineStatus(`Reconectando automáticamente a la sala ${roomCodeMarkup(code)}…`, "good");
    connectOnline(()=>sendOnline({type:"join_room",code,name,token:online.token}));
  }
  function handleOnlineMessage(message) {
    if (message.type==="pong") return;
    if (message.type==="room_created") {
      online.enabled=true; online.isHost=Boolean(message.isHost); online.started=false; online.roomCode=message.code; online.playerIndex=message.playerIndex; online.players=message.players;
      online.token=message.token||online.token; rememberOnlineSeat(message.code,online.token);
      setOnlineStatus(`Sala creada: ${roomCodeMarkup(message.code)}. Pásale este código al otro jugador.`, "good");
      $("roomCodeInput").value=message.code; updateRoomTools();
      updateOnlineLobby(message.players);
    }
    if (message.type==="room_joined") {
      online.enabled=true; online.isHost=Boolean(message.isHost); online.started=Boolean(message.started); online.roomCode=message.code; online.playerIndex=message.playerIndex; online.players=message.players;
      online.token=message.token||online.token; rememberOnlineSeat(message.code,online.token);
      setOnlineStatus(online.autoRejoining
        ? `Has vuelto a la sala ${roomCodeMarkup(message.code)} como Jugador ${message.playerIndex+1}.`
        : `Has entrado en la sala ${roomCodeMarkup(message.code)} como Jugador ${message.playerIndex+1}.`, "good");
      online.autoRejoining=false;
      $("roomCodeInput").value=message.code; updateRoomTools();
      updateOnlineLobby(message.players);
      if (message.state) applyOnlineSnapshot(message.state);
    }
    if (message.type==="room_update") {
      online.players=message.players;
      if (typeof message.playerIndex==="number") online.playerIndex=message.playerIndex;
      if (typeof message.isHost==="boolean") online.isHost=message.isHost;
      updateOnlineLobby(message.players);
      recoverTurnIfNeeded("room_update");
    }
    if (message.type==="snapshot") {
      online.started=true; applyOnlineSnapshot(message.state);
    }
    if (message.type==="realtime_event") {
      applyRealtimeEvent(message.event, message.senderIndex);
    }
    if (message.type==="left_room") {
      resetOnlineRoom("Has salido de la sala.");
    }
    if (message.type==="error") { online.autoRejoining=false; setOnlineStatus(message.message,"bad"); }
    if (message.type==="peer_left") {
      online.players=message.players||online.players;
      if (!online.started) updateOnlineLobby(online.players);
      else if (!recoverTurnIfNeeded("peer_left")) setStatus("El otro jugador se ha desconectado. La sala queda en pausa hasta que vuelva a entrar.","bad");
    }
  }
  function updateOnlineLobby(players=online.players) {
    const present=players.filter(p=>p?.connected), ready=present.length>=2;
    const isHostPlayer=online.isHost===true;
    online.players=players;
    $("onlineStartBtn").classList.toggle("hidden",!(isHostPlayer && ready && !online.started));
    $("onlineStartBtn").textContent=ready ? "Empezar partida" : "Esperando jugadores…";
    $("createRoomBtn").disabled=Boolean(online.roomCode);
    $("joinRoomBtn").disabled=Boolean(online.roomCode);
    renderLobby(players);
    updateRoomTools();
    if (ready && !online.started && isHostPlayer) setOnlineStatus("Listo para empezar. Puedes esperar hasta 4 jugadores.", "good");
    else if (ready && !online.started) setOnlineStatus("Esperando a que el anfitrión empiece la partida.", "good");
    else if (online.enabled && !online.started) setOnlineStatus(`${present.length}/4 jugadores conectados. Mínimo 2 para empezar.`);
  }
  function onlineCanAct() {
    if (!online.enabled) return true;
    return (state.playerSlots[state.active] ?? state.active) === online.playerIndex;
  }
  function activeSlotIndex() {
    return state.playerSlots[state.active] ?? state.active;
  }
  function connectedPlayerIndexAfter(from=state.active) {
    if (!state.players.length) return -1;
    for (let step=1; step<=state.players.length; step++) {
      const next=(from+step)%state.players.length;
      const slot=state.playerSlots[next] ?? next;
      if (online.players[slot]?.connected) return next;
    }
    return -1;
  }
  function recoverTurnIfNeeded(reason="") {
    if (!online.enabled || !online.started || state.screen!=="game" || state.finished || !state.players.length) return false;
    const activeSlot=activeSlotIndex();
    if (online.players[activeSlot]?.connected) return false;
    const next=connectedPlayerIndexAfter();
    if (next<0 || next===state.active) return false;
    state.active=next;
    state.pendingWedge=null;
    state.choiceMode="";
    state.choosing=false;
    state.charging=false;
    state.spinning=false;
    state.activity="";
    state.turnAwaitingAck=true;
    state.turnId=(state.turnId || 0) + 1;
    state.turnAcceptedAt=0;
    state.turnAcceptedBy=-1;
    state.turnPhase="waiting_ack";
    state.charge=0;
    updatePowerMeter(0);
    $("choicePanel").classList.add("hidden");
    $("keyboard").innerHTML="";
    $("modalBackdrop").classList.add("hidden");
    addHistory(`Turno recuperado para ${currentPlayer().name}`,"turn");
    stopTurnTimer();
    setStatus(`Turno recuperado para ${currentPlayer().name}.`,reason==="peer_left"?"bad":"spin-result");
    render();
    if (onlineCanAct()) showTurnReadyModal();
    syncOnline("recover_turn");
    return true;
  }
  function snapshotState() {
    return {
      players: state.players, panels: state.panels, round: state.round, active: state.active,
      playerSlots: state.playerSlots,
      used: [...state.used], currentRotation: state.currentRotation, pendingWedge: state.pendingWedge,
      finished: state.finished, jackpot: state.jackpot, results: state.results,
      jackpotClaimed: state.jackpotClaimed, jackpotWinner: state.jackpotWinner,
      jackpotClaimedAmount: state.jackpotClaimedAmount,
      jackpotCandidateIndex: state.jackpotCandidateIndex, jackpotCandidateName: state.jackpotCandidateName,
      choiceMode: state.choiceMode,
      statusText: state.statusText, statusType: state.statusType, screen: state.screen,
      history: state.history, timerDeadline: state.timerDeadline, timerRemaining: state.timerRemaining,
      activity: state.activity, solveDraft: state.solveDraft,
      turnAwaitingAck: state.turnAwaitingAck, turnSeconds: state.turnSeconds, shortRound: state.shortRound,
      turnId: state.turnId, turnAcceptedAt: state.turnAcceptedAt, turnAcceptedBy: state.turnAcceptedBy, turnPhase: state.turnPhase,
      lastEvent: state.lastEvent
    };
  }
  function sendOnlineEvent(type,payload={}) {
    if (!online.enabled || online.applyingRemote || !online.roomCode) return;
    sendOnline({type:"realtime_event",code:online.roomCode,event:{type,...payload}});
  }
  function syncOnline(reason="state") {
    if (!online.enabled || online.applyingRemote) return;
    sendOnline({type:"snapshot",code:online.roomCode,reason,state:snapshotState()});
  }
  function applyRealtimeEvent(event={},senderIndex=-1) {
    if (!online.enabled || !online.started || state.screen!=="game" || state.finished) return;
    if (typeof senderIndex==="number" && senderIndex===online.playerIndex) return;
    if (event.type==="wheel_charge") {
      state.activity="charging"; state.charging=true; state.spinning=false;
      $("wheel").classList.add("charging");
      updatePowerMeter(Math.max(0,Math.min(100,Number(event.charge)||0)));
      setStatus(`${currentPlayer().name} está cargando la ruleta`,"spin-result");
      render();
      return;
    }
    if (event.type==="wheel_charge_cancel") {
      state.activity=""; state.charging=false; state.spinning=false;
      $("wheel").classList.remove("charging");
      updatePowerMeter(0);
      setStatus(`Turno de ${currentPlayer().name}`);
      render();
      return;
    }
    if (event.type==="wheel_spin_start") {
      state.activity="spinning"; state.charging=false; state.spinning=true;
      $("wheel").classList.remove("charging");
      updatePowerMeter(0);
      if (Number.isFinite(event.rotation)) {
        state.currentRotation=event.rotation;
        $("wheel").style.transform=`rotate(${state.currentRotation}deg)`;
      }
      setStatus(`${currentPlayer().name} está girando la ruleta`,"spin-result");
      render();
      return;
    }
    if (event.type==="wheel_rotation") {
      if (!Number.isFinite(event.rotation)) return;
      if (!state.spinning) {
        state.activity="spinning"; state.spinning=true; state.charging=false;
        setStatus(`${currentPlayer().name} está girando la ruleta`,"spin-result");
        render();
      }
      state.currentRotation=event.rotation;
      $("wheel").style.transform=`rotate(${state.currentRotation}deg)`;
      return;
    }
    if (event.type==="wheel_spin_end") {
      if (Number.isFinite(event.rotation)) {
        state.currentRotation=event.rotation;
        $("wheel").style.transform=`rotate(${state.currentRotation}deg)`;
      }
      state.spinning=false;
      return;
    }
    if (event.type==="letter_result") {
      const letter=String(event.letter||"").toUpperCase().replace(/[^A-ZÑ]/g,"").slice(0,1);
      const count=Number(event.count)||0;
      const statusMessage=String(event.statusMessage||"").trim().slice(0,160);
      const narratorMessage=String(event.narratorMessage||statusMessage).trim().slice(0,160);
      const severity=event.severity==="success" ? "success" : "danger";
      if (letter) state.lastRevealed=letter;
      setStatus(statusMessage || (count>0 ? `${letter} aparece ${count} ${count===1?"vez":"veces"}.` : `No hay ${letter}.`), severity==="success" ? "good" : "bad");
      setNarrator?.(narratorMessage, severity, count>0 ? "letter_correct" : "letter_wrong");
      render();
      setTimeout(()=>{ if (state.lastRevealed===letter) state.lastRevealed=null; },650);
      return;
    }
    if (event.type==="solve_draft") {
      const draft=String(event.draft||"").toUpperCase().replace(/\s+/g," ").slice(0,80);
      state.activity="solving"; state.solveDraft=draft; state.charging=false; state.spinning=false;
      stopTurnTimer();
      setStatus(`${currentPlayer().name} está intentando resolver`,"spin-result");
      setNarrator?.(draft ? `${currentPlayer().name} escribe: "${draft}"` : `${currentPlayer().name} está resolviendo...`,"neutral","resolving_started");
      render();
      return;
    }
    if (event.type==="solve_result") {
      const attempt=String(event.attempt||"sin respuesta").trim().replace(/\s+/g," ").slice(0,120);
      const correct=Boolean(event.correct);
      state.activity="solving";
      state.solveDraft=attempt;
      state.charging=false;
      state.spinning=false;
      stopTurnTimer();
      setStatus(correct
        ? `${currentPlayer().name} responde "${attempt}" y acierta.`
        : `${currentPlayer().name} responde "${attempt}" y falla.`,
        correct ? "good" : "bad");
      setNarrator?.(correct ? `${currentPlayer().name} ha resuelto el panel.` : `${currentPlayer().name} ha fallado al resolver.`, correct ? "success" : "danger", correct ? "resolving_success" : "resolving_failed");
      addHistory(correct
        ? `${currentPlayer().name} respondió "${attempt}" y acertó`
        : `${currentPlayer().name} respondió "${attempt}" y falló`,
        correct ? "solve" : "bad");
      render();
    }
  }
  function applyOnlineSnapshot(snapshot) {
    online.applyingRemote=true;
    state.players=snapshot.players||state.players; state.panels=snapshot.panels||state.panels; state.round=snapshot.round||0; state.active=snapshot.active||0; state.playerSlots=snapshot.playerSlots||state.players.map((_,i)=>i);
    state.used=new Set(snapshot.used||[]); state.currentRotation=snapshot.currentRotation||0; state.pendingWedge=snapshot.pendingWedge||null;
    state.finished=Boolean(snapshot.finished); state.jackpot=snapshot.jackpot||0; state.results=snapshot.results||[];
    state.jackpotClaimed=Boolean(snapshot.jackpotClaimed); state.jackpotWinner=snapshot.jackpotWinner||""; state.jackpotClaimedAmount=snapshot.jackpotClaimedAmount||0;
    state.jackpotCandidateIndex=Number.isFinite(Number(snapshot.jackpotCandidateIndex)) ? Number(snapshot.jackpotCandidateIndex) : -1;
    state.jackpotCandidateName=snapshot.jackpotCandidateName||"";
    state.choiceMode=snapshot.choiceMode||""; state.statusText=snapshot.statusText||""; state.statusType=snapshot.statusType||""; state.screen=snapshot.screen||"game";
    state.history=snapshot.history||[];
    state.lastEvent=snapshot.lastEvent||null;
    state.timerDeadline=snapshot.timerDeadline||0; state.timerRemaining=snapshot.timerRemaining||TURN_SECONDS; state.activity=snapshot.activity||""; state.solveDraft=snapshot.solveDraft||"";
    state.turnAwaitingAck=Boolean(snapshot.turnAwaitingAck);
    state.turnSeconds=snapshot.turnSeconds||TURN_SECONDS;
    state.shortRound=Boolean(snapshot.shortRound);
    state.turnId=Number(snapshot.turnId)||0;
    state.turnAcceptedAt=Number(snapshot.turnAcceptedAt)||0;
    const acceptedBy=Number(snapshot.turnAcceptedBy);
    state.turnAcceptedBy=Number.isFinite(acceptedBy) ? acceptedBy : -1;
    state.turnPhase=snapshot.turnPhase || (state.turnAwaitingAck ? "waiting_ack" : "active");
    state.spinning=false; state.charging=false; state.choosing=false; state.charge=0; updatePowerMeter(0); $("choicePanel").classList.add("hidden"); $("keyboard").innerHTML="";
    ensureTimerLoop(); updateTimerDisplay();
    $("wheel").style.transform=`rotate(${state.currentRotation}deg)`; buildWheel();
    $("modalBackdrop").classList.add("hidden");
    if (state.screen==="final") showFinal(false);
    else {
      showGameScreen(); render(); setStatus(state.statusText,state.statusType);
      if (state.activity==="solving" && state.solveDraft && !onlineCanAct()) {
        setNarrator?.(`${currentPlayer().name} escribe: "${state.solveDraft}"`,"neutral","resolving_started");
      }
      renderHistory(); if (state.turnAwaitingAck && onlineCanAct()) showTurnReadyModal();
    }
    const restored=restorePendingActionAfterReconnect();
    online.applyingRemote=false;
    if (restored) syncOnline("restore_turn");
  }
  function restorePendingActionAfterReconnect() {
    if (!online.enabled || !onlineCanAct() || state.screen!=="game" || state.finished) return false;
    if (state.turnAwaitingAck) {
      showTurnReadyModal();
      return false;
    }
    if (state.choiceMode==="vowel") {
      showChoices(VOWELS.filter(l=>!state.used.has(l)),"COMPRA UNA VOCAL · COSTE 50 €",chooseVowel,"vowel",{ sync:false });
      setStatus(state.statusText||"Compra una vocal.","spin-result");
      return true;
    }
    if (state.choiceMode==="consonant" && state.pendingWedge) {
      showChoices(CONSONANTS.filter(l=>!state.used.has(l)),"ELIGE UNA CONSONANTE",chooseConsonant,"consonant",{ sync:false });
      setStatus(state.statusText||`${state.pendingWedge.label}. Elige una consonante.`,"spin-result");
      return true;
    }
    if (["charging","spinning"].includes(state.activity)) {
      state.activity="";
      resetTurnTimer();
      setStatus(`Turno recuperado para ${currentPlayer().name}.`,"spin-result");
      render();
      return true;
    }
    if (!state.timerDeadline) {
      resetTurnTimer();
      render();
      return true;
    }
    return false;
  }

  function initSharedRoom() {
    const params=new URLSearchParams(location.search), code=(params.get("sala")||params.get("room")||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
    const remembered=rememberedRoomCode();
    const rememberedName=safeStorageGet("ruletaPlayerName");
    if (rememberedName) $("onlineName").value=rememberedName;
    setInviteMode(code);
    const target=code||remembered;
    if (!target) return;
    $("roomCodeInput").value=target;
    if (code) setOnlineStatus(`Código ${roomCodeMarkup(code)} detectado en el enlace. Escribe tu nombre y pulsa Entrar.`, "good");
  }
  function resumeOnlineConnection() {
    if (!online.enabled || !online.roomCode || !online.token) return;
    if (!online.socket || online.socket.readyState===WebSocket.CLOSED || online.socket.readyState===WebSocket.CLOSING) {
      scheduleReconnect("visible");
      return;
    }
    sendOnline({ type:"ping", time:Date.now() });
  }

  return {
    copyRoomCode, copyRoomLink, createRoom, initSharedRoom, joinRoom,
    leaveCurrentGame, leaveRoom, onlineCanAct, resumeOnlineConnection,
    resetInviteMode, setOnlineStatus, showInviteManualCodeMode, showManualCodeMode, syncOnline, sendOnlineEvent
  };
}
