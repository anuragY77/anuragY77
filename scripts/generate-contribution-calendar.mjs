#!/usr/bin/env node
/**
 * Generates assets/contribution-calendar.svg — GitHub-style FULL YEAR view (Jan–Dec)
 * in anime-showcase theme, from live GraphQL contribution data.
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
  NONE: "#ddd2b8",
  FIRST_QUARTILE: "#ffb380",
  SECOND_QUARTILE: "#ff7a1a",
  THIRD_QUARTILE: "#e60012",
  FOURTH_QUARTILE: "#9b0010",
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
const TRACK_H = 56; // Demon Slayer running lane
const FOOT_Y = CAL_Y + ROWS * PITCH + TRACK_H + 30;
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
        const strokeCol = "#141414";
        return `<rect x="${x}" y="${y}" width="${CW}" height="${CW}" rx="2" fill="${fill}" stroke="${strokeCol}" stroke-opacity="${
          level === "NONE" ? 0.45 : 0.85
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

/** Running lane with Tanjiro, Zenitsu, Inosuke (polished chibi side-view, SMIL translate). */
function demonSlayerTrack(x0, y0, w, h) {
  const groundY = y0 + h - 16;
  const lane = `<rect x="${x0}" y="${y0 + 4}" width="${w}" height="${h - 8}" rx="6" fill="#f7f1e3" stroke="#141414" stroke-width="2.5" opacity=".9"/>
    <line x1="${x0 + 6}" y1="${groundY}" x2="${x0 + w - 6}" y2="${groundY}" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
    <line x1="${x0 + 6}" y1="${groundY + 4}" x2="${x0 + w - 6}" y2="${groundY + 4}" stroke="#141414" stroke-width="1.5" stroke-dasharray="8 10" opacity=".5"/>
    <text class="disp" x="${x0 + 10}" y="${y0 + 18}" fill="#e60012" font-size="12" letter-spacing="2" opacity=".9">HASHIRA SPRINT</text>`;

  const start = x0 + 10;
  const end = x0 + w - 56;
  const runners = [
    { dur: "7.4s", begin: "0s", y: groundY - 6, scale: 1.6, svg: tanjiroChibi() },
    { dur: "6.4s", begin: "-2.4s", y: groundY - 6, scale: 1.55, svg: zenitsuChibi() },
    { dur: "5.8s", begin: "-4.6s", y: groundY - 6, scale: 1.55, svg: inosukeChibi() },
  ];

  const groups = runners
    .map(
      (r) => `  <g>
    <g>
      <animateTransform attributeName="transform" type="translate" values="${start},${r.y}; ${end},${r.y}" dur="${r.dur}" begin="${r.begin}" repeatCount="indefinite"/>
      <g transform="scale(${r.scale})">${r.svg}</g>
    </g>
  </g>`
    )
    .join("\n");

  return `  <!-- DS runners -->
  <g>
${lane}
${groups}
  </g>`;
}

