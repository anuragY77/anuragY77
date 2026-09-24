#!/usr/bin/env node
/**
 * Generates assets/profile-stats.svg — live GitHub engineering profile
 * (metrics, languages, streak) in manga-paper style. Auto-refreshed by CI.
 * Env: GITHUB_TOKEN (required), CONTRIB_USERNAME or GITHUB_REPOSITORY.
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
    name
    login
    bio
    followers { totalCount }
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
    pullRequests(first: 1) { totalCount }
    issuesClosed: issues(first: 1, filterBy: { states: CLOSED }) { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
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
    "User-Agent": "profile-stats",
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

const u = payload.data.user;
const cc = u.contributionsCollection;
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

const now = new Date();
const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const byDate = new Map(days.map((d) => [d.date, d.contributionCount]));
if (!byDate.has(todayISO)) byDate.set(todayISO, 0);

const dates = [...byDate.keys()].sort();
let currentStreak = 0;
{
  let day = new Date(todayISO + "T12:00:00");
  if ((byDate.get(todayISO) ?? 0) === 0) day.setDate(day.getDate() - 1);
  for (;;) {
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if ((byDate.get(key) ?? 0) > 0) {
      currentStreak++;
      day.setDate(day.getDate() - 1);
    } else break;
  }
}
let longestStreak = 0;
let run = 0;
for (const key of dates) {
  if ((byDate.get(key) ?? 0) > 0) {
    run++;
    if (run > longestStreak) longestStreak = run;
  } else run = 0;
}

const commits12 = cc.totalCommitContributions;
const prsAuthored = u.pullRequests.totalCount;
const issuesClosed = u.issuesClosed.totalCount;
const repos = u.repositories.totalCount;
const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
const followers = u.followers.totalCount;
const totalContrib = days.reduce((s, d) => s + d.contributionCount, 0);
const displayName = u.name || u.login;

const langMap = new Map();
for (const r of u.repositories.nodes) {
  for (const e of r.languages.edges || []) {
    const name = e.node.name;
    const prev = langMap.get(name) || { size: 0, color: e.node.color || "#0d9488" };
    prev.size += e.size || 0;
    langMap.set(name, prev);
  }
}
const langs = [...langMap.entries()]
  .map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);
const langTotal = langs.reduce((s, l) => s + l.size, 0) || 1;
const langPcts = langs.map((l) => ({ ...l, pct: (l.size / langTotal) * 100 }));

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- layout ----
const W = 800;
const H = 420;

const zero = (v) => (v === 0);

// secondary metrics as clean rows (muted when zero)
const secondary = [
  { label: "Stars earned", value: stars },
  { label: "Pull requests", value: prsAuthored },
  { label: "Issues closed", value: issuesClosed },
  { label: "Public repositories", value: repos },
  { label: "Followers", value: followers },
];

const secRows = secondary
  .map((m, i) => {
    const y = 168 + i * 36;
    const dim = zero(m.value);
    return `
  <g transform="translate(250,${y})">
    <line x1="0" y1="-14" x2="230" y2="-14" stroke="#141414" stroke-opacity=".12" stroke-width="1"/>
    <text class="sans" x="0" y="6" fill="${dim ? "#141414" : "#141414"}" fill-opacity="${dim ? ".35" : ".75"}" font-size="13" font-weight="600">${escapeXml(m.label)}</text>
    <text class="disp" x="230" y="8" text-anchor="end" fill="${dim ? "#141414" : "#e60012"}" fill-opacity="${dim ? ".28" : "1"}" font-size="20">${m.value}</text>
  </g>`;
  })
  .join("");

// languages: single stacked ribbon + legend
const LANG_X = 530;
const LANG_Y = 148;
const LANG_W = 246;
const ribbon = (() => {
  let x = LANG_X;
  const h = 14;
  const parts = langPcts
    .map((l) => {
      const w = (l.pct / 100) * LANG_W;
      const seg = `<rect x="${x.toFixed(1)}" y="${LANG_Y}" width="${Math.max(w, 2).toFixed(1)}" height="${h}" fill="${escapeXml(l.color || "#ff6a00")}"/>`;
      x += w;
      return seg;
    })
    .join("");
  return `<rect x="${LANG_X}" y="${LANG_Y}" width="${LANG_W}" height="${h}" rx="7" fill="#ddd2b8"/>
    <g clip-path="url(#langClip)">${parts}</g>
    <rect x="${LANG_X}" y="${LANG_Y}" width="${LANG_W}" height="${h}" rx="7" fill="none" stroke="#141414" stroke-width="2"/>`;
})();

const langLegend = langPcts
  .map((l, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = LANG_X + col * 124;
    const y = LANG_Y + 40 + row * 34;
    return `
  <g transform="translate(${x},${y})">
    <circle cx="5" cy="-4" r="5" fill="${escapeXml(l.color || "#ff6a00")}" stroke="#141414" stroke-width="1.5"/>
    <text class="sans" x="16" y="0" fill="#141414" font-size="12" font-weight="700">${escapeXml(l.name)}</text>
    <text class="disp" x="16" y="16" fill="#e60012" font-size="13">${l.pct.toFixed(1)}%</text>
  </g>`;
  })
  .join("");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Engineering profile for ${escapeXml(displayName)} — ${commits12} commits last year, streak ${currentStreak}">
  <defs>
    <pattern id="psTone" width="6" height="6" patternUnits="userSpaceOnUse">
      <circle cx="1.5" cy="1.5" r="0.9" fill="#141414" opacity=".055"/>
    </pattern>
    <pattern id="psHatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="10" stroke="#e60012" stroke-width="1.2" opacity=".12"/>
    </pattern>
    <clipPath id="langClip">
      <rect x="${LANG_X}" y="${LANG_Y}" width="${LANG_W}" height="14" rx="7"/>
    </clipPath>
    <clipPath id="psClip"><rect width="${W}" height="${H}"/></clipPath>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#141414" flood-opacity=".12"/>
    </filter>
  </defs>
  <style>
    .disp { font-family: Impact, "Arial Black", sans-serif; }
    .sans { font-family: "Segoe UI", Arial, sans-serif; }
    .mono { font-family: "Consolas", "Courier New", monospace; }
    @keyframes psPulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
    .pulse { animation: psPulse 2.2s ease-in-out infinite; }
  </style>

  <g clip-path="url(#psClip)">
    <rect width="${W}" height="${H}" fill="#f7f1e3"/>
    <rect width="${W}" height="${H}" fill="url(#psTone)"/>

    <!-- left red rail -->
    <rect x="0" y="0" width="10" height="${H}" fill="#e60012"/>
    <rect x="10" y="0" width="3" height="${H}" fill="#141414"/>

    <!-- ghost number -->
    <text class="disp" x="195" y="310" text-anchor="middle" fill="#141414" fill-opacity=".045" font-size="200" letter-spacing="-6">${commits12}</text>

    <!-- corner registration marks -->
    <g stroke="#141414" stroke-width="1.5" opacity=".35">
      <path d="M28,28 h14 M28,28 v14"/>
      <path d="M${W - 28},28 h-14 M${W - 28},28 v14"/>
      <path d="M28,${H - 28} h14 M28,${H - 28} v-14"/>
      <path d="M${W - 28},${H - 28} h-14 M${W - 28},${H - 28} v-14"/>
    </g>

    <!-- hatch accent behind languages -->
    <rect x="${LANG_X - 12}" y="${LANG_Y - 48}" width="${LANG_W + 24}" height="210" fill="url(#psHatch)" rx="8"/>

    <!-- header -->
    <g>
      <rect x="40" y="36" width="8" height="36" fill="#e60012"/>
      <text class="disp" x="62" y="54" fill="#141414" font-size="26" letter-spacing="2">ENGINEERING PROFILE</text>
      <text class="sans" x="64" y="74" fill="#141414" fill-opacity=".55" font-size="12" font-weight="600" letter-spacing=".5">${escapeXml(displayName)} — github.com/${escapeXml(u.login)}</text>

      <!-- LIVE pill -->
      <g transform="translate(${W - 168},44)">
        <rect x="0" y="0" width="136" height="28" rx="14" fill="#141414"/>
        <circle cx="18" cy="14" r="5" fill="#e60012" class="pulse"/>
        <text class="sans" x="32" y="18" fill="#f7f1e3" font-size="11" font-weight="700" letter-spacing="1">LIVE · UPDATED</text>
      </g>
    </g>

    <line x1="40" y1="92" x2="${W - 40}" y2="92" stroke="#141414" stroke-width="3"/>

    <!-- HERO stat -->
    <g transform="translate(48,140)">
      <text class="mono" x="0" y="14" fill="#e60012" font-size="11" font-weight="700" letter-spacing="3">01 — VELOCITY</text>
      <text class="disp" x="0" y="92" fill="#141414" font-size="96" letter-spacing="-2">${commits12}</text>
      <text class="sans" x="4" y="118" fill="#141414" font-size="14" font-weight="700" letter-spacing="2">COMMITS · LAST 12 MONTHS</text>
      <rect x="4" y="130" width="120" height="4" fill="#e60012"/>
    </g>

    <!-- secondary metrics -->
    <g transform="translate(40,130)">
      <text class="mono" x="210" y="14" fill="#e60012" font-size="11" font-weight="700" letter-spacing="3">02 — LEDGER</text>
    </g>
    ${secRows}

    <!-- languages -->
    <g filter="url(#soft)">
      <rect x="${LANG_X - 16}" y="${LANG_Y - 60}" width="${LANG_W + 32}" height="230" rx="8" fill="#ffffff" stroke="#141414" stroke-width="2.5"/>
    </g>
    <text class="mono" x="${LANG_X}" y="${LANG_Y - 34}" fill="#e60012" font-size="11" font-weight="700" letter-spacing="3">03 — STACK</text>
    <text class="disp" x="${LANG_X}" y="${LANG_Y - 14}" fill="#141414" font-size="16" letter-spacing="1.5">TOP LANGUAGES</text>
    ${ribbon}
    ${langLegend || `<text class="sans" x="${LANG_X}" y="${LANG_Y + 50}" fill="#141414" fill-opacity=".5" font-size="12">No language data yet</text>`}

    <!-- footer streak band -->
    <g>
      <rect x="40" y="${H - 96}" width="${W - 80}" height="68" rx="6" fill="#141414"/>
      <rect x="40" y="${H - 96}" width="6" height="68" fill="#e60012"/>
      <!-- diagonal cut accent -->
      <polygon points="${W - 40 - 90},${H - 96} ${W - 40},${H - 96} ${W - 40},${H - 96 + 68} ${W - 40 - 40},${H - 96 + 68}" fill="#e60012" opacity=".9"/>
      <polygon points="${W - 40 - 70},${H - 96} ${W - 40 - 50},${H - 96} ${W - 40 - 10},${H - 96 + 68} ${W - 40 - 30},${H - 96 + 68}" fill="#ff6a00" opacity=".85"/>
    </g>

    <g transform="translate(64,${H - 52})">
      <text class="disp" x="0" y="4" fill="#ffd166" font-size="26">${totalContrib}</text>
      <text class="sans" x="0" y="22" fill="#f7f1e3" fill-opacity=".8" font-size="9" font-weight="700" letter-spacing="1.4">TOTAL CONTRIBUTIONS</text>
    </g>

    <g transform="translate(270,${H - 52})">
      <circle cx="10" cy="-4" r="14" fill="none" stroke="#ff6a00" stroke-width="3" stroke-dasharray="${Math.min(70, currentStreak * 8)} 70" transform="rotate(-90 10 -4)"/>
      <path class="pulse" d="M10,-14 C13,-9 16,-6 16,-1 C16,5 13,10 10,10 C7,10 4,5 4,-1 C4,-6 7,-9 10,-14 Z" fill="#e60012"/>
      <text class="disp" x="34" y="4" fill="#ffd166" font-size="26">${currentStreak}</text>
      <text class="sans" x="34" y="22" fill="#f7f1e3" fill-opacity=".8" font-size="9" font-weight="700" letter-spacing="1.4">CURRENT STREAK</text>
    </g>

    <g transform="translate(480,${H - 52})">
      <text class="disp" x="0" y="4" fill="#ffd166" font-size="26">${longestStreak}</text>
      <text class="sans" x="0" y="22" fill="#f7f1e3" fill-opacity=".8" font-size="9" font-weight="700" letter-spacing="1.4">LONGEST STREAK</text>
    </g>

    <!-- thin dividers in footer -->
    <line x1="250" y1="${H - 78}" x2="250" y2="${H - 40}" stroke="#f7f1e3" stroke-opacity=".2" stroke-width="1"/>
    <line x1="460" y1="${H - 78}" x2="460" y2="${H - 40}" stroke="#f7f1e3" stroke-opacity=".2" stroke-width="1"/>
  </g>

  <rect x="4" y="4" width="${W - 8}" height="${H - 8}" fill="none" stroke="#141414" stroke-width="8"/>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "profile-stats.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | commits12=${commits12} stars=${stars} prs=${prsAuthored} issues=${issuesClosed} repos=${repos} followers=${followers} total=${totalContrib} cur=${currentStreak} long=${longestStreak} langs=${langPcts.length} bytes=${svg.length}`
);
