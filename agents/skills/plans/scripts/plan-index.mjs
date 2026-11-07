#!/usr/bin/env node
// Read-only index of the ai-docs plan tree. Emits JSON on stdout.
// Never moves, writes, or edits anything.
//
//   node plan-index.mjs [options]
//
//   --root <dir>          plan root (default $AI_DOCS_ROOT or ~/code/ai-docs)
//   --folder <name>       restrict to one lifecycle folder (repeatable)
//   --no-gh               skip GitHub lookups (folder/frontmatter only)
//   --default-repo <r>    repo for bare "#123" refs (default clay-run/clay-base)
//   --pretty              indented JSON

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const LIFECYCLE = ['drafts', 'next', 'open', 'parked', 'done', 'discarded'];
const TERMINAL = new Set(['done', 'discarded']);
const ARTIFACT_STORE = 'artifacts';
const PLAN_MAIN = ['plan.md', 'design.md', 'README.md', 'index.md'];
const GH_FIELDS =
  'number,title,url,state,isDraft,mergedAt,closedAt,createdAt,updatedAt,reviewDecision,mergeStateStatus,labels,statusCheckRollup,headRefName';
const GH_CONCURRENCY = 6;

function parseArgs(argv) {
  const opts = {
    root: process.env.AI_DOCS_ROOT || path.join(homedir(), 'code', 'ai-docs'),
    folders: [],
    gh: true,
    defaultRepo: 'clay-run/clay-base',
    pretty: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = argv[++i];
    else if (a === '--folder') opts.folders.push(argv[++i]);
    else if (a === '--no-gh') opts.gh = false;
    else if (a === '--default-repo') opts.defaultRepo = argv[++i];
    else if (a === '--pretty') opts.pretty = true;
    else throw new Error(`unknown option: ${a}`);
  }
  opts.root = opts.root.replace(/^~(?=$|\/)/, homedir());
  const bad = opts.folders.filter((f) => ![...LIFECYCLE, 'unfiled'].includes(f));
  if (bad.length) throw new Error(`unknown folder(s): ${bad.join(', ')}`);
  return opts;
}

// ---------------------------------------------------------------- frontmatter

// Deliberately a YAML subset: scalars, inline [a, b], and "- item" blocks.
// Anything richer in a plan's frontmatter is reported as a warning, not parsed.
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text, raw: null };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: text, raw: null };
  const raw = text.slice(text.indexOf('\n') + 1, end + 1);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const data = {};
  let listKey = null;
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest === '') {
      listKey = key;
      data[key] = [];
      continue;
    }
    listKey = null;
    const inline = /^\[(.*)\]$/.exec(rest.trim());
    data[key] = inline
      ? inline[1]
          .split(',')
          .map((s) => unquote(s))
          .filter(Boolean)
      : unquote(rest);
  }
  return { data, body, raw };
}

