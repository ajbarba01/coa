// Archived from packages/core/src/compiler/import-bundle.ts
import { type Piece, pieceSchema } from '@coa/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * M5 — `importBundle` (TAX-8): wrap a single Claude-Code `SKILL.md` into one
 * {@link Piece}. With the TAX-* collapse this is no longer a decompose-into-kinds
 * — it is a near-identity WRAP. A vanilla SKILL.md (just `name` + `description`)
 * becomes a Piece at the default axes (`pull` / `never` / `authored`, no link) —
 * the empty-config North Star — and every key coa does not own rides through
 * verbatim in `ccKeys`, so the single-Piece round-trip is lossless.
 *
 * coa-owned front-matter keys ARE recognized (the on-disk Piece is a strict
 * superset of SKILL.md): the three axes (`delivery`/`scope`/`salience`/
 * `provenance`), the `governed-by` authority link, the `source` import-trust
 * descriptor, `bundle`, and the CC `disable-model-invocation` key (→ the
 * `manualOnly` axis). Anything else is an unrecognized CC/plugin key and is kept
 * in `ccKeys`. Validation is LOUD — missing `name`/`description` or an invalid
 * axis value throws rather than yielding a silent half-Piece.
 *
 * Pure + deterministic (P1): text in, Piece out, no IO and no model call. The
 * bundle/asset bidirectional round-trip (binary assets, mount contracts) stays
 * v1.1 (D145) — this is single-Piece content only.
 */

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Front-matter keys coa maps onto typed Piece fields — everything else is a verbatim ccKey. */
const RESERVED = new Set([
  'name',
  'description',
  'delivery',
  'scope',
  'salience',
  'provenance',
  'governed-by',
  'source',
  'bundle',
  'disable-model-invocation',
]);

const frontMatterSchema = z.record(z.string(), z.unknown());

export function importBundle(text: string): Piece {
  const match = FRONT_MATTER.exec(text);
  if (match === null) {
    throw new Error('importBundle: SKILL.md has no YAML front-matter block');
  }
  const [, yaml, body] = match;
  const fm = frontMatterSchema.parse(parseYaml(yaml ?? '') ?? {});

  const ccKeys = Object.fromEntries(Object.entries(fm).filter(([key]) => !RESERVED.has(key)));

  const axes = {
    delivery: fm['delivery'] ?? 'pull',
    ...(fm['scope'] !== undefined ? { scope: fm['scope'] } : {}),
    salience: toSalience(fm['salience']),
    provenance: fm['provenance'] ?? 'authored',
    ...(fm['disable-model-invocation'] !== undefined
      ? { manualOnly: fm['disable-model-invocation'] }
      : {}),
  };

  return pieceSchema.parse({
    name: fm['name'],
    description: fm['description'],
    body: body ?? '',
    axes,
    ...(fm['governed-by'] !== undefined ? { governedBy: fm['governed-by'] } : {}),
    ...(fm['source'] !== undefined ? { source: fm['source'] } : {}),
    ...(fm['bundle'] !== undefined ? { bundle: fm['bundle'] } : {}),
    ...(Object.keys(ccKeys).length > 0 ? { ccKeys } : {}),
  });
}

/** A bare number is the Tier-0 "tokens since last reminder" cadence; absent ⇒ the `never` default. */
function toSalience(raw: unknown): unknown {
  if (raw === undefined) return 'never';
  if (typeof raw === 'number') return { cadenceTokens: raw };
  return raw;
}
