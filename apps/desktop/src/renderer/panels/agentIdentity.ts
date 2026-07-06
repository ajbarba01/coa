/** A minimal identity view of an agent — enough to mint a fresh, non-colliding one. */
interface AgentIdentity {
  ref: string;
  name: string;
}

/**
 * Mint the identity for a newly-created agent: a display name plus the `roles/<name>`
 * (project) or `personal/<name>` (personal) ref that keys it.
 */
export function nextAgentIdentity(
  agents: readonly AgentIdentity[],
  scope: 'project' | 'personal',
): AgentIdentity {
  const prefix = scope === 'project' ? 'roles' : 'personal';
  // Dedupe against existing REFS, not names: the ref is the identity/key, and a rename
  // can free a name while its ref lives on — checking names would then re-mint a taken
  // ref (two agents, one key). Bump the numeric suffix until the ref itself is free.
  const takenRefs = new Set(agents.map((a) => a.ref));
  let name = 'untitled-agent';
  let ref = `${prefix}/${name}`;
  for (let n = 2; takenRefs.has(ref); n += 1) {
    name = `untitled-agent-${n}`;
    ref = `${prefix}/${name}`;
  }
  return { ref, name };
}
