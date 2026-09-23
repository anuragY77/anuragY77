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
    { dur: "7.4s", begin: "0s", y: groundY - 6, scale: 1.55, svg: tanjiroChibi() },
    { dur: "6.4s", begin: "-2.4s", y: groundY - 6, scale: 1.5, svg: zenitsuChibi() },
    { dur: "5.8s", begin: "-4.6s", y: groundY - 6, scale: 1.5, svg: inosukeChibi() },
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
  // Checkered green haori, forehead scar, hanafuda earrings, nichirin on back
  return `<g transform="translate(0,-34)">
    <!-- speed lines -->
    <g stroke="#141414" stroke-linecap="round" opacity=".55">
      <line x1="-30" y1="-4" x2="-54" y2="-6" stroke-width="2.5"/>
      <line x1="-28" y1="6" x2="-50" y2="6" stroke-width="2"/>
      <line x1="-26" y1="16" x2="-46" y2="18" stroke-width="1.5" opacity=".6"/>
    </g>
    <!-- back leg trailing -->
    <path d="M0,20 Q-8,30 -16,34" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M0,20 Q-8,30 -16,34" fill="none" stroke="#1c1c1c" stroke-width="4" stroke-linecap="round"/>
    <!-- front leg driving -->
    <path d="M3,20 Q14,28 22,24" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3,20 Q14,28 22,24" fill="none" stroke="#2a2a2a" stroke-width="4" stroke-linecap="round"/>
    <!-- zori sandals + tabi -->
    <ellipse cx="-18" cy="36" rx="7" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="24" cy="25" rx="7" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <!-- uniform pants peek -->
    <path d="M-7,14 L9,14 L8,22 L-6,22 Z" fill="#1a1a1a" stroke="#141414" stroke-width="1.5"/>
    <!-- haori body (green/black checkered) -->
    <path d="M-9,-6 Q-12,8 -8,20 L10,20 Q14,6 11,-6 Q1,-12 -9,-6 Z" fill="#127a58" stroke="#141414" stroke-width="2.4"/>
    <!-- checker squares -->
    <g fill="#141414">
      <rect x="-9" y="-6" width="7" height="7"/>
      <rect x="2" y="-6" width="7" height="7" opacity=".15"/>
      <rect x="-4" y="1" width="7" height="7" opacity=".9"/>
      <rect x="5" y="1" width="6" height="7" opacity=".2"/>
      <rect x="-8" y="8" width="7" height="7"/>
      <rect x="3" y="8" width="7" height="7" opacity=".18"/>
      <rect x="-3" y="14" width="7" height="6" opacity=".85"/>
    </g>
    <!-- white uniform collar under haori -->
    <path d="M-2,-8 L4,-8 L3,-2 L-1,-2 Z" fill="#f0ebe0" stroke="#141414" stroke-width="1.5"/>
    <!-- haori flap flowing back -->
    <path d="M-9,-2 Q-22,4 -26,14 Q-16,10 -8,8 Z" fill="#127a58" stroke="#141414" stroke-width="2"/>
    <rect x="-22" y="2" width="7" height="7" fill="#141414"/>
    <rect x="-15" y="6" width="6" height="6" fill="#141414" opacity=".2"/>
    <!-- arms pumping -->
    <path d="M9,-2 Q20,4 24,-2" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/>
    <path d="M9,-2 Q20,4 24,-2" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="25" cy="-3" r="4.5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <path d="M-6,0 Q-16,10 -13,2" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/>
    <path d="M-6,0 Q-16,10 -13,2" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <!-- nichirin sword on back (black blade, red tsuba) -->
    <g transform="rotate(-38 -4 -8)">
      <rect x="-8" y="-28" width="4" height="36" rx="1.5" fill="#141414" stroke="#0a0a0a" stroke-width="1"/>
      <rect x="-9" y="6" width="6" height="5" rx="1" fill="#e60012" stroke="#141414" stroke-width="1.4"/>
      <rect x="-9.5" y="11" width="7" height="7" rx="2" fill="#3d2b1f" stroke="#141414" stroke-width="1.4"/>
      <line x1="-6" y1="-26" x2="-6" y2="4" stroke="#2a2a2a" stroke-width="1"/>
    </g>
    <!-- head -->
    <circle cx="5" cy="-20" r="13" fill="#f5c89a" stroke="#141414" stroke-width="2.3"/>
    <!-- hanafuda earring -->
    <g transform="translate(1,-6)">
      <line x1="0" y1="0" x2="0" y2="5" stroke="#141414" stroke-width="1.2"/>
      <rect x="-3" y="5" width="6" height="9" rx="1" fill="#ffffff" stroke="#141414" stroke-width="1.3"/>
      <circle cx="0" cy="9" r="2" fill="#e60012"/>
    </g>
    <!-- scar (real shape) -->
    <path d="M8,-30 Q11,-27 9,-24 Q12,-25 12,-21" fill="none" stroke="#b03a2e" stroke-width="2.2" stroke-linecap="round"/>
    <!-- determined eye (large anime eye) -->
    <ellipse cx="12" cy="-21" rx="3.6" ry="4.2" fill="#ffffff" stroke="#141414" stroke-width="1.6"/>
    <circle cx="13" cy="-20.5" r="2.2" fill="#6b3a2a"/>
    <circle cx="13.6" cy="-21.5" r="0.9" fill="#ffffff"/>
    <!-- eyebrow -->
    <path d="M8,-27 Q12,-29 16,-27" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <!-- determined grin -->
    <path d="M9,-13 Q13,-9 17,-14" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <!-- black hair with green-tinted spikes -->
    <path d="M-7,-24 Q-8,-36 2,-36 Q6,-42 12,-36 Q18,-40 19,-30 Q22,-34 20,-24 Q16,-30 10,-28 Q4,-32 -2,-28 Q-6,-30 -7,-24 Z" fill="#141414"/>
    <path d="M4,-38 L2,-46 L8,-38" fill="#141414"/>
    <path d="M12,-36 L14,-44 L17,-35" fill="#141414"/>
    <path d="M-3,-34 L-6,-41 L2,-35" fill="#141414"/>
  </g>`;
}

