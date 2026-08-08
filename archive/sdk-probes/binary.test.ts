// Archived from packages/adapter-claude-sdk/src/control/binary.test.ts.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Control-spike binary track (plan Task 7). The offline `captureSpawn` probes see
 * only what the SDK puts on argv/env; this track reads the shipped `claude`
 * binary itself for facts those probes cannot reach — what triggers compaction,
 * whether the native subagent/delegation naming has churned, what
 * `settingSources: []` genuinely excludes, and whether built-in tool
 * schemas/descriptions are present at all.
 *
 * ASSERTS STRUCTURE ONLY: presence of a marker, a count, a boolean, a checksum
 * match. Nothing read out of the binary is embedded here — the SDK's license is
 * "(c) Anthropic PBC. All rights reserved." Findings from this track were only
 * ever recorded as paraphrase; nothing was pasted.
 *
 * This track is explicitly LOWER-CONFIDENCE than the argv probes: a Bun
 * single-file executable embeds minified, unstructured JS, so a marker's absence
 * proves nothing and a marker's presence only proves the underlying mechanism
 * exists in the binary somewhere, not how the SDK's Options surface reaches it.
 * Where this track and an argv probe disagree, the probe wins.
 *
 * Version stamp: SDK 0.3.196, CLI 2.1.196, commit
 * a4ca500badcac68511fb5f04303e32e4360f3dfb. Every assertion below is a version
 * tripwire for that pair — a future CLI build that drops one of these markers
 * (a real rename/removal, not just re-minification, since all markers below are
 * literal string VALUES — event names, wire field names, Options property names —
 * not local variable names a minifier is free to rewrite) fails the corresponding
 * test, which is the signal that the stage-5/stage-7 ledger rows need re-checking
 * against the new version.
 */

const req = createRequire(import.meta.url);

interface BinaryManifest {
  version: string;
  commit: string;
  buildDate: string;
  platforms: Record<string, { binary: string; checksum: string; size: number }>;
}

/**
 * Resolve a file that ships alongside `sdk.mjs` inside the
 * `@anthropic-ai/claude-agent-sdk` package. `manifest.json` is not listed in the
 * package's `exports` map (only `.`, `./extract`, `./browser`, `./bridge`,
 * `./sdk-tools[.js]` are), so `require.resolve('.../manifest.json')` and even
 * `require.resolve('.../package.json')` are both blocked by Node's exports
 * enforcement. The one subpath `exports['.']` does expose is the main entry
 * (`sdk.mjs`); resolving that and joining from its directory is the only route
 * in that survives the exports map.
 */
function resolveSdkSiblingFile(filename: string): string | undefined {
  let entry: string;
  try {
    entry = req.resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return undefined;
  }
  const candidate = join(dirname(entry), filename);
  return existsSync(candidate) ? candidate : undefined;
}

function readManifest(): BinaryManifest | undefined {
  const path = resolveSdkSiblingFile('manifest.json');
  if (path === undefined) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as BinaryManifest;
}

/**
 * Resolve the per-platform binary package (e.g.
 * `@anthropic-ai/claude-agent-sdk-win32-x64`). It is an `optionalDependency` of
 * `@anthropic-ai/claude-agent-sdk` itself, not of this package — pnpm's isolated
 * store places it in the node_modules directory that is an ANCESTOR of the SDK
 * package's own file (its virtual-store sibling), which is outside what
 * `require.resolve` from THIS file's `createRequire` context can see. Chaining a
 * second `createRequire` off the SDK's own resolved entry point puts the lookup
 * in the right resolution context.
 */
function resolvePlatformBinary(): { path: string; platformKey: string } | undefined {
  let entry: string;
  try {
    entry = req.resolve('@anthropic-ai/claude-agent-sdk');
  } catch {
    return undefined;
  }
  const platformKey = `${process.platform}-${process.arch}`;
  const packageName = `@anthropic-ai/claude-agent-sdk-${platformKey}`;
  const binaryName = process.platform === 'win32' ? 'claude.exe' : 'claude';

  const sdkRequire = createRequire(entry);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = sdkRequire.resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
  const binaryPath = join(dirname(pkgJsonPath), binaryName);
  return existsSync(binaryPath) ? { path: binaryPath, platformKey } : undefined;
}