function tanjiroChibi() {
  // Proper anime-style Tanjiro: detailed face, flowing hair, checkered haori, scar, earrings
  return `<g transform="translate(0,-38)">
    <g stroke="#141414" stroke-linecap="round" opacity=".5">
      <line x1="-32" y1="-6" x2="-58" y2="-8" stroke-width="2.5"/>
      <line x1="-30" y1="4" x2="-54" y2="4" stroke-width="2"/>
      <line x1="-28" y1="14" x2="-50" y2="16" stroke-width="1.5" opacity=".6"/>
      <line x1="-26" y1="22" x2="-46" y2="24" stroke-width="1.2" opacity=".4"/>
    </g>
    <!-- trailing leg -->
    <path d="M-2,18 Q-10,28 -18,33" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M-2,18 Q-10,28 -18,33" fill="none" stroke="#1c1c1c" stroke-width="4.5" stroke-linecap="round"/>
    <!-- front leg driving -->
    <path d="M4,18 Q15,26 24,22" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M4,18 Q15,26 24,22" fill="none" stroke="#2a2a2a" stroke-width="4.5" stroke-linecap="round"/>
    <!-- zori sandals -->
    <ellipse cx="-20" cy="35" rx="7.5" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="26" cy="23" rx="7.5" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <!-- uniform pants -->
    <path d="M-8,12 L10,12 L9,20 L-7,20 Z" fill="#1a1a1a" stroke="#141414" stroke-width="1.5"/>
    <!-- haori body -->
    <path d="M-10,-8 Q-13,6 -9,20 L11,20 Q15,4 12,-8 Q1,-14 -10,-8 Z" fill="#127a58" stroke="#141414" stroke-width="2.5"/>
    <!-- checker pattern -->
    <g fill="#141414">
      <rect x="-10" y="-8" width="7.5" height="7.5"/>
      <rect x="2" y="-8" width="7.5" height="7.5" opacity=".12"/>
      <rect x="-5" y="0" width="7.5" height="7.5" opacity=".88"/>
      <rect x="5" y="0" width="6.5" height="7.5" opacity=".18"/>
      <rect x="-9" y="8" width="7.5" height="7.5"/>
      <rect x="3" y="8" width="7.5" height="7.5" opacity=".15"/>
      <rect x="-4" y="14" width="7.5" height="6" opacity=".82"/>
    </g>
    <!-- white collar -->
    <path d="M-3,-10 L5,-10 L4,-3 L-2,-3 Z" fill="#f0ebe0" stroke="#141414" stroke-width="1.5"/>
    <!-- haori flap flowing -->
    <path d="M-10,-4 Q-24,2 -28,14 Q-17,9 -9,7 Z" fill="#127a58" stroke="#141414" stroke-width="2"/>
    <rect x="-24" y="1" width="7.5" height="7.5" fill="#141414"/>
    <rect x="-16" y="5" width="6.5" height="6.5" fill="#141414" opacity=".18"/>
    <!-- pumping arms -->
    <path d="M10,-4 Q22,2 26,-4" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M10,-4 Q22,2 26,-4" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="27" cy="-5" r="5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <path d="M-7,-2 Q-18,8 -15,0" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M-7,-2 Q-18,8 -15,0" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <!-- nichirin sword -->
    <g transform="rotate(-40 -5 -10)">
      <rect x="-9" y="-30" width="4.5" height="38" rx="1.5" fill="#141414"/>
      <rect x="-10" y="6" width="6.5" height="5.5" rx="1" fill="#e60012" stroke="#141414" stroke-width="1.4"/>
      <rect x="-10.5" y="11" width="7.5" height="7.5" rx="2" fill="#3d2b1f" stroke="#141414" stroke-width="1.4"/>
      <line x1="-6.5" y1="-28" x2="-6.5" y2="4" stroke="#2a2a2a" stroke-width="1"/>
    </g>
    <!-- anime face shape (oval with chin) -->
    <path d="M-8,-22 Q-9,-36 5,-37 Q19,-36 18,-22 Q18,-12 12,-8 Q5,-4 -1,-8 Q-7,-12 -8,-22 Z" fill="#f5c89a" stroke="#141414" stroke-width="2.4"/>
    <!-- ear -->
    <path d="M-8,-20 Q-12,-20 -12,-16 Q-12,-12 -8,-13" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <!-- hanafuda earring -->
    <g transform="translate(-1,-8)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="#141414" stroke-width="1.3"/>
      <rect x="-3.5" y="5" width="7" height="10" rx="1" fill="#ffffff" stroke="#141414" stroke-width="1.4"/>
      <circle cx="0" cy="9.5" r="2.2" fill="#e60012"/>
    </g>
    <!-- scar -->
    <path d="M9,-32 Q12,-28 10,-25 Q13,-26 13,-21" fill="none" stroke="#b03a2e" stroke-width="2.3" stroke-linecap="round"/>
    <!-- large anime eye -->
    <ellipse cx="13" cy="-22" rx="4.2" ry="5" fill="#ffffff" stroke="#141414" stroke-width="1.7"/>
    <circle cx="14" cy="-21.5" r="2.6" fill="#6b3a2a"/>
    <circle cx="14.8" cy="-22.8" r="1.1" fill="#ffffff"/>
    <circle cx="13.2" cy="-20" r="0.6" fill="#ffffff" opacity=".8"/>
    <!-- eyebrow -->
    <path d="M9,-29 Q13,-31 18,-29" fill="none" stroke="#141414" stroke-width="2.2" stroke-linecap="round"/>
    <!-- determined mouth -->
    <path d="M10,-14 Q14,-10 18,-15" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <!-- black spiky hair with green tips -->
    <path d="M-8,-26 Q-10,-40 3,-41 Q8,-48 14,-41 Q21,-46 21,-32 Q24,-38 22,-26 Q18,-34 11,-32 Q4,-36 -3,-31 Q-7,-34 -8,-26 Z" fill="#141414"/>
    <path d="M4,-43 L2,-52 L9,-43" fill="#141414"/>
    <path d="M13,-41 L15,-51 L19,-40" fill="#141414"/>
    <path d="M-3,-39 L-7,-48 L3,-40" fill="#141414"/>
    <path d="M18,-36 L22,-44 L22,-34" fill="#141414"/>
    <!-- subtle green hair tint -->
    <path d="M6,-44 L4,-50 L9,-44" fill="#1a5c40" opacity=".6"/>
    <path d="M15,-42 L17,-49 L20,-41" fill="#1a5c40" opacity=".5"/>
  </g>`;
}

