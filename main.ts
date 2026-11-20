// Kestrel Token Radar: a token launch radar for make.fun's token-radar-01 bounty (Node 22, standard
// library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>, or
// MAKEFUN_INPUT_DIR), scores every pre-token protocol with the fitted log-linear ridge model in
// lib/model.ts, writes the ranked board to /output/board.json, writes the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with the vendored make.fun library.
//
// The model fits log(mcap) ~ log(tvl) + pass-through family on the snapshot's own traded comps, with
// sign-constrained 7-day growth and seasoning terms chosen inside an economic box by leave-one-out,
// fits a logistic launch curve on all 758 protocols for the odds of a token within 12 months, validates
// both blind (LOO and walk-forward), then prices each pre-token protocol and nets a two-outcome,
// deposit-sized farm plan ($1k / $10k / $50k) around it.
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
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model_version: radar.version, as_of: snapshot.as_of, rows: board })}\n`);
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

const v = radar.verdicts;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${board.length} ranked (${radar.funnel.watchlist} watchlist + ${radar.funnel.emerging} emerging), ${radar.fit.n_comps} traded comps fitted\n` +
    `token radar: LOO R2 ${radar.fit.loo.r2} rho ${radar.fit.loo.rho}; nested LOO R2 ${radar.fit.nested.r2} rho ${radar.fit.nested.rho}; walk-forward pooled R2 ${radar.fit.wf.pooled.r2} rho ${radar.fit.wf.pooled.rho}; k ${radar.fit.k} d ${radar.fit.d} lam ${radar.fit.lam}\n` +
    `token radar: P(token) launch curve on ${radar.odds.n} protocols [${radar.odds.terms.join(', ')}]: LOO Brier ${radar.odds.loo.brier} (base rate ${radar.odds.loo.base_brier}) log-loss ${radar.odds.loo.logloss} AUC ${radar.odds.loo.auc}; walk-forward Brier ${radar.odds.wf.pooled.brier} AUC ${radar.odds.wf.pooled.auc}\n` +
    `token radar: two-outcome verdicts FARM/THIN/SKIP at $1k ${v['1000']!.FARM}/${v['1000']!.THIN}/${v['1000']!.SKIP}, $10k ${v['10000']!.FARM}/${v['10000']!.THIN}/${v['10000']!.SKIP}, $50k ${v['50000']!.FARM}/${v['50000']!.THIN}/${v['50000']!.SKIP}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dash.length} files, ${dashBytes} bytes), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
