import { claudeEffortSchema, type ModelDescriptor, type ModelEntry } from '@coa/shared';
import { catalogDescriptor } from './default-catalog.js';

/**
 * The pure SOT projection: the user's list decides membership + order; the live
 * fetch (matched by id) then the shipped catalog supply capabilities; a user
 * override (label, reasoning) outranks every tier. An id no tier knows still
 * assembles to a bare runnable descriptor — the backend is the real authority
 * (an invalid id errors live, never blocked).
 */

const LADDER = claudeEffortSchema.options;

/** The four reasoning-cap fields a profile override replaces wholesale. */
function strippedCaps(base: ModelDescriptor): ModelDescriptor {
  const { supportsEffort: _supportsEffort, supportedEffortLevels: _supportedEffortLevels, supportsAdaptiveThinking: _supportsAdaptiveThinking, supportsThinking: _supportsThinking, ...rest } = base;
  return rest;
}

function applyReasoning(base: ModelDescriptor, entry: ModelEntry): ModelDescriptor {
  const profile = entry.reasoning;
  if (profile === undefined || profile.kind === 'inherit') return base;
  const bare = strippedCaps(base);
  switch (profile.kind) {
    case 'none':
      return bare;
    case 'effort':
      return {
        ...bare,
        supportsEffort: true,
        supportedEffortLevels: LADDER.slice(0, LADDER.indexOf(profile.max) + 1),
      };
    case 'thinking':
      return { ...bare, supportsThinking: true };
    case 'budget':
      return { ...bare, supportsAdaptiveThinking: true };
  }
}

export function effectiveModels(
  providerId: string,
  entries: ModelEntry[],
  live: ModelDescriptor[],
): ModelDescriptor[] {
  return entries
    .filter((entry) => entry.hidden !== true)
    .map((entry) => {
      const base: ModelDescriptor =
        live.find((d) => d.id === entry.id) ??
        catalogDescriptor(providerId, entry.id) ??
        { id: entry.id };
      const withProvider: ModelDescriptor = { ...base, provider: providerId };
      const withLabel: ModelDescriptor =
        entry.label !== undefined ? { ...withProvider, displayName: entry.label } : withProvider;
      return applyReasoning(withLabel, entry);
    });
}
