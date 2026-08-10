import type { AgentSummary } from '@coa/shared';

/**
 * The code-shipped agent definitions, always in scope. These are what make one
 * dispatch path tolerable: there is no ad-hoc "give me a worker on model X" call,
 * so a generic worker and a read-only explorer are the escape hatch. A user
 * definition with the same ref overrides these (most specific wins).
 *
 * Descriptions are written for a MODEL to choose between, not for a settings pane:
 * they say what the agent is for and what it will not do.
 */
export const BUILTIN_AGENTS: readonly AgentSummary[] = [
  {
    ref: 'general-purpose',
    scope: 'builtin',
    name: 'General purpose',
    description:
      'A general worker for multi-step tasks: reads, searches, plans, and edits code. Use it when the work needs changes made, or when no more specific agent fits.',
    icon: 'bot',
    color: 'slate',
    roles: ['swe'],
  },
  {
    ref: 'explorer',
    scope: 'builtin',
    name: 'Explorer',
    description:
      'A read-only investigator for questions that need many files read before answering. It searches, reads, and reports what it found; it never edits.',
    icon: 'search',
    color: 'sky',
    roles: ['researcher'],
    // F2: makes "it never edits" an ENFORCED fact, not just a prompt-level claim —
    // a spawned explorer session starts in plan mode (no writes, no commands, ever).
    defaultMode: 'plan',
  },
];