function zenitsuChibi() {
  // Yellow triangle haori, orange-yellow hair, screaming while running
  return `<g transform="translate(0,-34)">
    <g stroke="#141414" stroke-linecap="round" opacity=".55">
      <line x1="-32" y1="-2" x2="-56" y2="-4" stroke-width="2.5"/>
      <line x1="-30" y1="8" x2="-52" y2="8" stroke-width="2"/>
      <line x1="-28" y1="18" x2="-48" y2="20" stroke-width="1.5" opacity=".6"/>
    </g>
    <!-- legs (stubby, flailing run) -->
    <path d="M0,20 Q-8,32 -14,35" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M0,20 Q-8,32 -14,35" fill="none" stroke="#1d1d1d" stroke-width="4" stroke-linecap="round"/>
    <path d="M4,20 Q14,30 22,28" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M4,20 Q14,30 22,28" fill="none" stroke="#2a2a2a" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="-16" cy="37" rx="7" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="24" cy="29" rx="7" ry="3.5" fill="#e8c49a" stroke="#141414" stroke-width="1.8"/>
    <!-- uniform pants -->
    <path d="M-7,14 L9,14 L8,22 L-6,22 Z" fill="#1a1a1a" stroke="#141414" stroke-width="1.5"/>
    <!-- haori body -->
    <path d="M-9,-6 Q-12,8 -8,20 L10,20 Q14,6 11,-6 Q1,-12 -9,-6 Z" fill="#f0b429" stroke="#141414" stroke-width="2.4"/>
    <!-- triangle pattern -->
    <g fill="#ffffff" stroke="#141414" stroke-width="1">
      <polygon points="-7,-3 -2,5 -7,5"/>
      <polygon points="1,-3 6,5 1,5"/>
      <polygon points="-4,7 1,15 -4,15"/>
      <polygon points="4,7 9,15 4,15"/>
      <polygon points="-6,13 -1,19 -6,19"/>
      <polygon points="3,13 8,19 3,19"/>
    </g>
    <!-- haori flap back -->
    <path d="M-9,-2 Q-24,6 -26,16 Q-14,10 -8,8 Z" fill="#f0b429" stroke="#141414" stroke-width="2"/>
    <polygon points="-20,4 -15,11 -20,11" fill="#ffffff" stroke="#141414" stroke-width="1"/>
    <polygon points="-14,8 -9,15 -14,15" fill="#ffffff" stroke="#141414" stroke-width="1"/>
    <!-- flailing arms up (panicked) -->
    <path d="M9,-4 Q22,-18 26,-8" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/>
    <path d="M9,-4 Q22,-18 26,-8" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="27" cy="-9" r="4.5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <path d="M-6,-2 Q-18,-16 -22,-6" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round"/>
    <path d="M-6,-2 Q-18,-16 -22,-6" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="-23" cy="-7" r="4.5" fill="#f5c89a" stroke="#141414" stroke-width="1.8"/>
    <!-- head -->
    <circle cx="5" cy="-20" r="13" fill="#f5c89a" stroke="#141414" stroke-width="2.3"/>
    <!-- huge scared eyes -->
    <ellipse cx="12" cy="-22" rx="4.2" ry="5" fill="#ffffff" stroke="#141414" stroke-width="1.7"/>
    <circle cx="13" cy="-21" r="2" fill="#141414"/>
    <circle cx="13.8" cy="-22.5" r="0.9" fill="#ffffff"/>
    <ellipse cx="3" cy="-22" rx="3.4" ry="4.2" fill="#ffffff" stroke="#141414" stroke-width="1.5"/>
    <circle cx="3.5" cy="-21" r="1.7" fill="#141414"/>
    <!-- arched panic brows -->
    <path d="M7,-29 Q12,-33 17,-29" fill="none" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <path d="M0,-28 Q3,-31 6,-29" fill="none" stroke="#141414" stroke-width="1.8" stroke-linecap="round"/>
    <!-- screaming mouth -->
    <ellipse cx="11" cy="-13" rx="4" ry="5" fill="#5a1a1a" stroke="#141414" stroke-width="1.6"/>
    <ellipse cx="11" cy="-11" rx="2.5" ry="2" fill="#e86a6a"/>
    <!-- tears streaming back -->
    <path d="M16,-20 Q22,-16 20,-10" fill="none" stroke="#7ec8ff" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M0,-18 Q-6,-14 -3,-9" fill="none" stroke="#7ec8ff" stroke-width="2" stroke-linecap="round"/>
    <circle cx="20" cy="-9" r="2" fill="#7ec8ff" stroke="#4aa3d8" stroke-width="1"/>
    <!-- bright yellow-orange hair, blunt bangs -->
    <path d="M-7,-26 Q-9,-38 2,-38 Q6,-44 13,-37 Q20,-40 20,-28 Q22,-33 20,-24 Q16,-30 10,-30 L10,-26 L5,-30 L0,-26 L-4,-30 L-7,-26 Z" fill="#f5c211" stroke="#141414" stroke-width="2"/>
    <path d="M-7,-26 L-11,-18 L-4,-24" fill="#f5c211" stroke="#141414" stroke-width="1.4"/>
    <path d="M20,-26 L24,-18 L16,-24" fill="#f5c211" stroke="#141414" stroke-width="1.4"/>
    <path d="M4,-38 L2,-46 L9,-38" fill="#f5c211" stroke="#141414" stroke-width="1.4"/>
  </g>`;
}