// A quoted scalar is taken whole (YAML comments can't start inside quotes); an unquoted one
// loses a trailing ` # comment`.
const unquote = (s) => {
  const t = s.trim();
  const quoted = t.match(/^(["'])(.*)\1(?:\s+#.*)?$/);
  return quoted ? quoted[2] : t.replace(/\s+#.*$/, '').trim();
};
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

// ------------------------------------------------------------------- PR refs

const RE_URL = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const RE_QUALIFIED = /\b([\w.-]+)\/([\w.-]+)#(\d+)\b/g;
const RE_LOOSE = /(?:\bPRs?\s*#?|#)(\d{3,7})\b/gi;

function refKey(r) {
  return `${r.repo}#${r.number}`;
}

function parseRef(token, defaultRepo) {
  const url = /github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/.exec(token);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  const qualified = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(token.trim());
  if (qualified) return { repo: `${qualified[1]}/${qualified[2]}`, number: Number(qualified[3]) };
  const bare = /^#?(\d+)$/.exec(token.trim());
  if (bare) return { repo: defaultRepo, number: Number(bare[1]) };
  return null;
}

function collectRefs({ frontmatter, body, defaultRepo }) {
  const repos = asList(frontmatter.repos);
  const fallbackRepo = repos[0] || defaultRepo;
  const tracked = new Map();
  const add = (ref, source) => {
    if (!ref) return;
    const key = refKey(ref);
    if (!tracked.has(key)) tracked.set(key, { ...ref, sources: [] });
    tracked.get(key).sources.push(source);
  };

  for (const token of asList(frontmatter.prs)) add(parseRef(token, fallbackRepo), 'frontmatter');
  for (const m of body.matchAll(RE_URL)) add({ repo: `${m[1]}/${m[2]}`, number: Number(m[3]) }, 'body-url');
  for (const m of body.matchAll(RE_QUALIFIED)) {
    if (m[2] === 'pull') continue;
    add({ repo: `${m[1]}/${m[2]}`, number: Number(m[3]) }, 'body-qualified');
  }

  // Bare "#123" in prose is ambiguous (issues, Linear, section numbers). Never
  // classify on it; surface it so the plan's `prs:` list can be corrected.
  const mentions = new Map();
  for (const m of body.matchAll(RE_LOOSE)) {
    const number = Number(m[1]);
    const key = `${fallbackRepo}#${number}`;
    if (tracked.has(key) || mentions.has(key)) continue;
    mentions.set(key, { repo: fallbackRepo, number, resolved: false });
  }

  return { refs: [...tracked.values()], mentions: [...mentions.values()] };
}

// --------------------------------------------------------------------- GitHub

function ghPrView(repo, number) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      ['pr', 'view', String(number), '--repo', repo, '--json', GH_FIELDS],
      { maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ error: (stderr || err.message).trim().split('\n').slice(0, 2).join(' ') });
          return;
        }
        try {
          resolve({ data: JSON.parse(stdout) });
        } catch (e) {
          resolve({ error: `unparseable gh output: ${e.message}` });
        }
      },
    );
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function rollup(checks) {
  const counts = { failing: 0, pending: 0, passing: 0, skipped: 0 };
  for (const c of checks || []) {
    const verdict = c.conclusion || c.state || c.status || '';
    if (['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(verdict))
      counts.failing++;
    else if (['SUCCESS', 'NEUTRAL'].includes(verdict)) counts.passing++;
    else if (['SKIPPED'].includes(verdict)) counts.skipped++;
    else counts.pending++;
  }
  return counts;
}

// Graphite's merge queue fast-forwards: a landed PR reads CLOSED with
// mergedAt null and gets the `externally-merged` label seconds later.
function describePr(ref, gh) {
  if (gh.error) return { ...ref, status: 'unknown', error: gh.error };
  const d = gh.data;
  const labels = (d.labels || []).map((l) => l.name);
  const checks = rollup(d.statusCheckRollup);
  const landed = Boolean(d.mergedAt) || (d.state === 'CLOSED' && labels.includes('externally-merged'));
  let status;
  if (landed) status = 'merged';
  else if (d.state === 'OPEN') status = 'open';
  else if (d.state === 'MERGED') status = 'merged';
  else if (d.state === 'CLOSED') status = 'closed-unmerged';
  else status = 'unknown';

  let waitingOn = 'none';
  if (status === 'open') {
    if (checks.failing > 0) waitingOn = 'me:ci-red';
    else if (d.isDraft) waitingOn = 'me:draft';
    else if (d.reviewDecision === 'CHANGES_REQUESTED') waitingOn = 'me:changes-requested';
    else if (['DIRTY', 'BEHIND'].includes(d.mergeStateStatus)) waitingOn = 'me:needs-rebase';
    else if (checks.pending > 0) waitingOn = 'ci';
    else if (d.reviewDecision === 'APPROVED') waitingOn = 'me:ready-to-merge';
    else waitingOn = 'reviewers';
  } else if (status === 'closed-unmerged') {
    waitingOn = 'user:closed-unmerged';
  }

  return {
    ...ref,
    status,
    waitingOn,
    title: d.title,
    url: d.url,
    state: d.state,
    isDraft: d.isDraft,
    mergedAt: d.mergedAt,
    closedAt: d.closedAt,
    updatedAt: d.updatedAt,
    reviewDecision: d.reviewDecision,
    mergeStateStatus: d.mergeStateStatus,
    landedViaQueue: !d.mergedAt && landed,
    labels,
    checks,
    headRefName: d.headRefName,
  };
}

// ------------------------------------------------------------- classification

function classify(plan) {
  const prs = plan.prs;
  const counts = { open: 0, merged: 0, 'closed-unmerged': 0, unknown: 0 };
  for (const pr of prs) counts[pr.status] = (counts[pr.status] || 0) + 1;
  const reasons = [];
  let suggested = plan.folder === 'unfiled' ? null : plan.folder;
  let needsUser = false;

  if (!prs.length) {
    if (plan.folder === 'unfiled') {
      needsUser = true;
      reasons.push('unfiled and has no tracked PR — needs a lifecycle folder');
    } else if (plan.folder === 'open') {
      needsUser = true;
      reasons.push('in open/ with no tracked PR — confirm it is still in execution');
    } else if (plan.folder === 'parked') {
      reasons.push('parked on purpose; moves only when the user resumes it');
    } else {
      reasons.push('no tracked PR; folder is the only signal');
    }
    return { counts, suggestedFolder: suggested, needsUser, reasons };
  }

  if (counts.unknown) {
    needsUser = true;
    reasons.push(`${counts.unknown} PR ref(s) could not be read from GitHub`);
  }
  if (counts.open > 0) {
    suggested = 'open';
    reasons.push(`${counts.open} PR(s) still open`);
  } else if (counts.merged > 0 && counts['closed-unmerged'] === 0 && counts.unknown === 0) {
    suggested = 'done';
    reasons.push('every tracked PR landed');
  } else if (counts.merged === 0 && counts['closed-unmerged'] > 0 && counts.unknown === 0) {
    suggested = 'discarded';
    needsUser = true;
    reasons.push('every tracked PR was closed without merging — confirm discard');
  } else if (counts.merged > 0 && counts['closed-unmerged'] > 0) {
    suggested = 'done';
    needsUser = true;
    reasons.push(
      `mixed outcome: ${counts.merged} landed, ${counts['closed-unmerged']} closed unmerged — confirm done vs discarded`,
    );
  }

  if (TERMINAL.has(plan.folder) && suggested !== plan.folder && counts.open === 0) {
    reasons.push(`terminal folder ${plan.folder}/ retained; only reopening would move it`);
    suggested = plan.folder;
    needsUser = false;
  }

  // A ratified outcome is not a question. Only terminal folders can be ratified.
  if (needsUser && TERMINAL.has(plan.folder) && plan.frontmatter.confirmed) {
    reasons.push(`outcome confirmed ${plan.frontmatter.confirmed}`);
    needsUser = false;
  }
  return { counts, suggestedFolder: suggested, needsUser, reasons };
}

function planWaitingOn(plan) {
  if (TERMINAL.has(plan.folder) && plan.frontmatter.confirmed) return 'none';
  const prWaits = plan.prs.map((p) => p.waitingOn).filter((w) => w && w !== 'none');
  const mine = prWaits.find((w) => w.startsWith('me:'));
  if (mine) return mine;
  const user = prWaits.find((w) => w.startsWith('user:'));
  if (user) return user;
  if (prWaits.includes('reviewers')) return 'reviewers';
  if (prWaits.includes('ci')) return 'ci';
  if (plan.folder === 'drafts') return 'me:refine';
  if (plan.folder === 'next') return 'me:start-execution';
  if (plan.folder === 'open') return 'me:no-open-pr';
  if (plan.folder === 'unfiled') return 'me:file-it';
  return 'none';
}

// ----------------------------------------------------------------- traversal

const IGNORED = new Set(['.git', '.DS_Store', 'node_modules', 'README.md']);

async function readMain(planPath, isDir) {
  if (!isDir) return { mainPath: planPath, text: await readFile(planPath, 'utf8') };
  const entries = await readdir(planPath, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile()).map((e) => e.name);
  const pick = PLAN_MAIN.find((n) => names.includes(n)) || names.find((n) => n.endsWith('.md'));
  if (!pick) return { mainPath: null, text: '', artifacts: names };
  return {
    mainPath: path.join(planPath, pick),
    text: await readFile(path.join(planPath, pick), 'utf8'),
    artifacts: names.filter((n) => n !== pick),
  };
}

async function collectPlans(root, folders) {
  const out = [];
  const warnings = [];
  for (const folder of folders) {
    const dir = folder === 'unfiled' ? root : path.join(root, folder);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (folder !== 'unfiled') warnings.push(`missing folder ${folder}/ (${e.code})`);
      continue;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name) || entry.name.startsWith('.')) continue;
      if (folder === 'unfiled' && (LIFECYCLE.includes(entry.name) || entry.name === ARTIFACT_STORE)) continue;
      const full = path.join(dir, entry.name);
      const isDir = entry.isDirectory();
      if (!isDir && !entry.name.endsWith('.md')) {
        out.push({ folder, path: full, kind: 'artifact', name: entry.name });
        continue;
      }
      out.push({ folder, path: full, kind: isDir ? 'bundle' : 'doc', name: entry.name, isDir });
    }
  }
  return { entries: out, warnings };
}