/**
 * Stream `filePath` in bounded chunks (never holding the whole binary in memory)
 * and count non-overlapping occurrences of each marker. A small overlap window
 * carries the chunk boundary so a marker split across two reads is not missed.
 */
function scanForMarkers(filePath: string, markers: readonly string[]): Map<string, number> {
  const CHUNK = 16 * 1024 * 1024;
  const OVERLAP = 256; // longest marker below is well under this
  const counts = new Map<string, number>(markers.map((m) => [m, 0]));
  const needles = markers.map((m) => Buffer.from(m, 'utf8'));

  const fd = openSync(filePath, 'r');
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK);
    let position = 0;
    let carry = Buffer.alloc(0);

    while (position < size) {
      const toRead = Math.min(CHUNK, size - position);
      const bytesRead = readSync(fd, buf, 0, toRead, position);
      const chunk = Buffer.concat([carry, buf.subarray(0, bytesRead)]);

      for (let i = 0; i < markers.length; i++) {
        const needle = needles[i]!;
        const marker = markers[i]!;
        let idx = 0;
        for (;;) {
          const found = chunk.indexOf(needle, idx);
          if (found === -1) break;
          counts.set(marker, (counts.get(marker) ?? 0) + 1);
          idx = found + 1;
        }
      }

      carry = chunk.subarray(Math.max(0, chunk.length - OVERLAP));
      position += bytesRead;
    }
  } finally {
    closeSync(fd);
  }
  return counts;
}