function inosukeChibi() {
  // Boar mask, bare torso, dual serrated nichirins, fur trunks
  return `<g transform="translate(0,-36)">
    <g stroke="#141414" stroke-linecap="round" opacity=".55">
      <line x1="-32" y1="0" x2="-58" y2="-2" stroke-width="2.5"/>
      <line x1="-30" y1="10" x2="-54" y2="10" stroke-width="2"/>
      <line x1="-28" y1="20" x2="-50" y2="22" stroke-width="1.5" opacity=".6"/>
    </g>
    <!-- dual swords crossed on back -->
    <g stroke-linecap="round">
      <line x1="-18" y1="-22" x2="14" y2="12" stroke="#141414" stroke-width="5"/>
      <line x1="-18" y1="-22" x2="14" y2="12" stroke="#9aa3b2" stroke-width="2.5"/>
      <line x1="-14" y1="14" x2="18" y2="-20" stroke="#141414" stroke-width="5"/>
      <line x1="-14" y1="14" x2="18" y2="-20" stroke="#9aa3b2" stroke-width="2.5"/>
      <!-- serration ticks -->
      <line x1="-8" y1="-12" x2="-5" y2="-14" stroke="#141414" stroke-width="1.5"/>
      <line x1="0" y1="-4" x2="3" y2="-6" stroke="#141414" stroke-width="1.5"/>
      <line x1="6" y1="4" x2="9" y2="2" stroke="#141414" stroke-width="1.5"/>
    </g>
    <!-- legs (bare, muscular) -->
    <path d="M0,20 Q-8,32 -16,36" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M0,20 Q-8,32 -16,36" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <path d="M4,20 Q16,28 24,24" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M4,20 Q16,28 24,24" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="-18" cy="38" rx="7" ry="3.5" fill="#c4a574" stroke="#141414" stroke-width="1.8"/>
    <ellipse cx="26" cy="25" rx="7" ry="3.5" fill="#c4a574" stroke="#141414" stroke-width="1.8"/>
    <!-- fur trunks -->
    <path d="M-8,10 L10,10 Q12,16 9,22 L-7,22 Q-10,16 -8,10 Z" fill="#5d4037" stroke="#141414" stroke-width="2.2"/>
    <path d="M-8,14 L-4,10 L0,15 L4,10 L8,15 L10,12 L10,18 L-8,18 Z" fill="#8d6e63"/>
    <!-- bare muscular torso -->
    <path d="M-9,-8 Q-12,2 -9,12 L11,12 Q14,0 11,-8 Q1,-14 -9,-8 Z" fill="#f5c89a" stroke="#141414" stroke-width="2.4"/>
    <!-- abs + pecs -->
    <path d="M1,-6 L1,12" stroke="#141414" stroke-width="1.6" opacity=".55"/>
    <path d="M-7,-2 Q1,2 9,-2" fill="none" stroke="#141414" stroke-width="1.5" opacity=".45"/>
    <path d="M-6,4 L8,4" stroke="#141414" stroke-width="1.3" opacity=".4"/>
    <path d="M-6,8 L8,8" stroke="#141414" stroke-width="1.3" opacity=".4"/>
    <!-- arms + forward swords -->
    <path d="M10,-4 Q24,4 30,-4" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M10,-4 Q24,4 30,-4" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <g transform="rotate(-20 30 -4)">
      <rect x="28" y="-26" width="5" height="30" rx="1.5" fill="#141414"/>
      <rect x="28.5" y="-24" width="4" height="26" fill="#9aa3b2"/>
      <path d="M30,-26 L34,-22 L30,-20 L34,-16 L30,-14" fill="none" stroke="#141414" stroke-width="1.5"/>
      <rect x="27" y="2" width="7" height="6" rx="1.5" fill="#3d2b1f" stroke="#141414" stroke-width="1.5"/>
    </g>
    <path d="M-7,-2 Q-18,8 -14,0" fill="none" stroke="#141414" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M-7,-2 Q-18,8 -14,0" fill="none" stroke="#f5c89a" stroke-width="4" stroke-linecap="round"/>
    <!-- boar mask (Kamado-style boar head) -->
    <g transform="translate(6,-24)">
      <!-- fur ruff -->
      <path d="M-14,6 Q-18,-4 -10,-12 Q-4,-18 4,-16 Q14,-18 18,-8 Q20,0 14,8 Q4,14 -6,12 Z" fill="#c4b5a0" stroke="#141414" stroke-width="2.2"/>
      <!-- face plate -->
      <ellipse cx="4" cy="-2" rx="13" ry="11" fill="#e8dcc8" stroke="#141414" stroke-width="2.2"/>
      <!-- snout -->
      <ellipse cx="15" cy="0" rx="8" ry="7" fill="#f0c4b0" stroke="#141414" stroke-width="2"/>
      <ellipse cx="17" cy="-2" rx="2" ry="2.5" fill="#141414"/>
      <ellipse cx="19" cy="3" rx="1.6" ry="2" fill="#141414"/>
      <!-- angry eyes -->
      <path d="M-4,-6 L4,-3" stroke="#141414" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M7,-7 L13,-4" stroke="#141414" stroke-width="2.4" stroke-linecap="round"/>
      <circle cx="1" cy="-2" r="2" fill="#141414"/>
      <circle cx="10" cy="-2" r="2" fill="#141414"/>
      <!-- tusks -->
      <path d="M12,6 Q16,10 14,14" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M12,6 Q16,10 14,14" fill="none" stroke="#141414" stroke-width="1.2"/>
      <!-- pink boar ears -->
      <path d="M-6,-12 L-12,-24 L0,-16 Z" fill="#f0a0b0" stroke="#141414" stroke-width="2"/>
      <path d="M6,-14 L8,-26 L14,-16 Z" fill="#f0a0b0" stroke="#141414" stroke-width="2"/>
      <!-- blue-black hair tuft on top -->
      <path d="M-4,-14 Q0,-24 6,-18 Q10,-24 12,-16" fill="#1a237e" stroke="#141414" stroke-width="1.6"/>
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
