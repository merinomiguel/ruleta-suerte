import { PANEL_DATA } from "../data/panels.js";

export const PANELS = PANEL_DATA.map(panel => ({
  ...panel,
  clue: panel.pista,
  answer: panel.solucion
}));

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function selectProgressivePanels() {
  const progression = ["fácil", "fácil", "media", "media", "difícil"];
  const pools = {
    "fácil": shuffle(PANELS.filter(panel => panel.dificultad === "fácil")),
    "media": shuffle(PANELS.filter(panel => panel.dificultad === "media")),
    "difícil": shuffle(PANELS.filter(panel => panel.dificultad === "difícil"))
  };
  return progression.map(difficulty => pools[difficulty].pop());
}
