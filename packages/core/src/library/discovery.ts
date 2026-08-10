import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  DiscoveredMcpServer,
  DiscoveredSkill,
  LibraryDiagnostic,
  McpLayer,
} from '@coa/shared';
import { parseClaudeUserConfig, parseMcpJson, type NormalizedServer } from './mcp-config.js';
import { parseSkillFile } from './skill-file.js';

/**
 * The library discovery scanner: find skills and MCP servers already on this
 * machine, in the places the surrounding tools actually put them. Local disk
 * only — no registry browsing. Skills come from Claude Code's two skill
 * directories plus Codex's user-level one (the user-dir plugin-discovery
 * posture: enumerate a well-known directory, one capability per subdirectory —
 * as Insomnia/Hyper do for plugins); MCP servers come from the three Claude
 * Code config layers, precedence local > project > user.
 *
 * Every unreadable/unparseable file is a diagnostic, never a silent skip; a
 * missing directory or config file is the floor, not an error. The filesystem
 * is a thin injected edge ({@link LibraryScanIO}) so tests run on fixture trees.
 */

export interface LibraryScanIO {
  /** Subdirectory names of `dir`; `[]` when the directory is missing. */
  readonly readDirNames: (dir: string) => string[];
  /** Throws when the file is missing/unreadable. */
  readonly readFile: (path: string) => string;
  readonly exists: (path: string) => boolean;
}

export const defaultLibraryScanIO: LibraryScanIO = {
  readDirNames: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => {
          // Skill managers install skills as symlinks/junctions, and Claude Code
          // itself follows them — a Dirent that is not a directory may still NAME
          // one, so follow with a stat instead of trusting `Dirent.isDirectory()`
          // (which is false for every link). A dangling link is not a skill
          // directory; it is skipped like any plain file, never a throw.
          if (entry.isDirectory()) return true;
          try {
            return statSync(join(dir, entry.name)).isDirectory();
          } catch {
            return false;
          }
        })
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  exists: (path) => existsSync(path),
};

export interface LibraryPaths {
  readonly home: string;
  readonly projectRoot: string;
}

export interface LibraryScan {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcpServer[];
  diagnostics: LibraryDiagnostic[];
}

/** The skill roots, in the order they are reported. */
function skillRoots(paths: LibraryPaths): { dir: string; origin: DiscoveredSkill['origin'] }[] {
  return [
    { dir: join(paths.home, '.claude', 'skills'), origin: 'claude-user' },
    { dir: join(paths.projectRoot, '.claude', 'skills'), origin: 'claude-project' },
    { dir: join(paths.home, '.codex', 'skills'), origin: 'codex-user' },
  ];
}

export function scanLibrary(
  paths: LibraryPaths,
  io: LibraryScanIO = defaultLibraryScanIO,
): LibraryScan {
  const scan: LibraryScan = { skills: [], mcpServers: [], diagnostics: [] };
  scanSkills(paths, io, scan);
  scanMcpServers(paths, io, scan);
  return scan;
}

function scanSkills(paths: LibraryPaths, io: LibraryScanIO, scan: LibraryScan): void {
  for (const { dir, origin } of skillRoots(paths)) {
    // Sorted so two machines scanning the same tree report the same order.
    for (const name of io.readDirNames(dir).sort()) {
      const path = join(dir, name, 'SKILL.md');
      if (!io.exists(path)) continue; // a bare directory is not a skill — not a diagnostic
      try {
        const skill = parseSkillFile(io.readFile(path), name);
        scan.skills.push({ name: skill.name, description: skill.description, path, origin });
      } catch (err) {
        scan.diagnostics.push({
          kind: 'skill',
          path,
          problem: 'invalid',
          detail: err instanceof Error ? err.message : 'unreadable',
        });
      }
    }
  }
}

/** Path-resolve equality — how `~/.claude.json` project keys are matched to the daemon's root. */
function samePath(a: string, b: string): boolean {
  return resolve(a).toLowerCase() === resolve(b).toLowerCase();
}

function scanMcpServers(paths: LibraryPaths, io: LibraryScanIO, scan: LibraryScan): void {
  // Collected per layer first, then flattened in precedence order so shadowing
  // is computable: a name claimed by an earlier (more local) layer — or by an
  // earlier entry in the SAME layer (duplicate project keys) — marks every
  // later occurrence with `shadowedBy` rather than dropping it (surfaced, honest).
  const layers: {
    layer: McpLayer;
    configPath: string;
    servers: [string, NormalizedServer][];
  }[] = [];

  const claudeUserPath = join(paths.home, '.claude.json');
  if (io.exists(claudeUserPath)) {
    try {
      const parsed = parseClaudeUserConfig(
        io.readFile(claudeUserPath),
        paths.projectRoot,
        samePath,
      );
      layers.push({
        layer: 'claude-local',
        configPath: claudeUserPath,
        // The merged winners first, then the duplicate-key losers: the claimed-map
        // below turns each loser into a shadowed entry of this same layer.
        servers: [
          ...Object.entries(parsed.local),
          ...parsed.localShadowed.map(({ name, server }): [string, NormalizedServer] => [
            name,
            server,
          ]),
        ],
      });
      layers.push({
        layer: 'claude-user',
        configPath: claudeUserPath,
        servers: Object.entries(parsed.user),
      });
    } catch (err) {
      scan.diagnostics.push({
        kind: 'mcp',
        path: claudeUserPath,
        problem: 'invalid',
        detail: err instanceof Error ? err.message : 'unreadable',
      });
    }
  }

  const projectMcpPath = join(paths.projectRoot, '.mcp.json');
  if (io.exists(projectMcpPath)) {
    try {
      const parsed = parseMcpJson(io.readFile(projectMcpPath));
      // Precedence slot: local > project > user.
      const insertAt = layers.findIndex((l) => l.layer === 'claude-user');
      const entry = {
        layer: 'project-mcp' as const,
        configPath: projectMcpPath,
        servers: Object.entries(parsed.servers),
      };
      if (insertAt === -1) layers.push(entry);
      else layers.splice(insertAt, 0, entry);
    } catch (err) {
      scan.diagnostics.push({
        kind: 'mcp',
        path: projectMcpPath,
        problem: 'invalid',
        detail: err instanceof Error ? err.message : 'unreadable',
      });
    }
  }

  const claimed = new Map<string, McpLayer>();
  for (const { layer, configPath, servers } of layers) {
    // A stable sort keeps a duplicate-key winner ahead of its same-name loser.
    for (const [name, normalized] of [...servers].sort(([a], [b]) => a.localeCompare(b))) {
      if (!normalized.ok) {
        scan.diagnostics.push({
          kind: 'mcp',
          path: configPath,
          name,
          problem: 'invalid',
          detail: normalized.error,
        });
        continue;
      }
      const shadowedBy = claimed.get(name);
      scan.mcpServers.push({
        name,
        configPath,
        layer,
        config: normalized.entry,
        ...(shadowedBy !== undefined ? { shadowedBy } : {}),
      });
      if (shadowedBy === undefined) claimed.set(name, layer);
    }
  }
}
