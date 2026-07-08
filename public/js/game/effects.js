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
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) return;

    const layer = $("confettiLayer");
    const mobile = window.matchMedia?.("(hover: none), (pointer: coarse), (max-width: 900px)")?.matches;
    const count = mobile ? Math.min(amount, 32) : amount;
    const lifetime = mobile ? 3600 : 5200;
    const colors = ["#ffd53d", "#4de6e2", "#ff5364", "#54e59a", "#8e69d5", "#ffffff"];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement("i");
      piece.className = "confetti";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty("--duration", `${(mobile ? 1.8 : 2.4) + Math.random() * (mobile ? 1.2 : 2.2)}s`);
      piece.style.setProperty("--drift", `${-90 + Math.random() * 180}px`);
      piece.style.setProperty("--turn", `${260 + Math.random() * 640}deg`);
      piece.style.animationDelay = `${Math.random() * .45}s`;
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), lifetime);
    }
  }

  return { animateElement, bumpJackpot, celebrate };
}
