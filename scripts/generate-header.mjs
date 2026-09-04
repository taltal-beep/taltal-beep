#!/usr/bin/env node
// Regenerates assets/header-{dark,light}.svg from live GitHub contribution data.
// Run locally with GITHUB_TOKEN set, or let .github/workflows/header.yml do it daily.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN = process.env.GH_LOGIN || "taltal-beep";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error("GITHUB_TOKEN is not set");
  process.exit(1);
}

const QUERY = `query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{
        totalContributions
        weeks{ contributionDays{ contributionCount date } }
      }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-header-generator",
  },
  body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
});
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const body = await res.json();
if (body.errors) throw new Error(JSON.stringify(body.errors));

const cal = body.data.user.contributionsCollection.contributionCalendar;
const weeks = cal.weeks.map((w) =>
  w.contributionDays.reduce((n, d) => n + d.contributionCount, 0)
);
const days = cal.weeks.flatMap((w) => w.contributionDays);

const stats = {
  total: cal.totalContributions,
  activeDays: days.filter((d) => d.contributionCount > 0).length,
  bestWeek: Math.max(...weeks),
};

// ---------------------------------------------------------------- rendering

const ART = readFileSync(resolve(ROOT, "scripts/ascii-art.txt"), "utf8")
  .replace(/\n$/, "")
  .split("\n");

// Layout is derived, not hand-tuned, so changing ART_SIZE keeps everything aligned.
const W = 820;
const ART_SIZE = 10; // font-size == line-height preserves the portrait's aspect ratio
const ART_COLS = Math.max(...ART.map((l) => l.length));
const ART_TOP = 24;
const ART_H = ART.length * ART_SIZE;
const ART_X = (W - ART_COLS * ART_SIZE * 0.6) / 2; // 0.6em is the monospace advance
const STATS_BASE = ART_TOP + ART_H + 48; // baseline of the big contribution number
const SPARK_TOP = STATS_BASE + 34;
const SPARK_H = 54;
const H = SPARK_TOP + SPARK_H + 28;
const PAD = 56;

// The portrait prints one line at a time, like a terminal flushing output.
// Each line is revealed by sliding a background-coloured cover off to the
// right; a block cursor rides along on the cover's leading edge.
const LINE_MS = 0.075; // seconds per line
const START = 0.3; // beat before the first line lands
const ART_W = ART_COLS * ART_SIZE * 0.6;
const DONE = START + ART.length * LINE_MS; // when the stats may appear

// The cover sweeps far enough that the cursor riding its edge ends up past
// the right edge of the canvas, where it is clipped away. Hiding the cursor
// with an opacity keyframe alone is not enough: browsers sometimes skip the
// final repaint and leave a stuck block behind. The art is fully uncovered
// once the cover has moved ART_W, so the extra travel costs nothing visually.
const SWEEP = W - ART_X + 12;

// &quot; because this string lands inside a double-quoted XML attribute.
const MONO =
  "ui-monospace,SFMono-Regular,&quot;SF Mono&quot;,Menlo,Consolas,&quot;Liberation Mono&quot;,monospace";

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Sparkline across the full card width.
function sparkline(y0, height) {
  const x0 = PAD;
  const x1 = W - PAD;
  const max = Math.max(1, ...weeks);
  const pts = weeks.map((v, i) => [
    x0 + (i * (x1 - x0)) / (weeks.length - 1),
    y0 + height - (v / max) * height,
  ]);
  const line = pts
    .map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x1},${y0 + height} L${x0},${y0 + height} Z`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return { line, area, len: Math.ceil(len) };
}

