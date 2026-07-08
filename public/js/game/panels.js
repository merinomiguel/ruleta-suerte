import { PANEL_DATA } from "../data/panels.js?v=board-resolve-1";

const DIFFICULTY_LABELS = {
  facil: "fácil",
  fácil: "fácil",
  media: "media",
  dificil: "difícil",
  difícil: "difícil"
};

const FALLBACK_PANEL = {
  categoria: "Frase popular",
  pista: "Una solución de reserva para que la partida nunca se quede sin panel.",
  solucion: "LA RULETA DE LA SUERTE",
  dificultad: "media"
};

function stripMarks(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0301\u0308]/g, "")
    .normalize("NFC");
}

function normalizeDifficulty(value) {
  const key = stripMarks(value).trim().toLowerCase();
  return DIFFICULTY_LABELS[key] || "media";
}

function normalizeAnswer(value) {
  return stripMarks(value).toUpperCase().replace(/\s+/g, " ").trim();
}

function normalizePanel(panel, index) {
  const normalized = {
    ...panel,
    categoria: String(panel?.categoria ?? "").trim(),
    pista: String(panel?.pista ?? "").trim(),
    solucion: normalizeAnswer(panel?.solucion),
    dificultad: normalizeDifficulty(panel?.dificultad),
    _panelId: index
  };
  return {
    ...normalized,
    clue: normalized.pista,
    answer: normalized.solucion
  };
}

export const PANELS = PANEL_DATA
  .map(normalizePanel)
  .filter(panel => panel.categoria && panel.clue && panel.answer);

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function selectProgressivePanels() {
  const progression = [
    ["fácil", "media"],
    ["fácil", "media"],
    ["media"],
    ["media"],
    ["difícil"]
  ];
  const source = PANELS.length ? PANELS : [normalizePanel(FALLBACK_PANEL, -1)];
  const pools = {
    "fácil": shuffle(source.filter(panel => panel.dificultad === "fácil")),
    "media": shuffle(source.filter(panel => panel.dificultad === "media")),
    "difícil": shuffle(source.filter(panel => panel.dificultad === "difícil"))
  };
  const reserve = shuffle(source);
  const used = new Set();

  function takeFrom(pool) {
    while (pool.length) {
      const panel = pool.pop();
      if (!used.has(panel._panelId)) {
        used.add(panel._panelId);
        return panel;
      }
    }
    return null;
  }

  function takeFromDifficulties(difficulties) {
    const mixedPool = shuffle(difficulties.flatMap(difficulty => pools[difficulty] || []));
    return takeFrom(mixedPool);
  }

  return progression.map(difficulties => takeFromDifficulties(difficulties) || takeFrom(reserve) || source[0]);
}
