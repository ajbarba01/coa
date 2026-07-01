/** Join class fragments; drop falsy. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(' ');
}

/** Shared visible focus ring — a real outline (survives Windows High-Contrast), :focus-visible only. */
export const focusRing =
  'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