// Unowned files parked in artifacts/. Not plans; reported so they stay visible.
async function collectArtifactStore(root) {
  const dir = path.join(root, ARTIFACT_STORE);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const st = await stat(full);
    out.push({
      path: full,
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file',
      mtime: st.mtime.toISOString().slice(0, 10),
    });
  }
  return out;
}

// ---------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const folders = opts.folders.length ? opts.folders : [...LIFECYCLE, 'unfiled'];
  const { entries, warnings } = await collectPlans(opts.root, folders);
  const artifactStore = await collectArtifactStore(opts.root);

  const plans = [];
  const artifacts = [];
  for (const entry of entries) {
    if (entry.kind === 'artifact') {
      const st = await stat(entry.path);
      artifacts.push({
        folder: entry.folder,
        path: entry.path,
        name: entry.name,
        mtime: st.mtime.toISOString().slice(0, 10),
        note: `loose artifact — fold into its owning plan directory, or park it in ${ARTIFACT_STORE}/`,
      });
      continue;
    }
    const { mainPath, text, artifacts: bundled } = await readMain(entry.path, entry.isDir);
    const { data, body } = parseFrontmatter(text);
    const st = await stat(mainPath || entry.path);
    const { refs, mentions } = collectRefs({ frontmatter: data, body, defaultRepo: opts.defaultRepo });
    const title = (body.match(/^#\s+(.+)$/m) || [])[1]?.trim() || entry.name.replace(/\.md$/, '');
    plans.push({
      folder: entry.folder,
      path: entry.path,
      mainPath,
      name: entry.name,
      title,
      kind: entry.kind,
      bundledArtifacts: bundled || [],
      frontmatter: data,
      hasFrontmatter: Object.keys(data).length > 0,
      statusMismatch:
        data.status && entry.folder !== 'unfiled' && data.status !== entry.folder
          ? { frontmatter: data.status, folder: entry.folder }
          : null,
      tickets: asList(data.tickets),
      mtime: st.mtime.toISOString().slice(0, 10),
      refs,
      mentions,
      prs: [],
    });
  }

  if (opts.gh) {
    const unique = new Map();
    for (const plan of plans) for (const ref of plan.refs) unique.set(refKey(ref), ref);
    const keys = [...unique.keys()];
    const results = await mapLimit(keys, GH_CONCURRENCY, (key) => {
      const ref = unique.get(key);
      return ghPrView(ref.repo, ref.number);
    });
    const byKey = new Map(keys.map((key, i) => [key, describePr(unique.get(key), results[i])]));
    for (const plan of plans) plan.prs = plan.refs.map((ref) => ({ ...byKey.get(refKey(ref)), sources: ref.sources }));
    const failed = [...byKey.values()].filter((p) => p.status === 'unknown');
    for (const f of failed) warnings.push(`gh lookup failed for ${refKey(f)}: ${f.error}`);
  }

  for (const plan of plans) {
    const c = classify(plan);
    plan.prCounts = c.counts;
    plan.suggestedFolder = c.suggestedFolder;
    plan.needsUser = c.needsUser;
    plan.reasons = c.reasons;
    plan.move = plan.suggestedFolder && plan.suggestedFolder !== plan.folder ? plan.suggestedFolder : null;
    plan.waitingOn = planWaitingOn(plan);
  }

  plans.sort((a, b) => (a.folder === b.folder ? b.mtime.localeCompare(a.mtime) : LIFECYCLE.indexOf(a.folder) - LIFECYCLE.indexOf(b.folder)));

  const summary = {
    byFolder: Object.fromEntries(
      [...LIFECYCLE, 'unfiled'].map((f) => [f, plans.filter((p) => p.folder === f).length]),
    ),
    moves: plans.filter((p) => p.move).length,
    needsUser: plans.filter((p) => p.needsUser).length,
    waitingOnMe: plans.filter((p) => p.waitingOn.startsWith('me:')).length,
    looseArtifacts: artifacts.length,
    artifactStore: artifactStore.length,
    statusMismatches: plans.filter((p) => p.statusMismatch).length,
  };

  const payload = {
    root: opts.root,
    generatedAt: new Date().toISOString(),
    ghQueried: opts.gh,
    summary,
    plans,
    artifacts,
    artifactStore,
    warnings,
  };
  process.stdout.write(JSON.stringify(payload, null, opts.pretty ? 2 : 0) + '\n');
}

main().catch((e) => {
  process.stderr.write(`plan-index: ${e.message}\n`);
  process.exit(1);
});
