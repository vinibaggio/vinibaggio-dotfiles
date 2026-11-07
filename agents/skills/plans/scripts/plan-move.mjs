#!/usr/bin/env node
// Move a plan between lifecycle folders and keep its frontmatter honest.
// The only writer in the plans toolchain.
//
//   node plan-move.mjs <plan-path> <drafts|next|open|parked|done|discarded> [options]
//
//   --root <dir>          plan root (default $AI_DOCS_ROOT or ~/code/ai-docs)
//   --pr <ref>            add a PR ref to frontmatter `prs` (repeatable)
//   --waiting-on <v>      set frontmatter `waiting_on`
//   --next-action <text>  set frontmatter `next_action`
//   --confirm             stamp `confirmed: <today>` — a ratified terminal outcome
//                         that /plan-sync stops asking about (done/ and discarded/ only)
//   --rename <name>       new file/dir name at the destination
//   --dry-run             print what would change, write nothing
//
// Creates a frontmatter block when the plan has none, seeding `created` from a
// leading YYYY-MM-DD in the filename (falling back to the file's mtime).

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const LIFECYCLE = ['drafts', 'next', 'open', 'parked', 'done', 'discarded'];
const PLAN_MAIN = ['plan.md', 'design.md', 'README.md', 'index.md'];

function usage(msg) {
  process.stderr.write(`${msg}\nusage: plan-move.mjs <plan-path> <${LIFECYCLE.join('|')}> [options]\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.length < 2) usage('plan-move: need a plan path and a destination folder');
const [rawPath, destFolder] = argv;
if (!LIFECYCLE.includes(destFolder)) usage(`plan-move: unknown destination "${destFolder}"`);

const opts = { root: process.env.AI_DOCS_ROOT || path.join(homedir(), 'code', 'ai-docs'), prs: [], dryRun: false };
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') opts.root = argv[++i];
  else if (a === '--pr') opts.prs.push(argv[++i]);
  else if (a === '--waiting-on') opts.waitingOn = argv[++i];
  else if (a === '--next-action') opts.nextAction = argv[++i];
  else if (a === '--confirm') opts.confirm = true;
  else if (a === '--rename') opts.rename = argv[++i];
  else if (a === '--dry-run') opts.dryRun = true;
  else usage(`plan-move: unknown option ${a}`);
}
if (opts.confirm && !['done', 'discarded'].includes(destFolder))
  usage(`plan-move: --confirm ratifies a terminal outcome; ${destFolder}/ is not terminal`);
const expand = (p) => p.replace(/^~(?=$|\/)/, homedir());
opts.root = expand(opts.root);
const src = await planRoot(path.resolve(expand(rawPath)));

// A directory plan is addressed by its directory. Given its main doc instead, move the directory:
// moving the file alone would strand the artifacts and flatten the plan into the destination root.
async function planRoot(p) {
  const st = await stat(p).catch(() => null);
  if (!st?.isFile() || !PLAN_MAIN.includes(path.basename(p))) return p;
  const dir = path.dirname(p);
  const parent = path.dirname(dir);
  const unfiledPlanDir = parent === opts.root;
  const filedPlanDir = LIFECYCLE.includes(path.basename(parent)) && path.dirname(parent) === opts.root;
  return unfiledPlanDir || filedPlanDir ? dir : p;
}

const today = new Date().toISOString().slice(0, 10);

async function mainDoc(planPath) {
  const st = await stat(planPath);
  if (st.isFile()) return planPath;
  const { readdir } = await import('node:fs/promises');
  const names = (await readdir(planPath, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  const pick = PLAN_MAIN.find((n) => names.includes(n)) || names.find((n) => n.endsWith('.md'));
  if (!pick) return null;
  return path.join(planPath, pick);
}

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { block: null, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { block: null, body: text };
  const bodyStart = text.indexOf('\n', end + 1);
  return { block: text.slice(text.indexOf('\n') + 1, end + 1), body: bodyStart === -1 ? '' : text.slice(bodyStart + 1) };
}

function setScalar(lines, key, value) {
  const idx = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  const line = `${key}: ${value}`;
  if (idx === -1) lines.push(line);
  else lines[idx] = line;
}

function appendPrs(lines, refs) {
  if (!refs.length) return;
  const idx = lines.findIndex((l) => /^prs\s*:/.test(l));
  if (idx === -1) {
    lines.push('prs:', ...refs.map((r) => `  - ${r}`));
    return;
  }
  let end = idx + 1;
  while (end < lines.length && /^\s+-\s+/.test(lines[end])) end++;
  const existing = lines.slice(idx + 1, end).map((l) => l.replace(/^\s+-\s+/, '').trim());
  const inline = /^prs\s*:\s*\[(.*)\]\s*$/.exec(lines[idx]);
  if (inline) {
    const merged = [...new Set([...inline[1].split(',').map((s) => s.trim()).filter(Boolean), ...refs])];
    lines[idx] = `prs: [${merged.join(', ')}]`;
    return;
  }
  const missing = refs.filter((r) => !existing.includes(r));
  lines.splice(end, 0, ...missing.map((r) => `  - ${r}`));
}

function quoteIfNeeded(v) {
  return /^[\w.@/:+-][^:#]*$/.test(v) ? v : JSON.stringify(v);
}

async function run() {
  const st = await stat(src).catch(() => null);
  if (!st) usage(`plan-move: no such plan: ${src}`);

  const destDir = path.join(opts.root, destFolder);
  const destName = opts.rename || path.basename(src);
  const dest = path.join(destDir, destName);
  const inPlace = dest === src;
  const metadataOnly = !opts.prs.length && !opts.waitingOn && !opts.nextAction && !opts.confirm;
  if (inPlace && metadataOnly) {
    process.stdout.write(`plan-move: already at ${path.relative(opts.root, dest)}\n`);
    return;
  }
  if (!inPlace && (await stat(dest).catch(() => null))) usage(`plan-move: destination already exists: ${dest}`);

  const doc = await mainDoc(src);
  let rewrite = null;
  if (doc) {
    const text = await readFile(doc, 'utf8');
    const { block, body } = splitFrontmatter(text);
    const lines = block ? block.replace(/\n$/, '').split('\n') : [];
    if (!block) {
      const dated = /(\d{4}-\d{2}-\d{2})/.exec(path.basename(src));
      setScalar(lines, 'created', dated ? dated[1] : st.mtime.toISOString().slice(0, 10));
    }
    setScalar(lines, 'status', destFolder);
    setScalar(lines, 'updated', today);
    if (opts.waitingOn) setScalar(lines, 'waiting_on', opts.waitingOn);
    if (opts.nextAction) setScalar(lines, 'next_action', quoteIfNeeded(opts.nextAction));
    if (opts.confirm) setScalar(lines, 'confirmed', today);
    appendPrs(lines, opts.prs);
    rewrite = { path: doc, text: `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}` };
  }

  if (opts.dryRun) {
    const head = inPlace
      ? `would update ${path.relative(opts.root, src)} in place\n`
      : `would move ${path.relative(opts.root, src)} -> ${path.relative(opts.root, dest)}\n`;
    process.stdout.write(
      head + (rewrite ? `would rewrite frontmatter in ${path.basename(rewrite.path)}\n` : 'no markdown doc found; frontmatter untouched\n'),
    );
    return;
  }

  if (!inPlace) {
    await mkdir(destDir, { recursive: true });
    await rename(src, dest);
  }
  if (rewrite) await writeFile(path.join(dest, path.relative(src, rewrite.path)), rewrite.text);
  process.stdout.write(
    inPlace
      ? `updated ${path.relative(opts.root, dest)}\n`
      : `moved ${path.relative(opts.root, src)} -> ${path.relative(opts.root, dest)}\n`,
  );
}

run().catch((e) => {
  process.stderr.write(`plan-move: ${e.message}\n`);
  process.exit(1);
});
