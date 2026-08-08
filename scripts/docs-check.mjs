#!/usr/bin/env node
// Router/orphan + dead-link check for the permanent doc set: every indexed doc must be
// reachable from an entry point, and every in-repo link must resolve.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINTS = ['AGENTS.md', 'README.md']; // roots of the reachability graph
// Dir prefixes and exact files excluded from the indexed set (the `rel === ig` check handles
// exact files). `archive/` is parked feature code, deliberately outside every gate — linking
// TO its README is fine, but its own pages are not part of the index. CLAUDE.local.md is the
// gitignored per-machine instructions file.
const IGNORE = ['archive', 'node_modules', 'CLAUDE.local.md'];
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

// Which docs a link target reaches. A link to a file reaches that file. A link to a
// DIRECTORY reaches its README.md when it has one, and every .md inside it when it does
// not — so one nav row can index a whole corpus (`docs/recipes/`) without forcing an
// index page into it.
function reachedDocs(base, t) {
  const r = resolve(base, t);
  if (!existsSync(r) || ignored(r)) return [];
  if (statSync(r).isDirectory()) {
    const readme = join(r, 'README.md');
    return existsSync(readme) ? [readme] : walk(r);
  }
  return r.endsWith('.md') ? [r] : [];
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
    if (existsSync(resolve(dirname(file), t))) continue; // direct hit (file or directory)
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
  for (const t of localLinks(file)) queue.push(...reachedDocs(dirname(file), t));
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
