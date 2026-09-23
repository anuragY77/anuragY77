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

/** Running lane with Tanjiro, Zenitsu, Inosuke (chibi side-view, SMIL translate). */
function demonSlayerTrack(x0, y0, w, h) {
  const groundY = y0 + h - 14;
  const lane = `<rect x="${x0}" y="${y0 + 4}" width="${w}" height="${h - 8}" rx="6" fill="#f7f1e3" stroke="#141414" stroke-width="2.5" opacity=".9"/>
    <line x1="${x0 + 6}" y1="${groundY}" x2="${x0 + w - 6}" y2="${groundY}" stroke="#141414" stroke-width="3" stroke-linecap="round"/>
    <line x1="${x0 + 6}" y1="${groundY + 4}" x2="${x0 + w - 6}" y2="${groundY + 4}" stroke="#141414" stroke-width="1.5" stroke-dasharray="8 10" opacity=".5"/>
    <text class="disp" x="${x0 + 10}" y="${y0 + 16}" fill="#e60012" font-size="11" letter-spacing="2" opacity=".85">HASHIRA SPRINT</text>`;

  // Each runner: nested static translate so SMIL on outer g works reliably.
  const start = x0 + 8;
  const end = x0 + w - 48;
  const runners = [
    {
      id: "tanjiroRun",
      dur: "7s",
      begin: "0s",
      y: groundY - 2,
      svg: tanjiroChibi(),
    },
    {
      id: "zenitsuRun",
      dur: "6.2s",
      begin: "-2.1s",
      y: groundY - 2,
      svg: zenitsuChibi(),
    },
    {
      id: "inosukeRun",
      dur: "5.6s",
      begin: "-4s",
      y: groundY - 2,
      svg: inosukeChibi(),
    },
  ];

  const groups = runners
    .map(
      (r) => `  <g>
    <g>
      <animateTransform attributeName="transform" type="translate" values="${start},${r.y}; ${end},${r.y}" dur="${r.dur}" begin="${r.begin}" repeatCount="indefinite"/>
      <g transform="translate(0,0)">${r.svg}</g>
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
  // side view running left→right; green/black checkered haori, scar, sword
  return `<g transform="translate(0,-28)">
    <!-- motion lines -->
    <line x1="-28" y1="6" x2="-48" y2="6" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".5"/>
    <line x1="-24" y1="14" x2="-44" y2="14" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".35"/>
    <!-- back leg -->
    <path d="M0,18 L-10,28 L-16,30" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M0,18 L-10,28 L-16,30" fill="none" stroke="#1a1a1a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- front leg -->
    <path d="M2,18 L12,26 L18,24" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M2,18 L12,26 L18,24" fill="none" stroke="#2a2a2a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- sandals -->
    <ellipse cx="-17" cy="31" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <ellipse cx="19" cy="25" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <!-- torso / haori checkered -->
    <path d="M-8,-4 L10,-4 L8,20 L-6,20 Z" fill="#141414" stroke="#141414" stroke-width="2"/>
    <path d="M-8,-4 L10,-4 L8,20 L-6,20 Z" fill="#0f7a5a"/>
    <!-- check pattern -->
    <g fill="#141414" opacity=".9">
      <rect x="-8" y="-4" width="7" height="8"/>
      <rect x="1" y="4" width="7" height="8"/>
      <rect x="-7" y="12" width="7" height="8"/>
      <rect x="2" y="-4" width="4" height="6" opacity=".4"/>
      <rect x="-3" y="0" width="7" height="6" opacity=".35"/>
    </g>
    <!-- arms pumping -->
    <path d="M8,0 L18,6 L22,2" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M8,0 L18,6 L22,2" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <path d="M-6,2 L-14,10 L-12,4" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M-6,2 L-14,10 L-12,4" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <!-- sword on back -->
    <line x1="-14" y1="-14" x2="8" y2="8" stroke="#141414" stroke-width="4" stroke-linecap="round"/>
    <line x1="-14" y1="-14" x2="8" y2="8" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round"/>
    <circle cx="-15" cy="-15" r="3" fill="#e60012" stroke="#141414" stroke-width="1.5"/>
    <!-- head -->
    <circle cx="4" cy="-16" r="11" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <!-- scar -->
    <path d="M7,-22 L11,-18" stroke="#c0392b" stroke-width="2" stroke-linecap="round"/>
    <!-- eye forward -->
    <circle cx="9" cy="-17" r="2" fill="#141414"/>
    <!-- determined mouth -->
    <path d="M7,-11 L12,-12" stroke="#141414" stroke-width="1.5" stroke-linecap="round"/>
    <!-- black hair -->
    <path d="M-6,-22 Q0,-34 8,-28 Q14,-32 15,-24 Q10,-30 4,-28 Q-2,-30 -6,-22 Z" fill="#141414"/>
    <!-- hair tuft -->
    <path d="M6,-30 L4,-36 L10,-31" fill="#141414"/>
  </g>`;
}

function zenitsuChibi() {
  // yellow hair, triangle haori, scared running
  return `<g transform="translate(0,-28)">
    <line x1="-30" y1="8" x2="-52" y2="8" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".5"/>
    <line x1="-26" y1="16" x2="-46" y2="16" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".35"/>
    <!-- legs -->
    <path d="M0,18 L-8,28 L-14,31" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M0,18 L-8,28 L-14,31" fill="none" stroke="#1d1d1d" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M3,18 L13,27 L20,26" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3,18 L13,27 L20,26" fill="none" stroke="#2a2a2a" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="-15" cy="32" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <ellipse cx="21" cy="27" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <!-- body / yellow haori -->
    <path d="M-8,-4 L10,-4 L8,20 L-6,20 Z" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <path d="M-8,-4 L10,-4 L8,20 L-6,20 Z" fill="#f0b429"/>
    <!-- triangle pattern -->
    <g fill="#141414" opacity=".85">
      <polygon points="-6,2 -2,8 -6,8"/>
      <polygon points="0,2 4,8 0,8"/>
      <polygon points="6,2 10,8 6,8"/>
      <polygon points="-3,10 1,16 -3,16"/>
      <polygon points="3,10 7,16 3,16"/>
    </g>
    <!-- flailing arms -->
    <path d="M8,-2 L20,-12 L24,-4" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M8,-2 L20,-12 L24,-4" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <path d="M-6,0 L-16,-10 L-20,-2" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M-6,0 L-16,-10 L-20,-2" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <!-- head -->
    <circle cx="4" cy="-16" r="11" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <!-- scared eyes -->
    <ellipse cx="8" cy="-18" rx="3" ry="3.5" fill="#ffffff" stroke="#141414" stroke-width="1.2"/>
    <circle cx="9" cy="-18" r="1.4" fill="#141414"/>
    <ellipse cx="2" cy="-18" rx="2.5" ry="3" fill="#ffffff" stroke="#141414" stroke-width="1.2"/>
    <circle cx="3" cy="-18" r="1.2" fill="#141414"/>
    <!-- screaming mouth -->
    <ellipse cx="8" cy="-11" rx="3" ry="4" fill="#141414"/>
    <!-- tears -->
    <path d="M12,-16 Q14,-10 12,-8" fill="none" stroke="#7ec8ff" stroke-width="2" stroke-linecap="round"/>
    <!-- yellow hair -->
    <path d="M-7,-24 Q-4,-34 4,-32 Q12,-36 16,-28 Q18,-32 16,-24 Q14,-30 8,-28 Q2,-32 -4,-28 Z" fill="#f0b429" stroke="#141414" stroke-width="1.5"/>
    <path d="M-7,-24 L-10,-18 L-4,-22" fill="#f0b429" stroke="#141414" stroke-width="1"/>
    <path d="M16,-24 L19,-18 L13,-22" fill="#f0b429" stroke="#141414" stroke-width="1"/>
  </g>`;
}

function inosukeChibi() {
  // boar mask, dual swords, bare torso
  return `<g transform="translate(0,-30)">
    <line x1="-30" y1="10" x2="-54" y2="10" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".5"/>
    <line x1="-26" y1="18" x2="-48" y2="18" stroke="#141414" stroke-width="2" stroke-linecap="round" opacity=".35"/>
    <!-- dual swords crossed on back -->
    <line x1="-16" y1="-20" x2="14" y2="10" stroke="#141414" stroke-width="4" stroke-linecap="round"/>
    <line x1="-16" y1="-20" x2="14" y2="10" stroke="#b0b7c3" stroke-width="2" stroke-linecap="round"/>
    <line x1="-14" y1="10" x2="16" y2="-18" stroke="#141414" stroke-width="4" stroke-linecap="round"/>
    <line x1="-14" y1="10" x2="16" y2="-18" stroke="#b0b7c3" stroke-width="2" stroke-linecap="round"/>
    <!-- legs -->
    <path d="M0,18 L-10,28 L-16,31" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M0,18 L-10,28 L-16,31" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M3,18 L14,26 L20,24" fill="none" stroke="#141414" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M3,18 L14,26 L20,24" fill="none" stroke="#f5c89a" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="-17" cy="32" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <ellipse cx="21" cy="25" rx="5" ry="3" fill="#c4a574" stroke="#141414" stroke-width="1.5"/>
    <!-- shorts -->
    <path d="M-8,6 L10,6 L9,20 L-7,20 Z" fill="#3d2b1f" stroke="#141414" stroke-width="2"/>
    <!-- bare muscular torso -->
    <path d="M-8,-6 L10,-6 L9,8 L-7,8 Z" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <!-- muscle lines -->
    <path d="M1,-6 L1,8" stroke="#141414" stroke-width="1.2" opacity=".5"/>
    <path d="M-6,-2 L8,-2" stroke="#141414" stroke-width="1.2" opacity=".35"/>
    <!-- arms with swords forward -->
    <path d="M8,-2 L22,4 L28,-2" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M8,-2 L22,4 L28,-2" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <line x1="24" y1="2" x2="40" y2="-6" stroke="#141414" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="24" y1="2" x2="40" y2="-6" stroke="#b0b7c3" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M-6,0 L-16,8 L-14,0" fill="none" stroke="#141414" stroke-width="5" stroke-linecap="round"/>
    <path d="M-6,0 L-16,8 L-14,0" fill="none" stroke="#f5c89a" stroke-width="3" stroke-linecap="round"/>
    <!-- boar mask -->
    <ellipse cx="6" cy="-18" rx="13" ry="11" fill="#e8d4c0" stroke="#141414" stroke-width="2"/>
    <!-- snout -->
    <ellipse cx="16" cy="-16" rx="7" ry="6" fill="#d4b8a0" stroke="#141414" stroke-width="2"/>
    <circle cx="18" cy="-17" r="1.5" fill="#141414"/>
    <circle cx="20" cy="-14" r="1.5" fill="#141414"/>
    <!-- angry eyes -->
    <path d="M0,-22 L6,-20" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <path d="M8,-22 L12,-20" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <circle cx="4" cy="-19" r="1.5" fill="#141414"/>
    <circle cx="11" cy="-19" r="1.5" fill="#141414"/>
    <!-- pink ears / fur tufts -->
    <path d="M-4,-26 L-8,-34 L0,-28" fill="#f0a0b0" stroke="#141414" stroke-width="1.5"/>
    <path d="M6,-28 L8,-36 L12,-30" fill="#f0a0b0" stroke="#141414" stroke-width="1.5"/>
    <!-- fur fringe -->
    <path d="M-6,-20 Q-12,-26 -6,-30 Q0,-34 4,-30" fill="#c4b5a0" stroke="#141414" stroke-width="1.5"/>
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