/** sha256 of the file at `filePath`, streamed (never the whole file in memory). */
function sha256Of(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: 16 * 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

describe('binary track — the manifest (plain JSON, always checkable)', () => {
  it('pins one checksummed binary per platform for a known CLI build', () => {
    const manifest = readManifest();
    expect(manifest).toBeDefined();
    expect(manifest?.version).toBe('2.1.196');
    expect(manifest?.commit).toBe('a4ca500badcac68511fb5f04303e32e4360f3dfb');
    const platformKeys = Object.keys(manifest?.platforms ?? {});
    expect(platformKeys).toContain('win32-x64');
    expect(platformKeys.length).toBeGreaterThanOrEqual(8);
    for (const platform of Object.values(manifest?.platforms ?? {})) {
      expect(platform.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(platform.size).toBeGreaterThan(100_000_000);
    }
  });
});

const platformBinary = resolvePlatformBinary();

describe.skipIf(platformBinary === undefined)(
  'binary track — the shipped platform binary (best-effort, this-platform-only)',
  () => {
    it('resolves to a file matching the manifest size and checksum for this platform', async () => {
      const manifest = readManifest();
      expect(manifest).toBeDefined();
      expect(platformBinary).toBeDefined();
      const entry = manifest?.platforms[platformBinary!.platformKey];
      expect(entry, `manifest has no entry for ${platformBinary!.platformKey}`).toBeDefined();

      const size = fstatSync(openSync(platformBinary!.path, 'r')).size;
      expect(size).toBe(entry?.size);

      const digest = await sha256Of(platformBinary!.path);
      expect(digest).toBe(entry?.checksum);
    }, 30_000);
  },
);

/**
 * Anchor markers, one per structural question this track was asked to settle.
 * Every entry is a literal string VALUE the binary references by identity (an
 * event name, a wire/telemetry field name, an SDK Options property name) — never
 * a local variable name, which a minifier is free to rewrite build-to-build. A
 * hit therefore survives re-minification and only goes away on a real
 * rename/removal, which is what makes presence here a genuine version tripwire.
 */
const ANCHORS = [
  // Q1 — compaction: is any part of it observable/controllable?
  'PreCompact',
  'PostCompact',
  'autoCompactWindow',
  'microcompact_boundary',
  // Q2 — the claude_code preset identifier reaching the wire at all
  'claude_code',
  // Q4 — settingSources: the option name the D108 isolation claim binds to, plus
  // a second Options field the same isolation mechanism carries
  'settingSources',
  'strictMcpConfig',
  'toolAliases',
  // Q3 — built-in tools: subagent_type is the delegation tool's own input field,
  // confirming a real (not just typed) schema exists on the built-in side
  // Q5 — native subagent machinery
  'SubagentStart',
  'SubagentStop',
  'isSidechain',
  'subagent_type',
  'is_built_in_agent',
  'taskBudget',
  'forwardSubagentText',
  // The Task/Agent naming-churn lead (arc risk R2): a distinctive value from an
  // internal name-alias table, not the (too-common-to-be-meaningful) bare words
  // "Task" or "Agent".
  'TaskOutput',
] as const;

describe.skipIf(platformBinary === undefined)(
  'binary track — scan-based structural facts (best-effort, lower-confidence than the argv probes)',
  () => {
    let hits: Map<string, number>;

    beforeAll(() => {
      hits = scanForMarkers(platformBinary!.path, ANCHORS);
    }, 60_000);

    it('scanned every anchor marker (sanity: the map is fully populated)', () => {
      expect(hits.size).toBe(ANCHORS.length);
    });

    it('references PreCompact and PostCompact — compaction is at least nominally observable', () => {
      expect(hits.get('PreCompact')).toBeGreaterThan(0);
      expect(hits.get('PostCompact')).toBeGreaterThan(0);
    });

    it('carries a configurable auto-compact window, not just a fixed threshold', () => {
      // Presence only — the scan could not settle whether this is reachable from
      // Options at all (the argv probes found no compaction-related flag; see the
      // findings doc). This just confirms the concept exists inside the binary.
      expect(hits.get('autoCompactWindow')).toBeGreaterThan(0);
    });

    it('references a distinct micro-compaction concept, separate from full compaction', () => {
      expect(hits.get('microcompact_boundary')).toBeGreaterThan(0);
    });

    it('carries the claude_code preset identifier', () => {
      expect(hits.get('claude_code')).toBeGreaterThan(0);
    });

    it('references the strictMcpConfig option coa already sets', () => {
      expect(hits.get('strictMcpConfig')).toBeGreaterThan(0);
    });

    it('references settingSources and toolAliases by name', () => {
      expect(hits.get('settingSources')).toBeGreaterThan(0);
      expect(hits.get('toolAliases')).toBeGreaterThan(0);
    });

    it('carries SubagentStart/SubagentStop as hook-event values', () => {
      expect(hits.get('SubagentStart')).toBeGreaterThan(0);
      expect(hits.get('SubagentStop')).toBeGreaterThan(0);
    });

    it('tags spawned subagent conversations with an internal sidechain concept', () => {
      expect(hits.get('isSidechain')).toBeGreaterThan(0);
    });

    it("carries the delegation tool call's own subagent_type input field", () => {
      expect(hits.get('subagent_type')).toBeGreaterThan(0);
    });

    it('distinguishes built-in from custom/user-defined subagents at runtime', () => {
      expect(hits.get('is_built_in_agent')).toBeGreaterThan(0);
    });

    it('carries a taskBudget concept and a forwardSubagentText concept', () => {
      expect(hits.get('taskBudget')).toBeGreaterThan(0);
      expect(hits.get('forwardSubagentText')).toBeGreaterThan(0);
    });

    it('contains a distinctive value from an internal tool-name alias table (naming has churned)', () => {
      // Structural lead only, not a verdict on which spelling ships on the wire
      // today (system:init vs. tool_use vs. denial records) — that needs the live
      // pass per the arc risk R2 question. See the findings doc.
      expect(hits.get('TaskOutput')).toBeGreaterThan(0);
    });
  },
);
