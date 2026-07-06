import {
  DEFAULT_AGENT_LIST,
  PersistedAgentsSchema,
  parsePersistedAgents,
  type AgentSummary,
} from '@coa/console-viewmodel';

/** Serialize the agent list to its persisted, self-describing envelope
 *  (`{ schema_version, agents }`) — the on-disk shape of `agents.json`. */
export function serializeAgents(agents: unknown): unknown {
  return PersistedAgentsSchema.parse({ schema_version: 1, agents });
}

/** Restore the agent list from a persisted blob. Reads the SAME envelope
 *  {@link serializeAgents} writes (not the bare array), so a stored list survives a
 *  reload; a missing / corrupt / unknown-version blob degrades to the empty floor. */
export function deserializeAgents(raw: unknown): AgentSummary[] {
  return parsePersistedAgents(raw) ?? DEFAULT_AGENT_LIST;
}
