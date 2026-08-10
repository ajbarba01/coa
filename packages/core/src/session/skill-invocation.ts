/**
 * Slash invocation (`/skill`) — the explicit one-turn load. Following Claude
 * Code's treatment of a typed skill command, an invocation expands into the
 * turn's own context (visible in the transcript) rather than recompiling the
 * frozen system prompt: the skill's body is rendered as a tagged block ABOVE
 * the user's text in the model-facing input, and persisted as its own
 * `system`-role text frame so live delivery, the durable log, and a later
 * cross-provider replay all carry the same bytes. (Live the backend receives
 * one composed message; replay folds the block and the user text as two
 * user-role messages — same content, a documented wire-shape difference.)
 */

/** A resolved invocation riding a queued turn: the skill's library name + body. */
export interface InvokedSkill {
  name: string;
  body: string;
}

/** One invocation as both the model input and the persisted `system` frame render it. */
export function renderInvokedSkill(skill: InvokedSkill): string {
  return `<invoked-skill name="${skill.name}">\n${skill.body}\n</invoked-skill>`;
}

/**
 * The model-facing input for a turn: any invoked skills' payload blocks above
 * the user's text. No invocations ⇒ the raw input, byte-identical to before.
 */
export function composeTurnInput(turn: {
  input: string;
  invokedSkills?: readonly InvokedSkill[] | undefined;
}): string {
  const invoked = turn.invokedSkills ?? [];
  if (invoked.length === 0) return turn.input;
  return [...invoked.map(renderInvokedSkill), turn.input].join('\n\n');
}
