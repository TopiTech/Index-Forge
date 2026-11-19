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
 * that it can only be the dataset or the chart library. HTML tags are parsed
 * by attribute name rather than by a fixed attribute order, and the entry's
 * static imports are cross-checked against the preload list so a heavy chunk
 * cannot escape the gate by being omitted from the HTML.
 */
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDistDir = join(repoRoot, "dist");

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

/** Parse attributes by name; Vite may reorder them between releases. */
function attributesOf(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
  }
  return attrs;
}

function localAssetName(value) {
  const m = typeof value === "string" ? value.match(/^\/assets\/([^"?#]+)$/) : null;
  return m ? m[1] : null;
}

/**
 * Extract the first-paint asset list from built HTML, independent of attribute
 * order or quoting style. External URLs and non-asset scripts stay excluded.
 */
export function extractAssetReferences(html) {
  let entry = null;
  const preloads = [];
  const stylesheets = [];

  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const attrs = attributesOf(tag[0]);
    const name = localAssetName(attrs.src);
    if (name && (attrs.type || "").toLowerCase() === "module" && entry === null) {
      entry = name;
    }
  }
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributesOf(tag[0]);
    const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
    const name = localAssetName(attrs.href);
    if (!name) continue;
    if (rel.includes("modulepreload")) preloads.push(name);
    if (rel.includes("stylesheet")) stylesheets.push(name);
  }

  return { entry, preloads: [...new Set(preloads)], stylesheets: [...new Set(stylesheets)] };
}

/**
 * Static imports ("from './x.js'" / "import './x.js'") in the entry chunk are
 * first-paint dependencies even if a broken build omits their preload link.
 * Dynamic imports ("import('./x.js')") are deliberately not included.
 */
export function findUnpreloadedStaticImports(entrySource, preloadNames) {
  const preloads = new Set(preloadNames);
  const missing = new Set();
  for (const m of entrySource.matchAll(/(?:\bfrom\s*|\bimport\s*)(["'])\.\/([^"']+\.js)\1/g)) {
    const name = m[2].split("/").pop();
    if (!preloads.has(name)) missing.add(name);
  }
  return [...missing];
}

/** Apply the first-paint byte budgets to already-measured assets. */
export function evaluateFirstPaint(rows) {
  let rawTotal = 0;
  let gzipTotal = 0;
  const violations = [];

  for (const row of rows) {
    rawTotal += row.raw;
    gzipTotal += row.gzip;
    if (row.role === "preload" && row.raw > MAX_PRELOADED_CHUNK_RAW) {
      violations.push(
        `preloaded chunk ${row.name} is ${row.raw} B raw; a payload this large must be loaded by the route that renders it`,
      );
    }
    if (row.role === "entry" && row.raw > MAX_ENTRY_CHUNK_RAW) {
      violations.push(
        `entry chunk ${row.name} is ${row.raw} B raw (budget ${MAX_ENTRY_CHUNK_RAW} B); a heavyweight payload was merged back into the entry`,
      );
    }
    if (row.role === "entry" && row.gzip > MAX_ENTRY_CHUNK_GZIP) {
      violations.push(
        `entry chunk ${row.name} is ${row.gzip} B gzip (budget ${MAX_ENTRY_CHUNK_GZIP} B); a heavyweight payload was merged back into the entry`,
      );
    }
  }
  if (rawTotal > FIRST_PAINT_RAW_BUDGET) {
    violations.push(`first-paint transfer is ${rawTotal} B raw (budget ${FIRST_PAINT_RAW_BUDGET} B)`);
  }
  if (gzipTotal > FIRST_PAINT_GZIP_BUDGET) {
    violations.push(`first-paint transfer is ${gzipTotal} B gzip (budget ${FIRST_PAINT_GZIP_BUDGET} B)`);
  }

  return { rawTotal, gzipTotal, violations };
}

function parseDistDir(argv) {
  const idx = argv.indexOf("--dist");
  if (idx !== -1 && argv[idx + 1]) return resolve(argv[idx + 1]);
  return defaultDistDir;
}

function fail(message) {
  console.error(`check-first-paint: ${message}`);
  process.exit(1);
}

function main() {
  const distDir = parseDistDir(process.argv.slice(2));
  const distHtmlPath = join(distDir, "index.html");
  if (!existsSync(distHtmlPath)) {
    fail("dist/index.html not found. Please run 'npm run build' first.");
  }

  const html = readFileSync(distHtmlPath, "utf8");
  const refs = extractAssetReferences(html);
  if (!refs.entry) {
    fail("no entry module script found in dist/index.html");
  }

  const files = [
    { name: refs.entry, role: "entry" },
    ...refs.preloads.map((name) => ({ name, role: "preload" })),
    ...refs.stylesheets.map((name) => ({ name, role: "stylesheet" })),
  ];

  const rows = [];
  for (const file of files) {
    const path = join(distDir, "assets", file.name);
    if (!existsSync(path)) {
      // A stale dist/ can reference a chunk that the last build already
      // removed. Without this guard the read below threw an unhandled ENOENT
      // instead of the diagnostic the operator needs.
      fail(`dist/assets/${file.name} is referenced by dist/index.html but does not exist. Please run 'npm run build' first.`);
    }
    const content = readFileSync(path);
    const raw = content.length;
    const gzip = gzipSync(content, { level: 9 }).length;
    rows.push({ name: file.name, role: file.role, raw, gzip });
  }

  console.log("First-paint assets (dist/index.html references):");
  for (const row of rows) {
    console.log(
      `  ${row.role.padEnd(11)} ${String(row.raw).padStart(9)} B raw  ${String(row.gzip).padStart(9)} B gzip  ${row.name}`,
    );
  }

  const { rawTotal, gzipTotal, violations } = evaluateFirstPaint(rows);
  console.log(
    `  ${"TOTAL".padEnd(11)} ${String(rawTotal).padStart(9)} B raw  ${String(gzipTotal).padStart(9)} B gzip`,
  );

  const entrySource = readFileSync(join(distDir, "assets", refs.entry), "utf8");
  for (const name of findUnpreloadedStaticImports(entrySource, refs.preloads)) {
    violations.push(
      `entry chunk ${refs.entry} statically imports ${name}, but dist/index.html does not preload it; a first-paint dependency escaped the gate`,
    );
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
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
