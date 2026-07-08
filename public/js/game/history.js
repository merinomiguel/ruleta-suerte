function historyIcon(type) {
  return { spin:"🎡", letter:"🔤", vowel:"💸", turn:"➡️", money:"💰", bad:"❌", jackpot:"🎯", solve:"💡", round:"✨", room:"🔗", wildcard:"◆" }[type] || "•";
}

export function createHistory($, state) {
  function addHistory(text, type = "") {
    state.history.unshift({ text, type, time: Date.now() });
    state.history = state.history.slice(0, 24);
    renderHistory();
  }

  function renderHistory() {
    const list = $("logList");
    const empty = $("logEmpty");
    if (!list || !empty) return;
    list.innerHTML = "";
    empty.classList.toggle("hidden", state.history.length > 0);
    state.history.forEach(entry => {
      const item = document.createElement("div");
      item.className = "log-item";
      const icon = document.createElement("span");
      icon.className = "log-icon";
      icon.textContent = historyIcon(entry.type);
      const text = document.createElement("span");
      text.textContent = entry.text;
      item.append(icon, text);
      list.appendChild(item);
    });
  }

  return { addHistory, renderHistory };
}
