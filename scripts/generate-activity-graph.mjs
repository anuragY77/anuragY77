#!/usr/bin/env node
/**
 * Generates assets/activity-graph.svg — last-30-days contribution line graph
 * with Luffy reacting to the trend + per-point hover tooltips (manga paper style).
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
const DAYS = Number(process.env.GRAPH_DAYS) || 30;

if (!TOKEN) {
  console.error("GITHUB_TOKEN is required");
  process.exit(1);
}

const query = `
query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
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
    "User-Agent": "contrib-graph",
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
const allDays = cal.weeks.flatMap((w) => w.contributionDays);

// Local "today" (graph must always end on the real current date)
const now = new Date();
const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

const byDate = new Map(allDays.map((d) => [d.date, d]));
// If API's last day < local today, pad zero days so x-axis reaches today
if (allDays.length && allDays[allDays.length - 1].date < todayISO) {
  const end = new Date(todayISO + "T12:00:00");
  let cur = new Date(allDays[allDays.length - 1].date + "T12:00:00");
  cur.setDate(cur.getDate() + 1);
  while (cur <= end) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    if (!byDate.has(key)) {
      byDate.set(key, { date: key, contributionCount: 0 });
      allDays.push({ date: key, contributionCount: 0 });
    }
    cur.setDate(cur.getDate() + 1);
  }
}

const series = allDays.slice(-DAYS);

// stats
let maxV = 0;
let maxIdx = 0;
let total = 0;
series.forEach((d, i) => {
  total += d.contributionCount;
  if (d.contributionCount > maxV) {
    maxV = d.contributionCount;
    maxIdx = i;
  }
});
const last = series[series.length - 1]?.contributionCount ?? 0;
const prev = series[series.length - 2]?.contributionCount ?? 0;
const last3 = series.slice(-3).reduce((s, d) => s + d.contributionCount, 0);
const prev3 = series.slice(-6, -3).reduce((s, d) => s + d.contributionCount, 0);

const isPeak = last >= maxV && maxV > 0 && last > 0;
const isDown = last3 < prev3 || (last === 0 && prev === 0 && maxV > 0);
const isRising = last3 > prev3;

const peakQuote = `PEAK! ${last} commits today — One Piece is RIGHT THERE!`;
const downQuote = `Dip detected... next jump launches HARDER than the last peak of ${maxV}!`;
const riseQuote = `Climbing fast — ${last3} in 3 days. Grab the next summit!`;
const idleQuote = `Steady training. ${total} total — every commit sharpens the blade!`;
let mood = "idle";
if (isPeak) {
  mood = "peak";
} else if (isDown) {
  mood = "down";
} else if (isRising) {
  mood = "rise";
}

// layout — extra top room so quote banner sits BELOW header, ABOVE plot
const W = 800;
const H = 420;
const PAD_L = 56;
const PAD_R = 36;
const PAD_T = 152;
const PAD_B = 72;
const plotW = W - PAD_L - PAD_R;
const plotH = H - PAD_T - PAD_B;
const yMax = Math.max(maxV, 1);
const n = series.length;

const xAt = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
const yAt = (v) => PAD_T + plotH - (v / yMax) * plotH;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_W = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const parseLocal = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtShort = (iso) => {
  const d = parseLocal(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const fmtFull = (iso) => {
  const d = parseLocal(iso);
  return `${DAYS_W[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};

// range label for header — NO dates per user request
const rangeLabel = `last ${n} days`;

// polyline
const pts = series.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.contributionCount).toFixed(1)}`);
const line = pts.join(" ");

// area fill
const area =
  `M ${xAt(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)} ` +
  series.map((d, i) => `L ${xAt(i).toFixed(1)},${yAt(d.contributionCount).toFixed(1)}`).join(" ") +
  ` L ${xAt(n - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

// gridlines + y labels
const yTicks = [];
for (let v = 0; v <= yMax; v++) {
  const y = yAt(v);
  yTicks.push(
    `<line x1="${PAD_L}" y1="${y.toFixed(1)}" x2="${W - PAD_R}" y2="${y.toFixed(1)}" stroke="#141414" stroke-opacity=".12" stroke-dasharray="4 4"/>` +
      `<text x="${PAD_L - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="#141414" font-size="11" font-weight="700">${v}</text>`
  );
}

// x labels — NO dates on graph per user request; only a subtle day-index tick if needed
// (dates removed entirely; quote banner sits above the plot)
const xLabels = "";

// dynamic quote that exactly matches the graph shape/mood
const activeDays = series.filter((d) => d.contributionCount > 0).length;
const zeroRun = (() => {
  let run = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].contributionCount === 0) run++;
    else break;
  }
  return run;
})();
const shapeQuote = (() => {
  if (mood === "peak") return `PEAK HIT! ${last} commits today — the graph spikes RIGHT HERE. Grand Line closer!`;
  if (mood === "down") return `Dip at the end... ${zeroRun} quiet days. Next surge will SHATTER the last peak of ${maxV}!`;
  if (mood === "rise") return `Climbing hard — ${last3} in 3 days vs ${prev3} before. The line points UP!`;
  if (activeDays <= 5) return `Sparse training — only ${activeDays} active days. Next arc: fill the whole graph!`;
  if (total === 0) return `Flatline... zero commits. Time to break the silence and spike this graph!`;
  return `Steady blade — ${activeDays}/${n} days active, ${total} total. Every spike tells a story!`;
})();
let quote = shapeQuote;

// static dots + always-visible count labels for non-zero days (GitHub <img> has no hover)
const dots = series
  .map((d, i) => {
    const isToday = d.date === todayISO;
    const isMax = i === maxIdx && maxV > 0;
    const r = isToday || isMax ? 5.5 : 3.5;
    const fill = isToday ? "#e60012" : isMax ? "#e60012" : d.contributionCount > 0 ? "#ff6a00" : "#ddd2b8";
    let label = "";
    if (d.contributionCount > 0 && !isToday) {
      const ly = yAt(d.contributionCount) - 10;
      label = `<text class="disp" x="${xAt(i).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" fill="#e60012" font-size="9">${d.contributionCount}</text>`;
    }
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.contributionCount).toFixed(1)}" r="${r}" fill="${fill}" stroke="#141414" stroke-width="1.5"/>${label}`;
  })
  .join("");

// hover tooltips — count only, NO dates per user request
const tips = series
  .map((d, i) => {
    const x = xAt(i);
    const y = yAt(d.contributionCount);
    const count = d.contributionCount;
    const isToday = d.date === todayISO;
    const tipW = 140;
    const tipH = 40;
    let tipX = x - tipW / 2;
    tipX = Math.max(PAD_L + 2, Math.min(W - PAD_R - tipW - 2, tipX));
    let tipY = y - tipH - 14;
    if (tipY < PAD_T + 4) tipY = y + 12;
    const unit = count === 1 ? "contribution" : "contributions";
    const badge = isToday
      ? `<rect x="${tipW - 46}" y="6" width="40" height="14" rx="3" fill="#e60012"/><text class="disp" x="${tipW - 26}" y="16.5" text-anchor="middle" fill="#fff" font-size="8" letter-spacing="1">TODAY</text>`
      : "";
    const anchorX = tipX + tipW / 2;
    const anchorY = tipY + (tipY < y ? tipH : 0);
    const cls = isToday ? "hit always" : "hit";
    return `  <g class="${cls}">
    <line x1="${anchorX.toFixed(1)}" y1="${anchorY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#141414" stroke-width="1.5" stroke-dasharray="3 3" opacity=".5"/>
    <g transform="translate(${tipX.toFixed(1)},${tipY.toFixed(1)})" class="tip">
      <rect width="${tipW}" height="${tipH}" rx="8" fill="#ffffff" stroke="#141414" stroke-width="2.5"/>
      ${badge}
      <text class="disp" x="10" y="26" fill="#e60012" font-size="14">${count} <tspan fill="#141414" font-size="11">${unit}</tspan></text>
    </g>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent" stroke="none"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="none" stroke="transparent" stroke-width="2" class="ring"/>
  </g>`;
  })
  .join("");

// Luffy position: sits on max point (or last point)
const lx = xAt(maxV > 0 ? maxIdx : n - 1);
const ly = yAt(maxV > 0 ? maxV : last);

// quote banner sits between header divider (y=75) and plot top (PAD_T)
const quoteBannerW = Math.min(plotW - 8, 700);
const quoteBannerX = PAD_L + (plotW - quoteBannerW) / 2;
const quoteBannerY = 85;

const hatTilt = mood === "down" ? -6 : mood === "peak" ? 4 : 0;
const armUp = mood === "peak" || mood === "rise";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Contribution graph — ${total} contributions, no dates shown, quote banner above plot">
  <defs>
    <pattern id="agTone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.1" fill="#141414" opacity=".07"/>
    </pattern>
    <filter id="agInk" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="3" stdDeviation="0" flood-color="#000" flood-opacity="0.9"/>
    </filter>
  </defs>
  <style>
    .disp { font-family: Impact, "Arial Black", sans-serif; }
    .sans { font-family: "Segoe UI", Arial, sans-serif; }
    @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes pulse { 0%,100% { opacity:.55; } 50% { opacity:1; } }
    .bob { transform-box: fill-box; transform-origin: center; animation: bob 1.6s ease-in-out infinite; }
    .pulse { animation: pulse 2s ease-in-out infinite; }
    .draw { stroke-dasharray: 2000; stroke-dashoffset: 2000; animation: dash 2s ease-out forwards; }
    @keyframes dash { to { stroke-dashoffset: 0; } }
    /* status-graph hover tooltips — always show TODAY; others on hover */
    .hit .tip, .hit .ring { opacity: 0; transition: opacity .12s ease; }
    .hit.always .tip { opacity: 1; }
    .hit.always .ring { opacity: 1; stroke: #e60012; }
    .hit:hover .tip { opacity: 1; }
    .hit:hover .ring { opacity: 1; stroke: #e60012; }
    .hit { cursor: pointer; }
  </style>

  <rect width="${W}" height="${H}" fill="#f7f1e3"/>
  <rect width="${W}" height="${H}" fill="url(#agTone)"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="#141414" stroke-width="7"/>

  <!-- header -->
  <circle cx="32" cy="36" r="7" fill="#e60012" class="pulse"/>
  <text class="disp" x="50" y="44" fill="#141414" font-size="22" letter-spacing="1">
    <tspan fill="#e60012">${total}</tspan> contributions · ${escapeXml(rangeLabel)}
  </text>
  <text class="sans" x="${W - 28}" y="42" text-anchor="end" fill="#e60012" font-size="13" font-style="italic" font-weight="700">LIVE · auto-updating</text>
  <text class="sans" x="${W - 28}" y="62" text-anchor="end" fill="#141414" font-size="10" font-weight="700" opacity=".65">counts on bars · no dates shown</text>
  <rect x="24" y="70" width="${W - 48}" height="5" fill="#141414"/>

  <!-- QUOTE BANNER above graph — matches graph shape exactly -->
  <g filter="url(#agInk)" style="pointer-events:none">
    <rect x="${quoteBannerX.toFixed(1)}" y="${quoteBannerY.toFixed(1)}" width="${quoteBannerW.toFixed(1)}" height="48" rx="14" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
    <polygon points="${(quoteBannerX + quoteBannerW / 2 - 14).toFixed(1)},${(quoteBannerY + 48).toFixed(1)} ${(quoteBannerX + quoteBannerW / 2).toFixed(1)},${(quoteBannerY + 58).toFixed(1)} ${(quoteBannerX + quoteBannerW / 2 + 14).toFixed(1)},${(quoteBannerY + 48).toFixed(1)}" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
    <polygon points="${(quoteBannerX + quoteBannerW / 2 - 8).toFixed(1)},${(quoteBannerY + 46).toFixed(1)} ${(quoteBannerX + quoteBannerW / 2).toFixed(1)},${(quoteBannerY + 54).toFixed(1)} ${(quoteBannerX + quoteBannerW / 2 + 8).toFixed(1)},${(quoteBannerY + 46).toFixed(1)}" fill="#ffffff"/>
    <text class="disp" x="${(quoteBannerX + quoteBannerW / 2).toFixed(1)}" y="${(quoteBannerY + 20).toFixed(1)}" text-anchor="middle" fill="#141414" font-size="13" letter-spacing="0.5">${escapeXml(quote.split(" — ")[0])}</text>
    ${quote.includes(" — ") ? `<text class="sans" x="${(quoteBannerX + quoteBannerW / 2).toFixed(1)}" y="${(quoteBannerY + 38).toFixed(1)}" text-anchor="middle" fill="#e60012" font-size="12" font-style="italic" font-weight="700">${escapeXml(quote.split(" — ")[1])}</text>` : ""}
  </g>

  <!-- y ticks -->
  ${yTicks.join("\n  ")}

  <!-- area + line -->
  <path d="${area}" fill="#ff6a00" opacity=".14"/>
  <polyline class="draw" points="${line}" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>

  ${dots}
  ${xLabels}

  <text class="sans" x="${W / 2}" y="${H - 18}" text-anchor="middle" fill="#e60012" font-size="12" font-style="italic" font-weight="700">Days →</text>
  <text class="sans" x="16" y="${PAD_T + plotH / 2}" text-anchor="middle" fill="#e60012" font-size="12" font-style="italic" font-weight="700" transform="rotate(-90 16 ${PAD_T + plotH / 2})">Contributions</text>

  <!-- Luffy (non-interactive so tooltips work) -->
  <g class="bob" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})" style="pointer-events:none">
    <path d="M-10,4 Q-18,22 -14,34" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M10,4 Q18,22 14,34" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M-10,4 Q-18,22 -14,34" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M10,4 Q18,22 14,34" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <ellipse cx="-14" cy="36" rx="7" ry="4" fill="#c4a574" stroke="#141414" stroke-width="2"/>
    <ellipse cx="14" cy="36" rx="7" ry="4" fill="#c4a574" stroke="#141414" stroke-width="2"/>
    <path d="M-16,-4 L16,-4 L14,14 L4,8 L0,16 L-4,8 L-14,14 Z" fill="#1d4ed8" stroke="#141414" stroke-width="2.5"/>
    <path d="M-18,-30 Q-22,-8 -16,-2 L16,-2 Q22,-8 18,-30 Q0,-36 -18,-30 Z" fill="#e60012" stroke="#141414" stroke-width="2.5"/>
    <path d="M-6,-30 Q0,-16 6,-30" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    ${
      armUp
        ? `<path d="M-18,-24 Q-34,-40 -30,-52" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M-18,-24 Q-34,-40 -30,-52" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-30" cy="-54" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <path d="M18,-24 Q34,-40 30,-52" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M18,-24 Q34,-40 30,-52" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="30" cy="-54" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>`
        : `<path d="M-18,-22 Q-28,-8 -22,2" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M-18,-22 Q-28,-8 -22,2" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-22" cy="4" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <path d="M18,-22 Q30,-10 26,0" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M18,-22 Q30,-10 26,0" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="26" cy="2" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>`
    }
    <circle cx="0" cy="-44" r="18" fill="#f5c89a" stroke="#141414" stroke-width="2.5"/>
    <path d="M-8,-40 L-4,-36" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <circle cx="-6" cy="-46" r="2.2" fill="#141414"/>
    <circle cx="6" cy="-46" r="2.2" fill="#141414"/>
    ${
      mood === "peak" || mood === "rise"
        ? `<path d="M-8,-38 Q0,-30 8,-38" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
        : mood === "down"
          ? `<path d="M-7,-34 Q0,-40 7,-34" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
          : `<path d="M-7,-36 Q0,-30 7,-36" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
    }
    <path d="M-16,-52 Q-10,-62 -4,-54" fill="#141414"/>
    <path d="M-4,-56 Q2,-66 8,-56" fill="#141414"/>
    <path d="M8,-54 Q14,-62 18,-52" fill="#141414"/>
    <g transform="rotate(${hatTilt} 0 -54)">
      <ellipse cx="0" cy="-56" rx="34" ry="9" fill="#f5d76e" stroke="#141414" stroke-width="2.5"/>
      <path d="M-16,-56 Q-16,-76 0,-76 Q16,-76 16,-56" fill="#f5d76e" stroke="#141414" stroke-width="2.5"/>
      <path d="M-16,-60 Q0,-54 16,-60" fill="none" stroke="#e60012" stroke-width="4"/>
      <rect x="-16" y="-64" width="32" height="6" fill="#e60012" stroke="#141414" stroke-width="1.5"/>
    </g>
  </g>

  <!-- hover hit targets ON TOP of everything decorative -->
  <g id="hover-layer">
${tips}
  </g>

  <!-- mood badge -->
  <g transform="translate(${W - 120},${H - 40})" style="pointer-events:none">
    <rect x="-70" y="-16" width="140" height="32" rx="4" fill="${
      mood === "peak" ? "#e60012" : mood === "down" ? "#ff6a00" : "#141414"
    }" stroke="#141414" stroke-width="3"/>
    <text class="disp" x="0" y="6" text-anchor="middle" fill="#ffffff" font-size="14" letter-spacing="2">${
      mood === "peak" ? "PEAK JOY" : mood === "down" ? "WIND-UP" : mood === "rise" ? "CLIMBING" : "TRAINING"
    }</text>
  </g>
</svg>
`;

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, "..", "assets", "activity-graph.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg, "utf8");
console.log(
  `OK ${out} | days=${n} total=${total} max=${maxV}@${series[maxIdx]?.date} last=${series[n - 1]?.date} mood=${mood} tips=${n} quote="${quote}" bytes=${svg.length}`
);
