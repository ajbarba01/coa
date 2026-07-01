import {
  LayoutDescriptorSchema,
  LAYOUT_VERSION,
  type LayoutDescriptor,
  type Region,
} from './schema.js';
import type { PanelRegistry } from '../panel/registry.js';

/** A single version-to-next-version upgrade. */
export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** version n -> n+1. Empty at v1 (the first version); grows as the shape evolves. */
export const migrations: Record<number, Migration> = {};

function runMigrations(raw: Record<string, unknown>): Record<string, unknown> {
  let cur = raw;
  while (typeof cur['version'] === 'number' && cur['version'] < LAYOUT_VERSION) {
    const step = migrations[cur['version']];
    if (!step) break;
    cur = step(cur);
  }
  return cur;
}

/** Remove leaves whose panelId is unknown; prune splits emptied by the removal
 *  and collapse single-child splits. Returns null if the whole tree collapses. */
function pruneUnknown(region: Region, registry: PanelRegistry): Region | null {
  if (region.type === 'leaf') {
    return registry.has(region.panelId) ? region : null;
  }
  const kept = region.children
    .map((c) => pruneUnknown(c, registry))
    .filter((c): c is Region => c !== null);
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0] as Region;
  return { ...region, children: kept };
}

/** Validate persisted (untrusted) layout: migrate to the current version, parse,
 *  drop unknown panels, and fall back to `fallback` rather than ever throwing. */
export function parseDescriptor(
  raw: unknown,
  registry: PanelRegistry,
  fallback: LayoutDescriptor,
): LayoutDescriptor {
  try {
    const migrated =
      raw !== null && typeof raw === 'object' ? runMigrations(raw as Record<string, unknown>) : raw;
    const parsed = LayoutDescriptorSchema.parse(migrated);
    const pruned = pruneUnknown(parsed.root, registry);
    if (pruned === null) return fallback;
    return { version: parsed.version, root: pruned };
  } catch {
    return fallback;
  }
}
