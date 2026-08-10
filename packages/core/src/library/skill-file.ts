import { skillFileSchema, type SkillFile } from '@coa/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Byte-correct `SKILL.md` parsing per Claude Code's convention: an optional
 * YAML front-matter block delimited by `---` lines, then the markdown body.
 * coa reads exactly two keys — `name` (falling back to the skill's directory
 * name, as Claude Code does) and `description` — and keeps every other
 * front-matter key VERBATIM in `ccKeys`, so a linked or copied skill can never
 * lose foreign metadata (`license`, `metadata`, `disable-model-invocation`, …).
 *
 * Adapted from the archived bundle importer's front-matter split
 * (`archive/bundle-importer/import-bundle.ts`), minus its axis interpretation:
 * the library stores skills as-found; mapping onto Piece axes happens at
 * injection time, not at parse time.
 *
 * Pure (text in, {@link SkillFile} out); the scanner owns the filesystem.
 */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** The keys coa maps onto typed fields — everything else is a verbatim ccKey. */
const RESERVED = new Set(['name', 'description']);

const frontMatterSchema = z.record(z.string(), z.unknown());

/**
 * Parse one SKILL.md. `fallbackName` is the skill's directory name — used when
 * the front matter carries no `name`, matching Claude Code's own resolution.
 * Throws on a malformed file (no front-matter block, unparseable YAML, or a
 * non-string name/description); callers surface that as a diagnostic.
 */
export function parseSkillFile(text: string, fallbackName: string): SkillFile {
  const match = FRONT_MATTER.exec(text);
  if (match === null) {
    throw new Error('SKILL.md has no YAML front-matter block');
  }
  const [, yaml, body] = match;
  const fm = frontMatterSchema.parse(parseYaml(yaml ?? '') ?? {});

  const ccKeys = Object.fromEntries(Object.entries(fm).filter(([key]) => !RESERVED.has(key)));

  return skillFileSchema.parse({
    name: fm['name'] ?? fallbackName,
    description: fm['description'] ?? '',
    body: body ?? '',
    ...(Object.keys(ccKeys).length > 0 ? { ccKeys } : {}),
  });
}