function zenitsuChibi() {
  // Proper anime-style Zenitsu: detailed face, yellow triangle haori, screaming
  return `<g transform="translate(0,-38)">
    <g stroke="#141414" stroke-linecap="round" opacity=".5">
      <line x1="-34" y1="-4" x2="-60" y2="-6" stroke-width="2.5"/>
      <line x1="-32" y1="6" x2="-56" y2="6" stroke-width="2"/>
      <line x1="-30" y1="16" x2="-52" y2="18" stroke-width="1.5" opacity=".6"/>
      <line x1="-28" y1="24" x2="-48" y2="26" stroke-width="1.2" opacity=".4"/>
    </g>
    <!-- flailing legs -->
    <path d="M-2,18 Q-10,30 -16,34" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M-2,18 Q-10,30 -16,34" fill="none" stroke="#1d1d1d" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M5,18 Q15,28 24,26" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M5,18 Q15,28 24,26" fill="none" stroke="#2a2a2a" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="-18" cy="36" rx="7.5" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="26" cy="27" rx="7.5" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <!-- uniform pants -->
    <path d="M-8,12 L10,12 L9,20 L-7,20 Z" fill="#1a1a1a" stroke="#141414" stroke-width="1.5"/>
    <!-- haori body -->
    <path d="M-10,-8 Q-13,6 -9,20 L11,20 Q15,4 12,-8 Q1,-14 -10,-8 Z" fill="#f0b429" stroke="#141414" stroke-width="2.5"/>
    <!-- triangle pattern -->
    <g fill="#ffffff" stroke="#141414" stroke-width="1">
      <polygon points="-8,-5 -2,4 -8,4"/>
      <polygon points="1,-5 7,4 1,4"/>
      <polygon points="-5,6 1,15 -5,15"/>
      <polygon points="4,6 10,15 4,15"/>
      <polygon points="-7,12 -1,19 -7,19"/>
      <polygon points="3,12 9,19 3,19"/>
    </g>
    <!-- haori flap -->
    <path d="M-10,-4 Q-26,4 -28,16 Q-15,9 -9,7 Z" fill="#f0b429" stroke="#141414" stroke-width="2"/>
    <polygon points="-22,3 -16,11 -22,11" fill="#ffffff" stroke="#141414" stroke-width="1"/>
    <polygon points="-15,7 -9,15 -15,15" fill="#ffffff" stroke="#141414" stroke-width="1"/>
    <!-- flailing arms up -->
    <path d="M10,-6 Q24,-22 28,-10" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M10,-6 Q24,-22 28,-10" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="29" cy="-11" r="5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <path d="M-7,-4 Q-20,-18 -24,-6" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M-7,-4 Q-20,-18 -24,-6" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <circle cx="-25" cy="-7" r="5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <!-- anime face shape -->
    <path d="M-8,-22 Q-9,-36 5,-37 Q19,-36 18,-22 Q18,-12 12,-8 Q5,-4 -1,-8 Q-7,-12 -8,-22 Z" fill="#f5c89a" stroke="#141414" stroke-width="2.4"/>
    <!-- ear -->
    <path d="M-8,-20 Q-12,-20 -12,-16 Q-12,-12 -8,-13" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <!-- huge scared anime eyes -->
    <ellipse cx="13" cy="-23" rx="4.8" ry="5.8" fill="#ffffff" stroke="#141414" stroke-width="1.8"/>
    <circle cx="14" cy="-22" r="2.4" fill="#141414"/>
    <circle cx="15" cy="-23.5" r="1.1" fill="#ffffff"/>
    <ellipse cx="3" cy="-23" rx="4" ry="5" fill="#ffffff" stroke="#141414" stroke-width="1.6"/>
    <circle cx="3.5" cy="-22" r="2" fill="#141414"/>
    <circle cx="4.3" cy="-23.3" r="0.9" fill="#ffffff"/>
    <!-- arched panic brows -->
    <path d="M8,-31 Q13,-35 18,-31" fill="none" stroke="#141414" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M-1,-30 Q3,-33 7,-31" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <!-- screaming mouth -->
    <ellipse cx="12" cy="-14" rx="4.5" ry="5.5" fill="#5a1a1a" stroke="#141414" stroke-width="1.7"/>
    <ellipse cx="12" cy="-12" rx="2.8" ry="2.2" fill="#e86a6a"/>
    <!-- tears -->
    <path d="M17,-21 Q24,-16 22,-9" fill="none" stroke="#7ec8ff" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M0,-19 Q-7,-14 -4,-8" fill="none" stroke="#7ec8ff" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="22" cy="-8" r="2.2" fill="#7ec8ff" stroke="#4aa3d8" stroke-width="1"/>
    <circle cx="-4" cy="-7" r="1.8" fill="#7ec8ff" stroke="#4aa3d8" stroke-width="1"/>
    <!-- yellow-orange hair with blunt bangs -->
    <path d="M-8,-28 Q-10,-42 3,-43 Q8,-50 15,-42 Q22,-47 22,-32 Q25,-38 23,-26 Q19,-34 12,-34 L12,-28 L6,-33 L0,-28 L-5,-33 L-8,-28 Z" fill="#f5c211" stroke="#141414" stroke-width="2.2"/>
    <path d="M-8,-28 L-13,-18 L-5,-26" fill="#f5c211" stroke="#141414" stroke-width="1.5"/>
    <path d="M22,-28 L27,-18 L18,-26" fill="#f5c211" stroke="#141414" stroke-width="1.5"/>
    <path d="M5,-43 L3,-52 L10,-43" fill="#f5c211" stroke="#141414" stroke-width="1.5"/>
    <path d="M14,-42 L16,-51 L21,-41" fill="#f5c211" stroke="#141414" stroke-width="1.5"/>
  </g>`;
}

