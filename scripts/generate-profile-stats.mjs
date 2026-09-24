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
const H = 400;

const metrics = [
  { label: "COMMITS", value: commits12, note: "12 mo" },
  { label: "STARS EARNED", value: stars, note: "total" },
  { label: "PULL REQUESTS", value: prsAuthored, note: "opened" },
  { label: "ISSUES CLOSED", value: issuesClosed, note: "resolved" },
  { label: "REPOSITORIES", value: repos, note: "public" },
  { label: "FOLLOWERS", value: followers, note: "community" },
];

const metricCells = metrics
  .map((m, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 64 + col * 150;
    const y = 132 + row * 64;
    return `
  <g transform="translate(${x},${y})">
    <rect x="0" y="0" width="138" height="54" rx="4" fill="#ffffff" stroke="#141414" stroke-width="2.5"/>
    <rect x="0" y="0" width="6" height="54" fill="#e60012"/>
    <text class="disp" x="16" y="28" fill="#141414" font-size="26" letter-spacing="1">${m.value}</text>
    <text class="sans" x="16" y="44" fill="#e60012" font-size="8" font-weight="700" letter-spacing="0.8">${escapeXml(m.label)}</text>
    <text class="sans" x="130" y="16" text-anchor="end" fill="#141414" font-size="7" opacity=".5">${escapeXml(m.note)}</text>
  </g>`;
  })
  .join("");

const langRows = langPcts
  .map((l, i) => {
    const y = 136 + i * 26;
    const barW = 168;
    const fillW = Math.max(4, (l.pct / 100) * barW);
    return `
  <g transform="translate(536,${y})">
    <text class="sans" x="0" y="0" fill="#141414" font-size="11" font-weight="700">${escapeXml(l.name)}</text>
    <text class="disp" x="232" y="1" text-anchor="end" fill="#e60012" font-size="13">${l.pct.toFixed(1)}%</text>
    <rect x="0" y="6" width="${barW}" height="9" rx="3" fill="#ddd2b8" stroke="#141414" stroke-width="1.5"/>
    <rect x="0" y="6" width="${fillW.toFixed(1)}" height="9" rx="3" fill="${escapeXml(l.color || "#ff6a00")}" stroke="#141414" stroke-width="1.5"/>
  </g>`;
  })
  .join("");

