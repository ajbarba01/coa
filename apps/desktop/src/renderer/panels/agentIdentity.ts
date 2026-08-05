/** A minimal identity view of an agent — enough to mint a fresh, non-colliding one. */
interface AgentIdentity {
  ref: string;
}

/**
 * Mint the identity for a newly-created agent: a display name plus its `ref` — the
 * bare filename stem the daemon's `AgentRegistry` writes (`<scope-dir>/<ref>.yaml`;
 * `ref` carries no scope prefix, since the directory it lands in already says which
 * scope it's in).
 */
export function nextAgentIdentity(agents: readonly AgentIdentity[]): { ref: string; name: string } {
  // Dedupe against every currently-visible ref (built-in ∪ personal ∪ project), not
  // just names: the ref is the identity/key (and the filename), and a rename can
  // free a name while its ref lives on — checking names would then re-mint a taken
  // ref (two agents, one key). A fresh ref must also never SHADOW an existing agent
  // (refs collide across scopes on purpose — the daemon treats a matching ref in a
  // more specific scope as an override, not two agents).
  const takenRefs = new Set(agents.map((a) => a.ref));
  let name = 'untitled-agent';
  let ref = name;
  for (let n = 2; takenRefs.has(ref); n += 1) {
    name = `untitled-agent-${n}`;
    ref = name;
  }
  return { ref, name };
}
