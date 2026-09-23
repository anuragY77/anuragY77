#!/usr/bin/env node
/**
 * Generates assets/activity-graph.svg — last-30-days contribution line graph
 * with Monkey D. Luffy reacting to the trend (manga paper style).
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

// trend: down if recent cooling, peak if last days strong / at max
const isPeak = last >= maxV && maxV > 0 && last > 0;
const isDown = last3 < prev3 || (last === 0 && prev === 0 && maxV > 0);
const isRising = last3 > prev3;

// quotes
const peakQuote = "BEST DAY YET! I can almost taste the One Piece — pure joy!";
const downQuote = "A dip just winds up the rubber... NEXT JUMP GOES HIGHER!";
const riseQuote = "We're climbing! Grab the next peak — I'm all in!";
const idleQuote = "Every commit is training. Watch me launch!";
let mood = "idle";
let quote = idleQuote;
if (isPeak) {
  mood = "peak";
  quote = peakQuote;
} else if (isDown) {
  mood = "down";
  quote = downQuote;
} else if (isRising) {
  mood = "rise";
  quote = riseQuote;
}

// layout
const W = 800;
const H = 340;
const PAD_L = 56;
const PAD_R = 36;
const PAD_T = 88;
const PAD_B = 72;
const plotW = W - PAD_L - PAD_R;
const plotH = H - PAD_T - PAD_B;
const yMax = Math.max(maxV, 1);
const n = series.length;

const xAt = (i) => PAD_L + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
const yAt = (v) => PAD_T + plotH - (v / yMax) * plotH;

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

// x labels (every ~5 days)
const xLabels = series
  .map((d, i) => {
    if (i % 5 !== 0 && i !== n - 1) return "";
    const day = d.date.slice(8);
    return `<text x="${xAt(i).toFixed(1)}" y="${PAD_T + plotH + 22}" text-anchor="middle" fill="#141414" font-size="11" font-weight="700" opacity=".7">${day}</text>`;
  })
  .join("");

// points
const dots = series
  .map((d, i) => {
    const isMax = i === maxIdx && maxV > 0;
    const r = isMax ? 6 : 3.5;
    const fill = isMax ? "#e60012" : d.contributionCount > 0 ? "#ff6a00" : "#ddd2b8";
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.contributionCount).toFixed(1)}" r="${r}" fill="${fill}" stroke="#141414" stroke-width="1.5"/>`;
  })
  .join("");

// Luffy position: sits on max point (or last point)
const lx = xAt(maxV > 0 ? maxIdx : n - 1);
const ly = yAt(maxV > 0 ? maxV : last);

// mood-specific bubble position: above the anchor, flipped if too close to right
const bubbleW = 340;
const bubbleRight = lx + bubbleW + 20 < W - 10;
const bubbleX = bubbleRight ? lx + 24 : Math.max(PAD_L, lx - bubbleW - 24);
const bubbleY = Math.max(PAD_T - 8, ly - 92);

// Luffy pose modifiers
const hatTilt = mood === "down" ? -6 : mood === "peak" ? 4 : 0;
const armUp = mood === "peak" || mood === "rise";

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Contribution graph with Luffy — ${quote}">
  <defs>
    <pattern id="agTone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.1" fill="#141414" opacity=".07"/>
    </pattern>
    <filter id="agInk" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="3" dy="3" stdDeviation="0" flood-color="#000" flood-opacity="0.9"/>
    </filter>
    <filter id="agGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
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
  </style>

  <rect width="${W}" height="${H}" fill="#f7f1e3"/>
  <rect width="${W}" height="${H}" fill="url(#agTone)"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="#141414" stroke-width="7"/>

  <!-- header -->
  <circle cx="32" cy="36" r="7" fill="#e60012" class="pulse"/>
  <text class="disp" x="50" y="44" fill="#141414" font-size="22" letter-spacing="1">
    <tspan fill="#e60012">${total}</tspan> contributions · last ${DAYS} days
  </text>
  <text class="sans" x="${W - 28}" y="42" text-anchor="end" fill="#e60012" font-size="13" font-style="italic" font-weight="700">Luffy's training log · ${OWNER}</text>
  <rect x="24" y="56" width="${W - 48}" height="5" fill="#141414"/>

  <!-- y ticks -->
  ${yTicks.join("\n  ")}

  <!-- area + line -->
  <path d="${area}" fill="#ff6a00" opacity=".14"/>
  <polyline class="draw" points="${line}" fill="none" stroke="#0284c7" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>

  ${dots}
  ${xLabels}

  <text class="sans" x="${W / 2}" y="${H - 18}" text-anchor="middle" fill="#e60012" font-size="12" font-style="italic" font-weight="700">Days</text>
  <text class="sans" x="16" y="${PAD_T + plotH / 2}" text-anchor="middle" fill="#e60012" font-size="12" font-style="italic" font-weight="700" transform="rotate(-90 16 ${PAD_T + plotH / 2})">Contributions</text>

  <!-- speech bubble -->
  <g filter="url(#agInk)">
    <rect x="${bubbleX.toFixed(1)}" y="${bubbleY.toFixed(1)}" width="${bubbleW}" height="64" rx="20" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
    <!-- tail toward Luffy -->
    ${
      bubbleRight
        ? `<polygon points="${(bubbleX + 20).toFixed(1)},${(bubbleY + 56).toFixed(1)} ${(lx + 4).toFixed(1)},${(ly - 8).toFixed(1)} ${(bubbleX + 56).toFixed(1)},${(bubbleY + 60).toFixed(1)}" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
           <polygon points="${(bubbleX + 28).toFixed(1)},${(bubbleY + 54).toFixed(1)} ${(lx + 10).toFixed(1)},${(ly - 4).toFixed(1)} ${(bubbleX + 52).toFixed(1)},${(bubbleY + 56).toFixed(1)}" fill="#ffffff"/>`
        : `<polygon points="${(bubbleX + bubbleW - 20).toFixed(1)},${(bubbleY + 56).toFixed(1)} ${(lx - 4).toFixed(1)},${(ly - 8).toFixed(1)} ${(bubbleX + bubbleW - 56).toFixed(1)},${(bubbleY + 60).toFixed(1)}" fill="#ffffff" stroke="#141414" stroke-width="3.5"/>
           <polygon points="${(bubbleX + bubbleW - 28).toFixed(1)},${(bubbleY + 54).toFixed(1)} ${(lx - 10).toFixed(1)},${(ly - 4).toFixed(1)} ${(bubbleX + bubbleW - 52).toFixed(1)},${(bubbleY + 56).toFixed(1)}" fill="#ffffff"/>`
    }
    <text class="sans" x="${(bubbleX + bubbleW / 2).toFixed(1)}" y="${(bubbleY + 28).toFixed(1)}" text-anchor="middle" fill="#141414" font-size="13" font-weight="700">${escapeXml(quote.split(" ").slice(0, 6).join(" "))}</text>
    <text class="sans" x="${(bubbleX + bubbleW / 2).toFixed(1)}" y="${(bubbleY + 48).toFixed(1)}" text-anchor="middle" fill="#e60012" font-size="13" font-style="italic" font-weight="700">${escapeXml(quote.split(" ").slice(6).join(" "))}</text>
  </g>

  <!-- ===== MONKEY D. LUFFY sitting on the peak ===== -->
  <g class="bob" transform="translate(${lx.toFixed(1)},${ly.toFixed(1)})">
    <!-- legs dangling -->
    <path d="M-10,4 Q-18,22 -14,34" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M10,4 Q18,22 14,34" fill="none" stroke="#141414" stroke-width="7" stroke-linecap="round"/>
    <path d="M-10,4 Q-18,22 -14,34" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M10,4 Q18,22 14,34" fill="none" stroke="#f5c89a" stroke-width="4.5" stroke-linecap="round"/>
    <!-- sandals -->
    <ellipse cx="-14" cy="36" rx="7" ry="4" fill="#c4a574" stroke="#141414" stroke-width="2"/>
    <ellipse cx="14" cy="36" rx="7" ry="4" fill="#c4a574" stroke="#141414" stroke-width="2"/>

    <!-- blue shorts -->
    <path d="M-16,-4 L16,-4 L14,14 L4,8 L0,16 L-4,8 L-14,14 Z" fill="#1d4ed8" stroke="#141414" stroke-width="2.5"/>

    <!-- red vest / torso -->
    <path d="M-18,-30 Q-22,-8 -16,-2 L16,-2 Q22,-8 18,-30 Q0,-36 -18,-30 Z" fill="#e60012" stroke="#141414" stroke-width="2.5"/>
    <!-- open vest chest -->
    <path d="M-6,-30 Q0,-16 6,-30" fill="#f5c89a" stroke="#141414" stroke-width="2"/>

    ${
      armUp
        ? `<!-- arms raised celebrating -->
    <path d="M-18,-24 Q-34,-40 -30,-52" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M-18,-24 Q-34,-40 -30,-52" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-30" cy="-54" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <path d="M18,-24 Q34,-40 30,-52" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M18,-24 Q34,-40 30,-52" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="30" cy="-54" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>`
        : `<!-- arms resting / braced -->
    <path d="M-18,-22 Q-28,-8 -22,2" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M-18,-22 Q-28,-8 -22,2" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="-22" cy="4" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>
    <path d="M18,-22 Q30,-10 26,0" fill="none" stroke="#141414" stroke-width="8" stroke-linecap="round"/>
    <path d="M18,-22 Q30,-10 26,0" fill="none" stroke="#f5c89a" stroke-width="5" stroke-linecap="round"/>
    <circle cx="26" cy="2" r="6" fill="#f5c89a" stroke="#141414" stroke-width="2"/>`
    }

    <!-- head -->
    <circle cx="0" cy="-44" r="18" fill="#f5c89a" stroke="#141414" stroke-width="2.5"/>
    <!-- scar under eye -->
    <path d="M-8,-40 L-4,-36" stroke="#141414" stroke-width="2" stroke-linecap="round"/>
    <!-- eyes -->
    <circle cx="-6" cy="-46" r="2.2" fill="#141414"/>
    <circle cx="6" cy="-46" r="2.2" fill="#141414"/>
    <!-- big grin -->
    ${
      mood === "peak" || mood === "rise"
        ? `<path d="M-8,-38 Q0,-30 8,-38" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
        : mood === "down"
          ? `<path d="M-7,-34 Q0,-40 7,-34" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
          : `<path d="M-7,-36 Q0,-30 7,-36" fill="none" stroke="#141414" stroke-width="2.5" stroke-linecap="round"/>`
    }
    <!-- black hair tufts -->
    <path d="M-16,-52 Q-10,-62 -4,-54" fill="#141414"/>
    <path d="M-4,-56 Q2,-66 8,-56" fill="#141414"/>
    <path d="M8,-54 Q14,-62 18,-52" fill="#141414"/>

    <!-- straw hat -->
    <g transform="rotate(${hatTilt} 0 -54)">
      <ellipse cx="0" cy="-56" rx="34" ry="9" fill="#f5d76e" stroke="#141414" stroke-width="2.5"/>
      <path d="M-16,-56 Q-16,-76 0,-76 Q16,-76 16,-56" fill="#f5d76e" stroke="#141414" stroke-width="2.5"/>
      <path d="M-16,-60 Q0,-54 16,-60" fill="none" stroke="#e60012" stroke-width="4"/>
      <!-- hat band red -->
      <rect x="-16" y="-64" width="32" height="6" fill="#e60012" stroke="#141414" stroke-width="1.5"/>
    </g>
  </g>

  <!-- mood badge -->
  <g transform="translate(${W - 120},${H - 40})">
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
  `OK ${out} | days=${n} total=${total} max=${maxV}@${series[maxIdx]?.date} mood=${mood} quote="${quote}" bytes=${svg.length}`
);
