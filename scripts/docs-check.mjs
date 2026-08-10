#!/usr/bin/env node
// Router/orphan + dead-link check for the permanent doc set.
// Transient corpora (superpowers/research/archive) and personal notes are excluded.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINTS = ['AGENTS.md', 'README.md']; // roots of the reachability graph
// Dir prefixes and exact files excluded from the indexed set (the `rel === ig` check handles exact files):
// DEV-NOTES.md is the maintainer's personal scratch notes; CLAUDE.local.md is the
// gitignored per-machine instructions file — both live outside the indexed set.
const IGNORE = [
  'docs/superpowers',
  'docs/design/research',
  'docs/archive',
  'archive',
  'node_modules',
  'DEV-NOTES.md',
  'CLAUDE.local.md',
];
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

const toPosix = (p) => relative(ROOT, p).split(sep).join('/');
const ignored = (p) => {
  const rel = toPosix(p);
  return IGNORE.some((ig) => rel === ig || rel.startsWith(ig + '/'));
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (ignored(p)) continue;
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function localLinks(file) {
  const out = [];
  for (const m of readFileSync(file, 'utf8').matchAll(LINK_RE)) {
    let t = m[1].trim().split(/\s+/)[0]; // drop optional "title"
    if (/^(https?:|mailto:|#)/.test(t)) continue; // external / anchor-only
    t = t.split('#')[0]; // strip anchor
    if (t) out.push(t);
  }
  return out;
}

// Resolve a link target: if it points at a directory, treat `<dir>/README.md` as
// the reached doc (a nav row linking a directory, e.g. `docs/adr/`, should not be
// falsely flagged as dead, and its README should be queued as the reached page).
function resolveTarget(base, t) {
  const r = resolve(base, t);
  if (existsSync(r) && statSync(r).isDirectory()) {
    return join(r, 'README.md');
  }
  return r;
}

const rootMd = readdirSync(ROOT)
  .filter((n) => n.endsWith('.md'))
  .map((n) => join(ROOT, n));
const docsMd = existsSync(join(ROOT, 'docs')) ? walk(join(ROOT, 'docs')) : [];
const allDocs = [...rootMd, ...docsMd].filter((p) => !ignored(p));

// Dead-link check
const deadLinks = [];
for (const file of allDocs) {
  for (const t of localLinks(file)) {
    const r = resolve(dirname(file), t);
    if (existsSync(r)) continue; // direct hit (file or directory)
    if (existsSync(resolveTarget(dirname(file), t))) continue; // directory -> README.md
    deadLinks.push(`${toPosix(file)} -> ${t}`);
  }
}

// Router/orphan check: BFS from entry points over in-repo .md links
const reachable = new Set();
const queue = ENTRY_POINTS.map((p) => join(ROOT, p));
while (queue.length) {
  const file = queue.shift();
  const key = resolve(file);
  if (reachable.has(key)) continue;
  reachable.add(key);
  if (!existsSync(file) || !file.endsWith('.md')) continue;
  for (const t of localLinks(file)) {
    const r = resolveTarget(dirname(file), t);
    if (r.endsWith('.md') && existsSync(r) && !ignored(r)) queue.push(r);
  }
}
const orphans = allDocs.filter((p) => !reachable.has(resolve(p)));

let failed = false;
if (deadLinks.length) {
  failed = true;
  console.error(`\n✗ Dead links (${deadLinks.length}):`);
  deadLinks.forEach((d) => console.error(`  ${d}`));
}
if (orphans.length) {
  failed = true;
  console.error(`\n✗ Not reachable from the router (${orphans.length}):`);
  orphans.forEach((o) => console.error(`  ${toPosix(o)}`));
}
if (failed) {
  console.error('\ndocs-check FAILED\n');
  process.exit(1);
}
console.log(`docs-check OK — ${allDocs.length} docs, all reachable, no dead links.`);