const flamePulse = `
  <g transform="translate(340,324)" style="pointer-events:none">
    <circle r="28" fill="#fff7ed" stroke="#141414" stroke-width="3"/>
    <circle r="22" fill="none" stroke="#ff6a00" stroke-width="4" stroke-dasharray="${Math.min(130, currentStreak * 10)} 130" stroke-linecap="round" transform="rotate(-90)"/>
    <path class="pulse" d="M0,-15 C6,-9 9,-4 9,3 C9,9 5,15 0,15 C-5,15 -9,9 -9,3 C-9,-4 -6,-9 0,-15 Z" fill="#e60012" stroke="#141414" stroke-width="2"/>
    <path d="M0,-5 C3,-2 4,1 4,4 C4,7 2,9 0,9 C-2,9 -4,7 -4,4 C-4,1 -3,-2 0,-5 Z" fill="#ffd166"/>
    <text class="disp" x="44" y="2" fill="#ffd166" font-size="28">${currentStreak}</text>
    <text class="sans" x="44" y="22" fill="#f7f1e3" font-size="10" font-weight="700" letter-spacing="1.2">CURRENT STREAK</text>
  </g>`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Engineering profile for ${escapeXml(displayName)} — ${commits12} commits last year, ${stars} stars, streak ${currentStreak}">
  <defs>
    <pattern id="psTone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.1" fill="#141414" opacity=".07"/>
    </pattern>
    <pattern id="psLines" width="12" height="12" patternUnits="userSpaceOnUse">
      <line x1="0" y1="11.5" x2="12" y2="11.5" stroke="#141414" stroke-width="0.6" opacity=".12"/>
    </pattern>
    <filter id="psInk" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="3" dy="3" stdDeviation="0" flood-color="#000" flood-opacity="0.85"/>
    </filter>
    <clipPath id="psClip"><rect width="${W}" height="${H}" rx="0"/></clipPath>
  </defs>
  <style>
    .disp { font-family: Impact, "Arial Black", sans-serif; }
    .sans { font-family: "Segoe UI", Arial, sans-serif; }
    @keyframes psPulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
    @keyframes psSlash { from { stroke-dashoffset: 400; } to { stroke-dashoffset: 0; } }
    .pulse { animation: psPulse 2s ease-in-out infinite; }
    .slash { stroke-dasharray: 400; animation: psSlash 1.4s ease-out both; }
  </style>

  <g clip-path="url(#psClip)">
    <rect width="${W}" height="${H}" fill="#f7f1e3"/>
    <rect width="${W}" height="${H}" fill="url(#psTone)"/>

    <!-- manga speed lines (top-right impact frame) -->
    <g stroke="#141414" stroke-width="1.6" opacity=".14" stroke-linecap="round">
      <line x1="620" y1="8" x2="790" y2="22"/>
      <line x1="640" y1="28" x2="790" y2="38"/>
      <line x1="660" y1="48" x2="790" y2="54"/>
      <line x1="600" y1="68" x2="780" y2="70"/>
    </g>

    <!-- header -->
    <circle cx="34" cy="34" r="8" fill="#e60012" class="pulse"/>
    <text class="disp" x="54" y="42" fill="#141414" font-size="22" letter-spacing="1.5">ENGINEERING PROFILE</text>
    <text class="sans" x="${W - 28}" y="32" text-anchor="end" fill="#e60012" font-size="12" font-weight="700" font-style="italic">LIVE · auto-updating</text>
    <text class="sans" x="${W - 28}" y="50" text-anchor="end" fill="#141414" font-size="11" opacity=".7">${escapeXml(displayName)} · github.com/${escapeXml(u.login)}</text>
    <rect x="24" y="62" width="${W - 48}" height="5" fill="#141414"/>

    <!-- left panel: profile metrics -->
    <g filter="url(#psInk)">
      <rect x="24" y="82" width="476" height="176" rx="6" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
      <rect x="24" y="82" width="476" height="176" rx="6" fill="url(#psLines)"/>
      <rect x="24" y="82" width="476" height="28" fill="#141414"/>
      <text class="disp" x="62" y="101" fill="#f7f1e3" font-size="13" letter-spacing="2">PROFILE METRICS</text>
      <text class="sans" x="484" y="101" text-anchor="end" fill="#ffd166" font-size="10" font-weight="700">12-MONTH SNAPSHOT</text>
      <rect x="52" y="82" width="4" height="176" fill="#e60012" opacity=".85"/>
    </g>
    ${metricCells}

    <!-- right panel: languages -->
    <g filter="url(#psInk)">
      <rect x="516" y="82" width="260" height="176" rx="6" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
      <rect x="516" y="82" width="260" height="28" fill="#e60012"/>
      <text class="disp" x="532" y="101" fill="#ffffff" font-size="13" letter-spacing="2">TOP LANGUAGES</text>
      <text class="sans" x="768" y="101" text-anchor="end" fill="#ffe4d6" font-size="9" font-weight="700">by size</text>
    </g>
    ${langRows || `<text class="sans" x="536" y="140" fill="#141414" font-size="12" opacity=".6">No language data yet</text>`}

    <!-- bottom band: contribution consistency -->
    <g filter="url(#psInk)">
      <rect x="24" y="284" width="752" height="88" rx="6" fill="#141414"/>
      <rect x="24" y="284" width="8" height="88" fill="#e60012"/>
      <rect x="768" y="284" width="8" height="88" fill="#ff6a00"/>
    </g>

    <path class="slash" d="M48,360 L190,300" stroke="#e60012" stroke-width="3" opacity=".45" fill="none"/>
    <path class="slash" d="M620,300 L752,360" stroke="#ff6a00" stroke-width="3" opacity=".45" fill="none"/>

    <g transform="translate(56,308)">
      <text class="disp" x="0" y="30" fill="#ffd166" font-size="32">${totalContrib}</text>
      <text class="sans" x="0" y="48" fill="#f7f1e3" font-size="10" font-weight="700" letter-spacing="1.5">TOTAL CONTRIBUTIONS</text>
    </g>

    ${flamePulse}

    <g transform="translate(520,308)">
      <text class="disp" x="0" y="30" fill="#ffd166" font-size="32">${longestStreak}</text>
      <text class="sans" x="0" y="48" fill="#f7f1e3" font-size="10" font-weight="700" letter-spacing="1.5">LONGEST STREAK</text>
      <text class="sans" x="244" y="30" text-anchor="end" fill="#ff6a00" font-size="28" font-weight="700">${commits12}</text>
      <text class="sans" x="244" y="48" text-anchor="end" fill="#f7f1e3" font-size="10" font-weight="700" letter-spacing="1.5">COMMITS / 12 MO</text>
    </g>

    <!-- status stamp (between title and LIVE — no overlap) -->
    <g transform="translate(470,40) rotate(-10)" style="pointer-events:none">
      <rect x="-36" y="-15" width="72" height="30" rx="3" fill="none" stroke="#e60012" stroke-width="3"/>
      <rect x="-32" y="-11" width="64" height="22" rx="2" fill="none" stroke="#e60012" stroke-width="1.5"/>
      <text class="disp" x="0" y="5" text-anchor="middle" fill="#e60012" font-size="12" letter-spacing="2">ACTIVE</text>
    </g>
  </g>

  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="#141414" stroke-width="7"/>
</svg>
`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "profile-stats.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | commits12=${commits12} stars=${stars} prs=${prsAuthored} issues=${issuesClosed} repos=${repos} followers=${followers} total=${totalContrib} cur=${currentStreak} long=${longestStreak} langs=${langPcts.length} bytes=${svg.length}`
);
