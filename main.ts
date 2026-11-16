// Token Radar, entry point: a sealed snapshot in, a ranked board and a dashboard out.
//
// The run reads the snapshot (default /input/snapshot.json, or --input <file|dir>),
// scores every pre-token protocol with the model in lib/model.ts, writes the ranked
// board to board.json, and copies dashboard/ and screenshots/ next to it. dossier.json
// comes last, built from the vendored make.fun library: it is the summary the judge
// reads, and the scorer rebuilds it from /output and compares bytes.
//
// The dashboard is a static page with no framework and no network. Its three files
// (index.html, app.css, app.js) read data.js, which this program writes from the same
// board the JSON carries. The page covers the watchlist, states the model and gives
// every protocol a farm plan: a starting point, not a winner. Change the model, the
// page or the plan; keep the gate's shape.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The directory this file lives in. */
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const MAX_TEXT_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** The value of `--name <value>` (or `--name=<value>`) among the arguments, else `fallback`. The space form wins over the equals form. */
function flag(name: string, fallback: string): string {
  const wanted = `--${name}`;
  const args = process.argv.slice(2);
  for (let i = 0; i + 1 < args.length; i++) {
    if (args[i] === wanted) return args[i + 1]!;
  }
  for (const a of args) {
    if (a.startsWith(`${wanted}=`)) return a.slice(wanted.length + 1);
  }
  return fallback;
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. Returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

/** Write `message` to stderr and exit with `code`. */
function fail(message: string, code: number): never {
  process.stderr.write(message);
  process.exit(code);
}

function main(): void {
  const inputArg = flag('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    fail(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`, 2);
  }
  const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    fail(`token radar: the model wrote a board the gate refuses: ${issue}\n`, 1);
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  copyDir(join(ROOT, 'dashboard'), join(out, 'dashboard'));
  const shots = copyDir(join(ROOT, 'screenshots'), join(out, 'screenshots'));
  if (shots.length < 3) {
    fail(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`, 1);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      fail(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`, 1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: MAX_TEXT_BYTES, screenshots: SHOT_CAPS, dashboard: DASHBOARD_CAPS }));

  const lines = [
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`,
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

main();