function inosukeChibi() {
  // Proper anime-style Inosuke: boar mask, bare torso, dual nichirins
  return `<g transform="translate(0,-40)">
    <g stroke="#141414" stroke-linecap="round" opacity=".5">
      <line x1="-34" y1="-2" x2="-62" y2="-4" stroke-width="2.5"/>
      <line x1="-32" y1="8" x2="-58" y2="8" stroke-width="2"/>
      <line x1="-30" y1="18" x2="-54" y2="20" stroke-width="1.5" opacity=".6"/>
      <line x1="-28" y1="26" x2="-50" y2="28" stroke-width="1.2" opacity=".4"/>
    </g>
    <!-- dual swords on back -->
    <g stroke-linecap="round">
      <line x1="-20" y1="-24" x2="16" y2="14" stroke="#141414" stroke-width="5.5"/>
      <line x1="-20" y1="-24" x2="16" y2="14" stroke="#9aa3b2" stroke-width="2.8"/>
      <line x1="-16" y1="16" x2="20" y2="-22" stroke="#141414" stroke-width="5.5"/>
      <line x1="-16" y1="16" x2="20" y2="-22" stroke="#9aa3b2" stroke-width="2.8"/>
      <line x1="-10" y1="-14" x2="-6" y2="-17" stroke="#141414" stroke-width="1.6"/>
      <line x1="0" y1="-5" x2="4" y2="-8" stroke="#141414" stroke-width="1.6"/>
      <line x1="8" y1="4" x2="12" y2="1" stroke="#141414" stroke-width="1.6"/>
    </g>
    <!-- bare muscular legs -->
    <path d="M-2,18 Q-10,30 -18,35" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M-2,18 Q-10,30 -18,35" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M5,18 Q17,26 26,22" fill="none" stroke="#141414" stroke-width="7.5" stroke-linecap="round"/>
    <path d="M5,18 Q17,26 26,22" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="-20" cy="37" rx="7.5" ry="3.5" fill="#c4a574" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="28" cy="23" rx="7.5" ry="3.5" fill="#c4a574" stroke="#141414" stroke-width="1.8"/>
    <!-- fur trunks -->
    <path d="M-9,10 L11,10 Q13,16 10,22 L-8,22 Q-11,16 -9,10 Z" fill="#5d4037" stroke="#141414" stroke-width="2.3"/>
    <path d="M-9,14 L-5,10 L0,15 L5,10 L9,15 L11,12 L11,18 L-9,18 Z" fill="#8d6e63"/>
    <!-- bare muscular torso -->
    <path d="M-10,-10 Q-13,2 -10,12 L12,12 Q15,0 12,-10 Q1,-16 -10,-10 Z" fill="#f5c89a" stroke="#141414" stroke-width="2.5"/>
    <!-- abs + pecs -->
    <path d="M1,-8 L1,12" stroke="#141414" stroke-width="1.7" opacity=".55"/>
    <path d="M-8,-3 Q1,2 10,-3" fill="none" stroke="#141414" stroke-width="1.6" opacity=".45"/>
    <path d="M-7,4 L9,4" stroke="#141414" stroke-width="1.4" opacity=".4"/>
    <path d="M-7,8 L9,8" stroke="#141414" stroke-width="1.4" opacity=".4"/>
    <!-- arms + swords -->
    <path d="M11,-6 Q26,4 32,-6" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M11,-6 Q26,4 32,-6" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <g transform="rotate(-22 32 -6)">
      <rect x="30" y="-30" width="5.5" height="34" rx="1.5" fill="#141414"/>
      <rect x="30.5" y="-28" width="4.5" height="30" fill="#9aa3b2"/>
      <path d="M32,-30 L37,-25 L32,-22 L37,-17 L32,-14" fill="none" stroke="#141414" stroke-width="1.6"/>
      <rect x="28.5" y="2" width="8" height="7" rx="1.5" fill="#3d2b1f" stroke="#141414" stroke-width="1.5"/>
    </g>
    <path d="M-8,-4 Q-20,8 -16,0" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M-8,-4 Q-20,8 -16,0" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <!-- boar mask -->
    <g transform="translate(7,-28)">
      <!-- fur ruff -->
      <path d="M-16,8 Q-20,-4 -11,-14 Q-4,-21 5,-19 Q16,-21 20,-9 Q22,1 15,10 Q4,16 -7,14 Z" fill="#c4b5a0" stroke="#141414" stroke-width="2.3"/>
      <!-- face plate -->
      <ellipse cx="5" cy="-3" rx="14" ry="12" fill="#e8dcc8" stroke="#141414" stroke-width="2.3"/>
      <!-- snout -->
      <ellipse cx="17" cy="0" rx="9" ry="8" fill="#f0c4b0" stroke="#141414" stroke-width="2.1"/>
      <ellipse cx="19" cy="-3" rx="2.2" ry="2.8" fill="#141414"/>
      <ellipse cx="21" cy="4" rx="1.8" ry="2.2" fill="#141414"/>
      <!-- angry eyes -->
      <path d="M-5,-7 L4,-3" stroke="#141414" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M8,-8 L14,-4" stroke="#141414" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="1" cy="-3" r="2.2" fill="#141414"/>
      <circle cx="11" cy="-3" r="2.2" fill="#141414"/>
      <!-- tusks -->
      <path d="M13,7 Q18,12 15,16" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>
      <path d="M13,7 Q18,12 15,16" fill="none" stroke="#141414" stroke-width="1.3"/>
      <path d="M13,7 Q16,10 14,13" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
      <!-- pink ears -->
      <path d="M-7,-14 L-14,-27 L0,-18 Z" fill="#f0a0b0" stroke="#141414" stroke-width="2.1"/>
      <path d="M7,-16 L9,-29 L16,-18 Z" fill="#f0a0b0" stroke="#141414" stroke-width="2.1"/>
      <!-- blue-black hair tuft -->
      <path d="M-5,-16 Q0,-27 7,-20 Q11,-27 14,-18" fill="#1a237e" stroke="#141414" stroke-width="1.7"/>
    </g>
  </g>`;
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${panelW} ${panelH}" width="${panelW}" height="${panelH}" role="img" aria-label="${yearTotal} contributions in ${YEAR}">
  <defs>
    <filter id="cGlowS" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="1.6"/>
    </filter>
  </defs>
  <style>
    .sans { font-family: "Segoe UI", Arial, sans-serif; }
    .disp { font-family: Impact, "Arial Black", sans-serif; }
    @keyframes cPulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
    .cDot { animation: cPulse 1.6s ease-in-out infinite; }
    .cNum { animation: cPulse 2.8s ease-in-out infinite; }
    @keyframes colIn { from { opacity: 0; } to { opacity: 1; } }
    .col { animation: colIn .5s ease-out both; }
  </style>

  <!-- manga paper page -->
  <rect width="${panelW}" height="${panelH}" fill="#f7f1e3"/>
  <rect x="3" y="3" width="${panelW - 6}" height="${panelH - 6}" fill="none" stroke="#141414" stroke-width="7"/>

  <!-- header -->
  <circle cx="34" cy="34" r="7" fill="#e60012" class="cDot"/>
  <text class="disp" x="52" y="42" fill="#141414" font-size="24" letter-spacing="1">
    <tspan class="cNum" fill="#e60012">${yearTotal}</tspan><tspan fill="#141414"> contributions in ${YEAR}</tspan>
  </text>
  <text class="sans" x="${panelW - 28}" y="38" text-anchor="end" fill="#e60012" font-size="14" font-style="italic" font-weight="700">Adventure log · ${OWNER}</text>
  <rect x="28" y="56" width="${panelW - 56}" height="5" fill="#141414"/>

  <!-- month labels -->
  <g class="sans" fill="#141414" font-size="12" font-weight="700" opacity=".75">
    ${monthLabels.map((l) => `<text x="${l.x}" y="${CAL_Y - 10}">${l.label}</text>`).join("\n    ")}
  </g>

  <!-- day labels -->
  <g class="sans" fill="#141414" font-size="11" text-anchor="end" opacity=".75">
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 1 + 9}">Mon</text>
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 3 + 9}">Wed</text>
    <text x="${CAL_X - 8}" y="${CAL_Y + PITCH * 5 + 9}">Fri</text>
  </g>

  <!-- heatmap -->
  <g>
    ${columns}
  </g>

  <!-- Demon Slayer running track: Tanjiro, Zenitsu, Inosuke -->
  ${demonSlayerTrack(CAL_X, CAL_Y + ROWS * PITCH + 6, panelW - CAL_X - 28, TRACK_H)}

  <!-- footer: legend -->
  <g class="sans" font-size="11" fill="#141414" font-weight="700">
    <text x="${panelW - 152}" y="${FOOT_Y + 4}">Less</text>
    ${["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"]
      .map(
        (lv, i) =>
          `<rect x="${panelW - 116 + i * 15}" y="${FOOT_Y - 7}" width="11" height="11" rx="2" fill="${COLORS[lv]}" stroke="#141414" stroke-width="1.5"/>`
      )
      .join("\n    ")}
    <text x="${panelW - 36}" y="${FOOT_Y + 4}">More</text>
  </g>
  <text class="sans" x="28" y="${FOOT_Y + 4}" fill="#e60012" font-size="13" font-style="italic" font-weight="700">Training arc ${YEAR} · ${allTotal} total · never give up</text>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "contribution-calendar.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | year=${YEAR} yearTotal=${yearTotal} allTime=${allTotal} cols=${weekCols.length} months=${monthLabels.length} bytes=${svg.length}`
);
