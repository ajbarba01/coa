/** A rough token count for a chunk of text (≈ 4 chars/token, the common GPT-family
 *  heuristic). An estimate, not a tokenizer — always surfaced with a `≈` prefix so it
 *  never reads as exact. Pure; never throws. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Compact human formatting for a token count: `820`, `1.2k`, `15.3k`. */
export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
