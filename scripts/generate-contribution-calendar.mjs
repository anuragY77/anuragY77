#!/usr/bin/env node
/**
 * Generates assets/contribution-calendar.svg (cyberpunk heatmap) from GitHub GraphQL.
 * Env: GITHUB_TOKEN (required), GITHUB_REPOSITORY_OWNER or GITHUB_REPOSITORY (username).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OWNER =
  process.env.CONTRIB_USERNAME ||
  (process.env.GITHUB_REPOSITORY || "").split("/")[0] ||
  "anuragY77";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
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
const weeks = cal.weeks;
const year = new Date().getFullYear();

let yearTotal = 0;
let allTotal = 0;
for (const w of weeks) {
  for (const d of w.contributionDays) {
    allTotal += d.contributionCount;
    if (d.date.startsWith(String(year))) yearTotal += d.contributionCount;
  }
}

const COLORS = {
  NONE: "#161b22",
  FIRST_QUARTILE: "#0f3f47",
  SECOND_QUARTILE: "#177a87",
  THIRD_QUARTILE: "#22d3ee",
  FOURTH_QUARTILE: "#7df9ff",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// layout
const CW = 11; // cell
const GAP = 2;
const PITCH = CW + GAP;
const ROWS = 7;
const CAL_X = 76;
const CAL_Y = 92;
const panelW = 800;
const calW = weeks.length * PITCH;
const FOOT_Y = CAL_Y + ROWS * PITCH + 34;
const panelH = FOOT_Y + 28;
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// month labels: place when week's Sunday crosses into a new month
const monthLabels = [];
let prevMonth = -1;
weeks.forEach((w, wi) => {
  const first = w.contributionDays[0];
  const dt = new Date(first.date + "T00:00:00Z");
  const m = dt.getUTCMonth();
  if (m !== prevMonth) {
    monthLabels.push({ x: CAL_X + wi * PITCH, label: MONTHS[m] });
    prevMonth = m;
  }
});

// week columns (for staggered animation)
const columns = weeks
  .map((w, wi) => {
    const rects = w.contributionDays
      .map((d) => {
        const dow = new Date(d.date + "T00:00:00Z").getUTCDay(); // 0 Sun
        const row = (dow + 6) % 7; // Mon=0 … Sun=6
        const y = CAL_Y + row * PITCH;
        const x = CAL_X + wi * PITCH;
        const fill = COLORS[d.contributionLevel] || COLORS.NONE;
        const isHot =
          d.contributionLevel !== "NONE" && d.contributionLevel !== "FIRST_QUARTILE";
        const score = d.contributionCount > 0 ? ` data-score="${d.contributionCount}"` : "";
        return `<rect x="${x}" y="${y}" width="${CW}" height="${CW}" rx="2" fill="${fill}" stroke="#22d3ee" stroke-opacity="${
          d.contributionLevel === "NONE" ? 0.12 : 0.45
        }" stroke-width="0.8"${score} data-date="${d.date}">${
          isHot
            ? `<animate attributeName="opacity" values="0.4;1;0.75;1" dur="3s" begin="${(
                wi * 0.08
              ).toFixed(2)}s" repeatCount="indefinite"/>`
            : ""
        }</rect>`;
      })
      .join("");
    return `<g class="col">${rects}</g>`;
  })
  .join("\n    ");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${panelW} ${panelH}" width="${panelW}" height="${panelH}" role="img" aria-label="Contribution calendar: ${yearTotal} contributions in ${year}">
  <defs>
    <linearGradient id="cHead" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#56d4dd"/>
      <stop offset="55%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="cLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="50%" stop-color="#c084fc"/>
      <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
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
    .col { animation: colIn .6s ease-out both; }
    @keyframes colIn { from { opacity: 0; } to { opacity: 1; } }
  </style>

  <rect width="${panelW}" height="${panelH}" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${panelW - 1}" height="${panelH - 1}" fill="none" stroke="#22d3ee" stroke-opacity="0.4"/>

  <!-- header -->
  <circle cx="30" cy="30" r="5" fill="#3fb950" class="cDot" filter="url(#cGlowS)"/>
  <text class="mono" x="48" y="35" fill="#56d4dd" font-size="16" font-weight="700" letter-spacing="2" filter="url(#cGlow)">// CONTRIBUTION_GRID</text>
  <text class="mono" x="${panelW - 24}" y="35" text-anchor="end" fill="#c084fc" font-size="15" letter-spacing="1">
    <tspan class="cNum" fill="#7df9ff" font-size="22" font-weight="700" filter="url(#cGlow)">${yearTotal}</tspan>
    <tspan fill="#e6edf3"> contributions in ${year}</tspan>
  </text>
  <rect x="24" y="48" width="${panelW - 48}" height="2" fill="url(#cLine)" opacity="0.85"/>
  <text class="mono" x="24" y="68" fill="#8b949e" font-size="11">${allTotal} all-time &#183; live GraphQL<tspan class="cCur" fill="#56d4dd">_</tspan></text>
  <text class="mono" x="${panelW - 24}" y="68" text-anchor="end" fill="#56d4dd" font-size="11">@${OWNER}</text>

  <!-- month labels -->
  <g class="mono" fill="#8b949e" font-size="11">
    ${monthLabels.map((m) => `<text x="${m.x}" y="${CAL_Y - 10}">${m.label}</text>`).join("\n    ")}
  </g>

  <!-- day labels -->
  <g class="mono" fill="#8b949e" font-size="10" text-anchor="end">
    <text x="${CAL_X - 10}" y="${CAL_Y + 10}">Mon</text>
    <text x="${CAL_X - 10}" y="${CAL_Y + PITCH * 2 + 10}">Wed</text>
    <text x="${CAL_X - 10}" y="${CAL_Y + PITCH * 4 + 10}">Fri</text>
    <text x="${CAL_X - 10}" y="${CAL_Y + PITCH * 6 + 10}">Sun</text>
  </g>

  <!-- heatmap columns -->
  <g>
    ${columns}
  </g>

  <!-- scanning beam over calendar -->
  <rect x="${CAL_X - 4}" y="${CAL_Y - 4}" width="3" height="${ROWS * PITCH + 4}" fill="url(#cBeam)" opacity="0.55">
    <animate attributeName="x" values="${CAL_X - 4};${CAL_X + calW};${CAL_X - 4}" dur="8s" repeatCount="indefinite"/>
  </rect>

  <!-- legend + footer -->
  <g class="mono" font-size="10" fill="#8b949e">
    <text x="${panelW - 150}" y="${FOOT_Y + 4}">Less</text>
    ${["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"]
      .map(
        (lv, i) =>
          `<rect x="${panelW - 118 + i * 15}" y="${FOOT_Y - 7}" width="11" height="11" rx="2" fill="${COLORS[lv]}" stroke="#22d3ee" stroke-opacity="0.35"/>`
      )
      .join("\n    ")}
    <text x="${panelW - 38}" y="${FOOT_Y + 4}">More</text>
  </g>

  <text class="mono" x="24" y="${FOOT_Y + 4}" fill="#56d4dd" font-size="11">SYS:// contributionsCollection :: auto-refresh</text>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "contribution-calendar.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | year=${year} yearTotal=${yearTotal} allTime=${allTotal} weeks=${weeks.length} bytes=${svg.length}`
);
