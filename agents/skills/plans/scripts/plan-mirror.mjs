#!/usr/bin/env node
// One-way mirror of the ai-docs plan tree into a Notion database.
// ai-docs is the source of truth; Notion is a read-only copy for humans.
// This script never talks to Notion. It computes what changed and records what
// was applied; an agent applies the operations with the Notion MCP tools
// (see plan-mirror-apply.py).
//
//   node plan-mirror.mjs plan   [--root <dir>] [--only <plan-name>] [--out <file>]
//   node plan-mirror.mjs record --plan <file> --results <file> [--root <dir>]
//   node plan-mirror.mjs init   --database <url> --data-source <collection://id> [--root <dir>]
//
// plan    Emits {database, dataSource, ops[]}. Each op carries the content hash
//         it was built from, so `record` stores exactly what was pushed.
// record  Folds apply results ({key, pageId, children: {file: pageId}} per op)
//         into the manifest.
// init    Writes an empty manifest pointing at the database.
//
// Manifest: <root>/.notion-mirror.json, keyed by plan name (file or bundle name,
// which never changes when a plan moves between lifecycle folders).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = '.notion-mirror.json';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, root: process.env.AI_DOCS_ROOT ?? path.join(os.homedir(), 'code', 'ai-docs') };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    switch (flag) {
      case '--root': args.root = value; i += 1; break;
      case '--only': args.only = value; i += 1; break;
      case '--out': args.out = value; i += 1; break;
      case '--plan': args.plan = value; i += 1; break;
      case '--results': args.results = value; i += 1; break;
      case '--database': args.database = value; i += 1; break;
      case '--data-source': args.dataSource = value; i += 1; break;
      default: throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!['plan', 'record', 'init'].includes(command)) {
    throw new Error('usage: plan-mirror.mjs plan|record|init [options]');
  }
  return args;
}

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

async function readManifest(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, MANIFEST), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`no ${MANIFEST} in ${root}; run "init" first`);
    throw error;
  }
}

async function writeManifest(root, manifest) {
  const sorted = Object.fromEntries(Object.entries(manifest.plans).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(path.join(root, MANIFEST), `${JSON.stringify({ ...manifest, plans: sorted }, null, 2)}\n`);
}

// ------------------------------------------------------------ content shaping

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

// Notion-flavored Markdown reads `<tag` as a block or inline tag. Plans use angle
// brackets as prose (`<plan-path>`, `<= 5 s`, HTML in examples), so escape every
// `<` that could open a tag, outside fenced code and inline code.
function escapeTags(line) {
  return line
    .split(/(`+[^`]*`+)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/<(?=[A-Za-z/!])/g, '\\<')))
    .join('');
}

function toNotionMarkdown(markdown, title) {
  let body = markdown.replace(FRONTMATTER, '');
  const lines = body.split('\n');
  const firstContent = lines.findIndex((l) => l.trim() !== '');
  // The page title already carries the H1.
  if (firstContent >= 0 && /^#\s+/.test(lines[firstContent]) && lines[firstContent].replace(/^#\s+/, '').trim() === title.trim()) {
    lines.splice(firstContent, 1);
  }
  let fence = null;
  body = lines
    .map((line) => {
      const open = line.match(/^\s*(`{3,}|~{3,})/);
      if (open) {
        if (fence === null) fence = open[1];
        else if (line.trim().startsWith(fence)) fence = null;
        return line;
      }
      return fence === null ? escapeTags(line) : line;
    })
    .join('\n');
  return body.trim();
}

const banner = (rel) =>
  `<callout icon="🪞">\nRead-only mirror of \`ai-docs/${rel}\`, synced by /plan-sync. Edits made here are overwritten.\n</callout>`;

// --------------------------------------------------------------- plan reading

function indexPlans(root) {
  const out = execFileSync('node', [path.join(HERE, 'plan-index.mjs'), '--no-gh', '--root', root], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out).plans;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.name.startsWith('.')) return []; // agent scratch files (.agent-task.md) stay local
      return e.isDirectory() ? walk(full) : [full];
    }),
  );
  return files.flat();
}

const joinList = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '');

function properties(plan, rel) {
  const fm = plan.frontmatter ?? {};
  const props = {
    Name: plan.title || plan.name,
    Status: plan.folder,
    Path: rel,
    // Select property: an empty string isn't an option, null clears it.
    'Waiting on': fm.waiting_on || null,
    'Next action': fm.next_action ?? '',
    PRs: joinList(fm.prs),
    Tickets: joinList(fm.tickets),
  };
  for (const [field, key] of [['created', 'Created'], ['updated', 'Updated']]) {
    const value = String(fm[field] ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      props[`date:${key}:start`] = value;
      props[`date:${key}:is_datetime`] = 0;
    }
  }
  return props;
}

