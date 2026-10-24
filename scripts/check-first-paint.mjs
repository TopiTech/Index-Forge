/**
 * First-paint bundle gate (PERF-01 / PERF-02).
 *
 * Vite writes one `modulepreload` link per chunk that is statically reachable
 * from the entry, so `dist/index.html` is the authoritative list of what the
 * browser downloads before the app can paint. Two heavy payloads used to sit in
 * that list even though only a lazy route needs them:
 *
 *   - the 4,500+ ticker dataset (src/data/stockUniverse.ts), and
 *   - the chart library (recharts).
 *
 * The check is deliberately independent of chunk *names* (Vite hashes them and
 * the splitting rules may change): it fails when the total first-paint
 * transfer exceeds the budget, or when a single preloaded chunk is so large
 * that it can only be the dataset or the chart library.
 */
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(repoRoot, "dist");

/** Raw bytes the first paint may download (entry script + preloads + CSS). */
const FIRST_PAINT_RAW_BUDGET = 900_000;
/** Gzipped equivalent of the budget above. */
const FIRST_PAINT_GZIP_BUDGET = 250_000;
/**
 * A preloaded chunk above this size is a heavyweight payload that only a lazy
 * route should ever request (the dataset is ~300 KB, the chart library ~420 KB).
 */
const MAX_PRELOADED_CHUNK_RAW = 200_000;
/**
 * Budget for the entry chunk itself.
 *
 * The entry is the one file that cannot be deferred, so it needs its own
 * limit: a payload that is merged back into it (the dataset or the chart
 * library) would still fit the *total* budget and would go unnoticed.
 */
const MAX_ENTRY_CHUNK_RAW = 520_000;
const MAX_ENTRY_CHUNK_GZIP = 160_000;

const distHtmlPath = join(distDir, "index.html");
if (!existsSync(distHtmlPath)) {
  console.error("check-first-paint: dist/index.html not found. Please run 'npm run build' first.");
  process.exit(1);
}

const html = readFileSync(distHtmlPath, "utf8");

const entryMatch = html.match(/<script[^>]+type="module"[^>]+src="\/assets\/([^"]+)"/);
if (!entryMatch) {
  console.error("check-first-paint: no entry module script found in dist/index.html");
  process.exit(1);
}

const preloadMatches = [
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+)"/g),
];
const stylesheetMatches = [
  ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/assets\/([^"]+)"/g),
];

const files = [
  { name: entryMatch[1], role: "entry" },
  ...preloadMatches.map((m) => ({ name: m[1], role: "preload" })),
  ...stylesheetMatches.map((m) => ({ name: m[1], role: "stylesheet" })),
];

let rawTotal = 0;
let gzipTotal = 0;
const rows = [];

for (const file of files) {
  const path = join(distDir, "assets", file.name);
  if (!existsSync(path)) {
    // A stale dist/ can reference a chunk that the last build already
    // removed. Without this guard the read below threw an unhandled ENOENT
    // instead of the diagnostic the operator needs.
    console.error(
      `check-first-paint: dist/assets/${file.name} is referenced by dist/index.html but does not exist. Please run 'npm run build' first.`,
    );
    process.exit(1);
  }
  const content = readFileSync(path);
  const raw = content.length;
  const gzip = gzipSync(content, { level: 9 }).length;
  rawTotal += raw;
  gzipTotal += gzip;
  rows.push({ file: file.name, role: file.role, raw, gzip });
}

console.log("First-paint assets (dist/index.html references):");
for (const row of rows) {
  console.log(
    `  ${row.role.padEnd(11)} ${String(row.raw).padStart(9)} B raw  ${String(row.gzip).padStart(9)} B gzip  ${row.file}`,
  );
}
console.log(
  `  ${"TOTAL".padEnd(11)} ${String(rawTotal).padStart(9)} B raw  ${String(gzipTotal).padStart(9)} B gzip`,
);

const violations = [];

if (rawTotal > FIRST_PAINT_RAW_BUDGET) {
  violations.push(
    `first-paint transfer is ${rawTotal} B raw (budget ${FIRST_PAINT_RAW_BUDGET} B)`,
  );
}
if (gzipTotal > FIRST_PAINT_GZIP_BUDGET) {
  violations.push(
    `first-paint transfer is ${gzipTotal} B gzip (budget ${FIRST_PAINT_GZIP_BUDGET} B)`,
  );
}
for (const row of rows) {
  if (row.role === "preload" && row.raw > MAX_PRELOADED_CHUNK_RAW) {
    violations.push(
      `preloaded chunk ${row.file} is ${row.raw} B raw; a payload this large must be loaded by the route that renders it`,
    );
  }
  if (row.role === "entry" && row.raw > MAX_ENTRY_CHUNK_RAW) {
    violations.push(
      `entry chunk ${row.file} is ${row.raw} B raw (budget ${MAX_ENTRY_CHUNK_RAW} B); a heavyweight payload was merged back into the entry`,
    );
  }
  if (row.role === "entry" && row.gzip > MAX_ENTRY_CHUNK_GZIP) {
    violations.push(
      `entry chunk ${row.file} is ${row.gzip} B gzip (budget ${MAX_ENTRY_CHUNK_GZIP} B); a heavyweight payload was merged back into the entry`,
    );
  }
}

if (violations.length > 0) {
  console.error("");
  console.error("check-first-paint: FAILED");
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log("");
console.log("check-first-paint: OK (first paint stays within the budget)");
