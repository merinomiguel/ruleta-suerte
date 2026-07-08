export function createEffects($) {
  function animateElement(id, className) {
    const el = $(id);
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), 650);
  }

  function bumpJackpot() {
    animateElement("jackpot", "bump");
  }

  function celebrate(amount = 70) {
    const layer = $("confettiLayer");
    const colors = ["#ffd53d", "#4de6e2", "#ff5364", "#54e59a", "#8e69d5", "#ffffff"];
    for (let i = 0; i < amount; i++) {
      const piece = document.createElement("i");
      piece.className = "confetti";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--duration", `${2.4 + Math.random() * 2.2}s`);
      piece.style.setProperty("--drift", `${-120 + Math.random() * 240}px`);
      piece.style.setProperty("--turn", `${360 + Math.random() * 900}deg`);
      piece.style.animationDelay = `${Math.random() * .45}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 5200);
    }
  }

  return { animateElement, bumpJackpot, celebrate };
}
