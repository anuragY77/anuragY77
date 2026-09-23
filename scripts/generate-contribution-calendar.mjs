#!/usr/bin/env node
/**
 * Generates assets/contribution-calendar.svg — GitHub-style FULL YEAR view (Jan–Dec)
 * in cyberpunk theme, from live GraphQL contribution data.
 * Env: GITHUB_TOKEN (required), CONTRIB_USERNAME or GITHUB_REPOSITORY (owner).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER =
  process.env.CONTRIB_USERNAME ||
  (process.env.GITHUB_REPOSITORY || "").split("/")[0] ||
  "anuragY77";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const YEAR = Number(process.env.CONTRIB_YEAR) || new Date().getFullYear();

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "contrib-calendar",
  },
  body: JSON.stringify({ query, variables: { login: OWNER } }),
});
if (!res.ok) {
  console.error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const payload = await res.json();
if (payload.errors) {
  console.error(JSON.stringify(payload.errors, null, 2));
  process.exit(1);
}

const cal = payload.data.user.contributionsCollection.contributionCalendar;

// date -> { count, level }
const byDate = new Map();
let yearTotal = 0;
let allTotal = 0;
for (const w of cal.weeks) {
  for (const d of w.contributionDays) {
    allTotal += d.contributionCount;
    byDate.set(d.date, d);
    if (d.date.startsWith(String(YEAR))) yearTotal += d.contributionCount;
  }
}

const COLORS = {
  NONE: "#16161f",
  FIRST_QUARTILE: "#3d2209",
  SECOND_QUARTILE: "#8a4b08",
  THIRD_QUARTILE: "#ff7a1a",
  FOURTH_QUARTILE: "#ffd166",
};
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const iso = (d) => d.toISOString().slice(0, 10);

// Full-year grid: Sunday on/before Jan 1 → Saturday on/after Dec 31 (GitHub layout)
const yearStart = new Date(Date.UTC(YEAR, 0, 1));
const yearEnd = new Date(Date.UTC(YEAR, 11, 31));
const gridStart = new Date(yearStart);
gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay()); // back to Sunday
const gridEnd = new Date(yearEnd);
gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay())); // forward to Saturday

const days = [];
for (let t = gridStart.getTime(); t <= gridEnd.getTime(); t += 86400000) {
  days.push(new Date(t));
}
// chunk into week columns (Sun..Sat)
const weekCols = [];
for (let i = 0; i < days.length; i += 7) weekCols.push(days.slice(i, i + 7));

// ---- layout: fit 53 weeks into 800px ----
const CW = 10;
const GAP = 3;
const PITCH = CW + GAP; // 13
const ROWS = 7;
const panelW = 800;
const CAL_X = 70;
const CAL_Y = 96;
const calW = weekCols.length * PITCH;
const FOOT_Y = CAL_Y + ROWS * PITCH + 36;
const panelH = FOOT_Y + 30;

// month labels: first week column containing that month's day 1 (or first col of month)
const monthLabels = [];
const seenMonth = new Set();
weekCols.forEach((week, wi) => {
  for (const d of week) {
    if (d.getUTCFullYear() !== YEAR) continue;
    const m = d.getUTCMonth();
    if (!seenMonth.has(m)) {
      seenMonth.add(m);
      monthLabels.push({ m, x: CAL_X + wi * PITCH, label: MONTHS[m] });
      break;
    }
  }
});
// ensure all 12 months present (even fallback spacing)
for (let m = 0; m < 12; m++) {
  if (!monthLabels.find((l) => l.m === m)) {
    const approxWeek = Math.floor(((m / 12) * calW) / PITCH);
    monthLabels.push({ m, x: CAL_X + approxWeek * PITCH, label: MONTHS[m] });
  }
}
monthLabels.sort((a, b) => a.m - b.m);

// week columns
const columns = weekCols
  .map((week, wi) => {
    const rects = week
      .map((date, row) => {
        const key = iso(date);
        const rec = byDate.get(key);
        const level = rec ? rec.contributionLevel : "NONE";
        const count = rec ? rec.contributionCount : 0;
        const fill = COLORS[level] || COLORS.NONE;
        const hot = level !== "NONE" && level !== "FIRST_QUARTILE";
        const score = count > 0 ? ` data-score="${count}"` : "";
        const x = CAL_X + wi * PITCH;
        const y = CAL_Y + row * PITCH;
        // dim cells outside the target year (spill weeks)
        const outside = date.getUTCFullYear() !== YEAR ? ' opacity="0.35"' : "";
        const strokeCol = level === "NONE" ? "#ffd166" : "#ff7a1a";
        return `<rect x="${x}" y="${y}" width="${CW}" height="${CW}" rx="2" fill="${fill}" stroke="${strokeCol}" stroke-opacity="${
          level === "NONE" ? 0.12 : 0.45
        }" stroke-width="0.8"${score} data-date="${key}"${outside}>${
          hot
            ? `<animate attributeName="opacity" values="0.45;1;0.75;1" dur="3s" begin="${(wi * 0.07).toFixed(2)}s" repeatCount="indefinite"/>`
            : ""
        }</rect>`;
      })
      .join("");
    return `<g class="col">${rects}</g>`;
  })
  .join("\n    ");

// GitHub row order: Sun top → Sat bottom; labels on Mon/Wed/Fri
// Our weeks are already Sun..Sat (index 0=Sun)
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${panelW} ${panelH}" width="${panelW}" height="${panelH}" role="img" aria-label="${yearTotal} contributions in ${YEAR}">
  <defs>
    <linearGradient id="cLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff7a1a"/>
      <stop offset="50%" stop-color="#ffd166"/>
      <stop offset="100%" stop-color="#ff3b5c" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="cBeam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="cGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="cGlowS" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="1.6" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <style>
    .mono { font-family: "Cascadia Code", Consolas, "Courier New", monospace; }
    @keyframes cPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes cBlink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
    .cDot { animation: cPulse 1.6s ease-in-out infinite; }
    .cCur { animation: cBlink 1s step-end infinite; }
    .cNum { animation: cPulse 2.8s ease-in-out infinite; }
    @keyframes colIn { from { opacity: 0; } to { opacity: 1; } }
    .col { animation: colIn .5s ease-out both; }
  </style>

  <rect width="${panelW}" height="${panelH}" fill="#0d0d14"/>
  <rect x="0.5" y="0.5" width="${panelW - 1}" height="${panelH - 1}" fill="none" stroke="#ffd166" stroke-opacity="0.45"/>

  <!-- header: GitHub-style title -->
  <circle cx="30" cy="32" r="5" fill="#ff3b5c" class="cDot" filter="url(#cGlowS)"/>
  <text class="mono" x="46" y="38" fill="#f0f0f5" font-size="20" font-weight="700" letter-spacing="1">
    <tspan class="cNum" fill="#ffd166" filter="url(#cGlow)">${yearTotal}</tspan><tspan> contributions in ${YEAR}</tspan>
  </text>
  <text class="mono" x="${panelW - 24}" y="36" text-anchor="end" fill="#ff7a1a" font-size="12" letter-spacing="2">// BOUNTY_GRID</text>
  <text class="mono" x="${panelW - 24}" y="54" text-anchor="end" fill="#2ec4b6" font-size="11">@${OWNER} &#183; live GraphQL<tspan class="cCur">_</tspan></text>
  <rect x="24" y="64" width="${panelW - 48}" height="2" fill="url(#cLine)" opacity="0.85"/>

  <!-- month labels: Jan..Dec -->
  <g class="mono" fill="#8b8b9a" font-size="11">
    ${monthLabels.map((l) => `<text x="${l.x}" y="${CAL_Y - 10}">${l.label}</text>`).join("\n    ")}
  </g>

  <!-- day labels (GitHub: Mon / Wed / Fri) — rows are Sun=0 … Sat=6 -->
  <g class="mono" fill="#8b8b9a" font-size="10" text-anchor="end">
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 1 + 9}">Mon</text>
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 3 + 9}">Wed</text>
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 5 + 9}">Fri</text>
  </g>

  <!-- heatmap -->
  <g>
    ${columns}
  </g>

  <!-- scanning beam -->
  <rect x="${CAL_X - 3}" y="${CAL_Y - 3}" width="3" height="${ROWS * PITCH + 3}" fill="url(#cBeam)" opacity="0.55">
    <animate attributeName="x" values="${CAL_X - 3};${CAL_X + calW};${CAL_X - 3}" dur="9s" repeatCount="indefinite"/>
  </rect>

  <!-- footer: legend -->
  <g class="mono" font-size="10" fill="#8b8b9a">
    <text x="${panelW - 148}" y="${FOOT_Y + 4}">Less</text>
    ${["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"]
      .map(
        (lv, i) =>
          `<rect x="${panelW - 116 + i * 15}" y="${FOOT_Y - 7}" width="11" height="11" rx="2" fill="${COLORS[lv]}" stroke="#ff7a1a" stroke-opacity="0.4"/>`
      )
      .join("\n    ")}
    <text x="${panelW - 36}" y="${FOOT_Y + 4}">More</text>
  </g>
  <text class="mono" x="24" y="${FOOT_Y + 4}" fill="#2ec4b6" font-size="11">MISSION LOG // ${YEAR} &#183; ${allTotal} all-time &#183; auto-refresh</text>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "contribution-calendar.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | year=${YEAR} yearTotal=${yearTotal} allTime=${allTotal} cols=${weekCols.length} months=${monthLabels.length} bytes=${svg.length}`
);
