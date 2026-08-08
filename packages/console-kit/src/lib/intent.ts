/* The retired legacy kit's proven discipline, copied rather than imported: the point of
 * retiring that kit was to leave nothing depending on it. */

/** The per-component usage declaration. Presence + completeness are enforced;
 *  correctness is a review judgment. All intents compile into COMPONENTS.md. */
export interface ComponentIntent {
  /** Component export name, e.g. 'Button'. */
  name: string;
  /** Family bucket, e.g. 'Actions'. */
  family: string;
  /** One sentence: what it is for. */
  intent: string;
  /** When to reach for it. */
  useWhen: string[];
  /** When NOT to — the governance lever. */
  dontUseWhen: string[];
  /** Parts it is composed of. */
  anatomy: string;
  /** Variants and the feedback-contract states it expresses. */
  variantsStates: string[];
  /** Keyboard model, focus, labelling. */
  accessibility: string;
  /** Which components to consider instead. */
  related: string[];
}

const STRING_FIELDS = ['name', 'family', 'intent', 'anatomy', 'accessibility'] as const;
const LIST_FIELDS = ['useWhen', 'dontUseWhen', 'variantsStates', 'related'] as const;

/** Throws unless every field is present and non-blank. */
export function assertIntent(i: ComponentIntent): ComponentIntent {
  for (const f of STRING_FIELDS) {
    if (i[f].trim() === '')
      throw new Error(`ComponentIntent.${f} must not be empty (${i.name || '?'})`);
  }
  for (const f of LIST_FIELDS) {
    if (i[f].length === 0) throw new Error(`ComponentIntent.${f} must not be empty (${i.name})`);
    if (i[f].some((e) => e.trim() === ''))
      throw new Error(`ComponentIntent.${f} has a blank entry (${i.name})`);
  }
  return i;
}