async function buildPlan(root, plan) {
  const rel = path.relative(root, plan.path);
  const mainRel = path.relative(root, plan.mainPath);
  const title = plan.title || plan.name;
  const content = `${banner(mainRel)}\n\n${toNotionMarkdown(await fs.readFile(plan.mainPath, 'utf8'), title)}`;
  const props = properties(plan, rel);
  const children = {};
  if (plan.kind === 'bundle') {
    for (const file of (await walk(plan.path)).filter((f) => f.endsWith('.md') && f !== plan.mainPath).sort()) {
      const childRel = path.relative(plan.path, file);
      const childContent = `${banner(path.relative(root, file))}\n\n${toNotionMarkdown(await fs.readFile(file, 'utf8'), childRel)}`;
      children[childRel] = { title: childRel, content: childContent, hash: sha(childContent) };
    }
  }
  return {
    key: plan.name,
    properties: props,
    content,
    contentHash: sha(content),
    propsHash: sha(JSON.stringify(props)),
    children,
  };
}

// ------------------------------------------------------------------ commands

async function planCommand(args) {
  const manifest = await readManifest(args.root);
  const plans = indexPlans(args.root).filter((p) => !args.only || p.name === args.only);
  const ops = [];
  const seen = new Set();
  for (const plan of plans) {
    const built = await buildPlan(args.root, plan);
    seen.add(built.key);
    const prior = manifest.plans[built.key];
    if (!prior) {
      ops.push({ op: 'create', ...built, children: Object.entries(built.children).map(([file, c]) => ({ op: 'create', file, ...c })) });
      continue;
    }
    const childOps = [];
    // Subpages that stay as they are. replace_content on the row deletes any subpage it doesn't
    // reference, so the executor has to list these too.
    const unchangedChildren = {};
    for (const [file, c] of Object.entries(built.children)) {
      const before = prior.children?.[file];
      if (!before) childOps.push({ op: 'create', file, ...c });
      else if (before.hash !== c.hash) childOps.push({ op: 'update', file, pageId: before.pageId, ...c });
      else unchangedChildren[file] = before.pageId;
    }
    for (const [file, before] of Object.entries(prior.children ?? {})) {
      if (!built.children[file]) childOps.push({ op: 'trash', file, pageId: before.pageId });
    }
    const contentChanged = prior.contentHash !== built.contentHash;
    const propsChanged = prior.propsHash !== built.propsHash;
    if (contentChanged || propsChanged || childOps.length > 0) {
      ops.push({
        op: 'update',
        key: built.key,
        pageId: prior.pageId,
        properties: propsChanged ? built.properties : undefined,
        content: contentChanged ? built.content : undefined,
        contentHash: built.contentHash,
        propsHash: built.propsHash,
        children: childOps,
        unchangedChildren,
      });
    }
  }
  if (!args.only) {
    for (const [key, prior] of Object.entries(manifest.plans)) {
      if (!seen.has(key)) ops.push({ op: 'trash', key, pageId: prior.pageId });
    }
  }
  const out = JSON.stringify({ database: manifest.database, dataSource: manifest.dataSource, ops }, null, 2);
  if (args.out) await fs.writeFile(args.out, out);
  else process.stdout.write(`${out}\n`);
  const count = (kind) => ops.filter((o) => o.op === kind).length;
  process.stderr.write(`plan-mirror: ${count('create')} create, ${count('update')} update, ${count('trash')} trash\n`);
}

async function recordCommand(args) {
  if (!args.plan || !args.results) throw new Error('record needs --plan and --results');
  const manifest = await readManifest(args.root);
  const { ops } = JSON.parse(await fs.readFile(args.plan, 'utf8'));
  const results = new Map(JSON.parse(await fs.readFile(args.results, 'utf8')).map((r) => [r.key, r]));
  let recorded = 0;
  for (const op of ops) {
    const result = results.get(op.key);
    if (!result || result.error) continue; // not applied: stays pending for the next run
    if (op.op === 'trash') {
      delete manifest.plans[op.key];
      recorded += 1;
      continue;
    }
    const prior = manifest.plans[op.key] ?? { children: {} };
    const children = { ...prior.children };
    for (const child of op.children ?? []) {
      const childResult = result.children?.[child.file];
      if (!childResult || childResult.error) continue;
      if (child.op === 'trash') delete children[child.file];
      else children[child.file] = { pageId: childResult.pageId ?? child.pageId, hash: child.hash };
    }
    manifest.plans[op.key] = {
      pageId: result.pageId ?? prior.pageId,
      contentHash: op.content !== undefined || op.op === 'create' ? op.contentHash : prior.contentHash,
      propsHash: op.properties !== undefined || op.op === 'create' ? op.propsHash : prior.propsHash,
      children,
    };
    recorded += 1;
  }
  manifest.syncedAt = new Date().toISOString();
  await writeManifest(args.root, manifest);
  process.stderr.write(`plan-mirror: recorded ${recorded} of ${ops.length} ops\n`);
}

async function initCommand(args) {
  if (!args.database || !args.dataSource) throw new Error('init needs --database and --data-source');
  const target = path.join(args.root, MANIFEST);
  try {
    await fs.access(target);
    throw new Error(`${target} already exists`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeManifest(args.root, { database: args.database, dataSource: args.dataSource, syncedAt: null, plans: {} });
}

const args = parseArgs(process.argv.slice(2));
const commands = { plan: planCommand, record: recordCommand, init: initCommand };
commands[args.command](args).catch((error) => {
  process.stderr.write(`plan-mirror: ${error.message}\n`);
  process.exit(1);
});
