/**
 * Family-tree queries over live sessions. Walks `parent` links DOWN from `id`,
 * not a stored-`root` match: `root` names the top of the whole tree, so every
 * node partway down shares its descendants' `root` — a root-match query run
 * from an intermediate node (not the tree's root) would silently return
 * nothing, and a cascade needs "everything beneath THIS node" for any node,
 * not just the root.
 *
 * `parent` can point anywhere — including back up its own ancestry, since the
 * depth cap was deliberately dropped and the cost cap is the only fan-out
 * bound — so the walk tracks `visited` explicitly and refuses to re-descend
 * into an already-visited id. Without that guard a cyclic parent chain would
 * spin the walk forever, and the worst place for that to happen is mid-abort-
 * cascade, hanging the daemon on exactly the path meant to stop it.
 */
export function descendantsOf(
  id: string,
  sessions: Iterable<{ id: string; parent: string | undefined }>,
): string[] {
  const children = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.parent === undefined) continue;
    const siblings = children.get(session.parent);
    if (siblings) siblings.push(session.id);
    else children.set(session.parent, [session.id]);
  }

  const out: string[] = [];
  const visited = new Set<string>([id]);
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || visited.has(next)) continue;
    visited.add(next);
    out.push(next);
    const grandchildren = children.get(next);
    if (grandchildren) stack.push(...grandchildren);
  }
  return out;
}
