// Kestrel Token Radar: a token launch radar for make.fun's token-radar-01 bounty (Node 22, standard
// library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>, or
// MAKEFUN_INPUT_DIR), scores every pre-token protocol with the fitted log-linear ridge model in
// lib/model.ts, writes the ranked board to /output/board.json, writes the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// The model fits log(mcap) ~ log(tvl) + category fixed effects + 7d change + log(age) + log(chains)
// on the snapshot's own tokenized comps, validates it leave-one-out AND on temporal walk-forward
// folds, then prices each pre-token protocol at the fit and nets a deposit-sized farm EV around it.
// Tokenized protocols are kept apart as the model's evidence, never ranked; pre-token protocols the
// product screens catch are set aside with their exact reason and counted in the 758-protocol funnel.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** The dashboard's whole source must fit inside the dossier's text budget, whole and untruncated. */
const DASHBOARD_TEXT_BUDGET = 64_000;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputEnv = process.env.MAKEFUN_INPUT_DIR;
const inputArg = arg('input', inputEnv !== undefined && inputEnv !== '' ? inputEnv : '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model_version: radar.model_version, as_of: snapshot.as_of, rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const dashBytes = dash.reduce((n, name) => n + statSync(join(out, 'dashboard', name)).size, 0);
if (dashBytes > DASHBOARD_TEXT_BUDGET) {
  process.stderr.write(`token radar: dashboard/ holds ${dashBytes} bytes of source, over the ${DASHBOARD_TEXT_BUDGET}-byte budget the dossier shows whole\n`);
  process.exit(1);
}
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.kpis.watchlist} watchlist, ${radar.kpis.emerging} emerging, ${radar.kpis.comps} tokenized comps fitted, ${radar.kpis.aside_above + radar.kpis.excluded_below} screened out)\n` +
    `token radar: LOO R2 ${radar.fit.loo.metrics.r2} rho ${radar.fit.loo.metrics.rho} med|log err| ${radar.fit.loo.metrics.med_abs_log_err}; nested LOO R2 ${radar.fit.nested.metrics.r2}; walk-forward pooled rho ${radar.fit.wf.pooled.rho}; verdicts FARM ${radar.kpis.farm} / THIN ${radar.kpis.thin} / SKIP ${radar.kpis.skip}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dash.length} files, ${dashBytes} bytes), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
