import { JACKPOT_ROUND, WEDGES } from "./config.js?v=mobile-ux-1";

function polar(cx, cy, r, angle) {
  const rad = (angle - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(start, end) {
  const a = polar(150, 150, 144, end);
  const b = polar(150, 150, 144, start);
  return `M150 150 L${a.x} ${a.y} A144 144 0 0 0 ${b.x} ${b.y} Z`;
}

const MONEY_COLORS = ["#1c4dff", "#08a98d", "#f29a19", "#6a45f5", "#1478d8", "#e64264"];
const SPECIAL_COLORS = {
  bankrupt: { fill: "#16213f", text: "#ffffff", stroke: "rgba(7,16,45,.5)" },
  lose: { fill: "#f8fbff", text: "#18264f", stroke: "rgba(24,38,79,.2)" },
  x2: { fill: "#7d3cff", text: "#ffffff", stroke: "rgba(53,20,120,.42)" },
  wildcard: { fill: "#5a42e8", text: "#fff4c7", stroke: "rgba(35,26,116,.48)" },
  half: { fill: "#e64264", text: "#ffffff", stroke: "rgba(127,13,44,.36)" },
  jackpot: { fill: "#ffc247", text: "#342100", stroke: "rgba(255,255,255,.7)" }
};

function getWheelDisplay(wedge, index) {
  const special = SPECIAL_COLORS[wedge.type];
  if (special) {
    const label = wedge.type === "half" ? "MITAD" : wedge.type === "wildcard" ? "COMODÍN" : wedge.label;
    return {
      label,
      lines: [label],
      fill: special.fill,
      text: special.text,
      stroke: special.stroke,
      special: true
    };
  }
  const fill = MONEY_COLORS[index % MONEY_COLORS.length];
  const warmText = fill === "#f29a19" || fill === "#08a98d";
  return {
    label: wedge.label,
    lines: [wedge.label],
    fill,
    text: warmText ? "#071333" : "#ffffff",
    stroke: warmText ? "rgba(255,255,255,.58)" : "rgba(8,18,48,.44)",
    special: false
  };
}

function getWheelTextClass(wedge, display) {
  const parts = ["wheel-label", display.special ? "wheel-label--special" : "wheel-label--money"];
  if (display.lines.length > 1) parts.push("wheel-label--stacked");
  if (wedge.type === "bankrupt" || wedge.type === "wildcard") parts.push("wheel-label--tight");
  return parts.join(" ");
}

function appendWheelText(text, display) {
  text.textContent = "";
  if (display.lines.length === 1) {
    text.textContent = display.lines[0];
    return;
  }
  display.lines.forEach((line, index) => {
    const tspan = document.createElementNS(text.namespaceURI, "tspan");
    tspan.setAttribute("x", text.getAttribute("x"));
    tspan.setAttribute("dy", index === 0 ? "-0.42em" : "0.92em");
    tspan.textContent = line;
    text.appendChild(tspan);
  });
}

function appendWheelDefs(svg, ns) {
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `
    <linearGradient id="wheelSliceSheen" x1="72" y1="42" x2="228" y2="258" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="white" stop-opacity=".24"/>
      <stop offset=".48" stop-color="white" stop-opacity=".06"/>
      <stop offset="1" stop-color="#06102d" stop-opacity=".18"/>
    </linearGradient>
    <radialGradient id="wheelOuterDepth" cx="50%" cy="45%" r="56%">
      <stop offset="68%" stop-color="white" stop-opacity="0"/>
      <stop offset="100%" stop-color="#06102d" stop-opacity=".24"/>
    </radialGradient>
  `;
  svg.appendChild(defs);
}

export function createWheel($, state) {
  function buildWheel() {
    const svg = $("wheel");
    const ns = "http://www.w3.org/2000/svg";
    svg.innerHTML = "";
    appendWheelDefs(svg, ns);
    state.activeWedges = WEDGES.map(w => ({ ...w }));
    if (state.round === JACKPOT_ROUND) {
      state.activeWedges[20] = state.jackpotClaimed
        ? { type:"money", label:"100", value:100, color:"#d9a514", dark:true }
        : { type:"jackpot", label:"BOTE", color:"#ffd23f", dark:true };
    }
    const slice = 360 / state.activeWedges.length;
    state.activeWedges.forEach((w, i) => {
      const display = getWheelDisplay(w, i);
      const wedgePath = arcPath(-i * slice, -(i + 1) * slice);
      const g = document.createElementNS(ns, "g");
      g.setAttribute("class", `wheel-wedge wheel-wedge--${w.type}`);
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", wedgePath);
      path.setAttribute("fill", display.fill);
      path.setAttribute("stroke", display.stroke);
      path.setAttribute("stroke-width", "1");
      path.dataset.wedge = i;
      path.classList.add("wheel-slice");
      g.appendChild(path);

      const sheen = document.createElementNS(ns, "path");
      sheen.setAttribute("d", wedgePath);
      sheen.setAttribute("fill", "url(#wheelSliceSheen)");
      sheen.setAttribute("pointer-events", "none");
      g.appendChild(sheen);

      const textAngle = -(i * slice + slice / 2);
      const text = document.createElementNS(ns, "text");
      const pos = polar(150, 150, display.special ? 105 : 110, textAngle);
      text.setAttribute("x", pos.x);
      text.setAttribute("y", pos.y);
      text.setAttribute("transform", `rotate(0 ${pos.x} ${pos.y})`);
      text.setAttribute("class", getWheelTextClass(w, display));
      text.style.fill = display.text;
      text.style.stroke = display.stroke;
      appendWheelText(text, display);
      g.appendChild(text);
      svg.appendChild(g);
    });
    const depth = document.createElementNS(ns, "circle");
    depth.setAttribute("cx", 150);
    depth.setAttribute("cy", 150);
    depth.setAttribute("r", 144);
    depth.setAttribute("fill", "url(#wheelOuterDepth)");
    depth.setAttribute("pointer-events", "none");
    svg.appendChild(depth);

    const outerGlow = document.createElementNS(ns, "circle");
    outerGlow.setAttribute("cx", 150);
    outerGlow.setAttribute("cy", 150);
    outerGlow.setAttribute("r", 146);
    outerGlow.setAttribute("fill", "none");
    outerGlow.setAttribute("stroke", "rgba(248,251,255,.92)");
    outerGlow.setAttribute("stroke-width", 5);
    svg.appendChild(outerGlow);

    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("cx", 150);
    ring.setAttribute("cy", 150);
    ring.setAttribute("r", 141);
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "rgba(38,88,246,.46)");
    ring.setAttribute("stroke-width", 2.4);
    svg.appendChild(ring);

    const hubShadow = document.createElementNS(ns, "circle");
    hubShadow.setAttribute("cx", 150);
    hubShadow.setAttribute("cy", 150);
    hubShadow.setAttribute("r", 39);
    hubShadow.setAttribute("fill", "rgba(6,16,45,.12)");
    svg.appendChild(hubShadow);

    for (let i = 0; i < 24; i++) {
      const dot = document.createElementNS(ns, "circle");
      const p = polar(150, 150, 145, i * 15 + 7.5);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("r", 2);
      dot.setAttribute("fill", i % 2 ? "#ffffff" : "#16c795");
      dot.setAttribute("opacity", ".92");
      svg.appendChild(dot);
    }
  }

  function highlightWedge(index) {
    document.querySelectorAll("#wheel .wheel-slice").forEach(p => {
      p.classList.remove("is-highlighted");
      p.style.filter = "";
    });
    const p = document.querySelector(`#wheel path[data-wedge="${index}"]`);
    if (p) p.classList.add("is-highlighted");
  }

  return { buildWheel, highlightWedge };
}