function svg({ bg, art, fg, muted, stroke, fill }) {
  const artLines = ART.map(
    (l, i) =>
      `<text x="${ART_X}" y="${ART_TOP + (i + 1) * ART_SIZE}" xml:space="preserve">${esc(l)}</text>`
  ).join("\n      ");

  const { line, area, len } = sparkline(SPARK_TOP, SPARK_H);

  // One cover per line, each delayed by the one before it.
  const covers = ART.map((_, i) => {
    const d = (START + i * LINE_MS).toFixed(3);
    const y = ART_TOP + i * ART_SIZE;
    return `<g class="cov" style="animation-delay:${d}s"><rect x="${ART_X}" y="${y}" width="${ART_W + 8}" height="${ART_SIZE}" fill="${bg}"/><rect class="cur" style="animation-delay:${d}s" x="${ART_X}" y="${y + 1}" width="5" height="${ART_SIZE - 2}" fill="${fg}"/></g>`;
  }).join("\n    ");

  // Every rule below animates *towards* the element's own base style, using
  // animation-fill-mode:backwards. So the resting state of this file is the
  // finished header: anything that rasterises the SVG or ignores CSS
  // animation (GitHub's mobile app, link previews, thumbnailers) still gets
  // the complete image rather than a blank card. The print effect is strictly
  // an enhancement for renderers that do animate.
  const style = `<style>
    .cov{transform:translateX(${SWEEP}px);animation:sweep ${LINE_MS}s linear backwards}
    @keyframes sweep{from{transform:translateX(0)}to{transform:translateX(${SWEEP}px)}}
    .cur{opacity:0;animation:blip ${LINE_MS}s step-end forwards}
    @keyframes blip{0%{opacity:1}100%{opacity:0}}
    .late{animation:fade .55s ease-out ${DONE.toFixed(3)}s backwards}
    @keyframes fade{from{opacity:0}to{opacity:1}}
    .spark{stroke-dasharray:${len};animation:draw 1.1s ease-out ${DONE.toFixed(3)}s backwards}
    @keyframes draw{from{stroke-dashoffset:${len}}to{stroke-dashoffset:0}}
    @media (prefers-reduced-motion:reduce){
      .cov,.cur{display:none}
      .late,.spark{animation:none}
    }
  </style>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${LOGIN} — ${stats.total} contributions in the last year">
  <rect width="${W}" height="${H}" fill="${bg}"/>

  ${style}

  <g font-family="${MONO}" font-size="${ART_SIZE}" fill="${art}">
      ${artLines}
  </g>
  <g>
    ${covers}
  </g>

  <g class="late" font-family="${MONO}">
    <text x="${PAD}" y="${STATS_BASE}" font-size="34" font-weight="600" fill="${fg}">${stats.total}</text>
    <text x="${PAD}" y="${STATS_BASE + 16}" font-size="10" letter-spacing="0.6" fill="${muted}">contributions in the last year</text>

    <text x="${W - PAD}" y="${STATS_BASE - 20}" font-size="17" font-weight="600" fill="${fg}" text-anchor="end">${stats.activeDays}</text>
    <text x="${W - PAD}" y="${STATS_BASE - 7}" font-size="9" letter-spacing="0.6" fill="${muted}" text-anchor="end">active days</text>
    <text x="${W - PAD}" y="${STATS_BASE + 12}" font-size="17" font-weight="600" fill="${fg}" text-anchor="end">${stats.bestWeek}</text>
    <text x="${W - PAD}" y="${STATS_BASE + 25}" font-size="9" letter-spacing="0.6" fill="${muted}" text-anchor="end">best week</text>
  </g>

  <path class="late" d="${area}" fill="${fill}"/>
  <path class="spark" d="${line}" fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
`;
}

const dark = svg({
  bg: "#0d1117",
  art: "#78828d",
  fg: "#e6edf3",
  muted: "#7d8590",
  stroke: "#adbac7",
  fill: "#adbac71f",
});

const light = svg({
  bg: "#ffffff",
  art: "#6e7681",
  fg: "#1f2328",
  muted: "#59636e",
  stroke: "#57606a",
  fill: "#57606a1f",
});

mkdirSync(resolve(ROOT, "assets"), { recursive: true });
writeFileSync(resolve(ROOT, "assets/header-dark.svg"), dark);
writeFileSync(resolve(ROOT, "assets/header-light.svg"), light);

console.log(
  `wrote assets/header-{dark,light}.svg — ${stats.total} contributions, ${stats.activeDays} active days, best week ${stats.bestWeek}`
);
