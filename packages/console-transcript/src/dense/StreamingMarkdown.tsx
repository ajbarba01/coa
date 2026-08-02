import { memo, useMemo } from 'react';
import { cx } from '@coa/console-kit';
import { Markdown } from './Markdown.js';
import { defaultReveal } from './reveal.js';
import { splitStreamingMarkdown, splitWords } from './markdownBlocks.js';

export interface StreamingMarkdownProps {
  /** The accumulating streamed text (grows every frame). */
  source: string;
  /** Muted foreground for secondary prose (the reasoning trace). */
  muted?: boolean | undefined;
  /** When true (the reasoning trace), the whole block types out per-word — the live "typing"
   *  affordance. When false/absent (agent output, the default), nothing streams per-word: each
   *  completed markdown block appears whole + formatted with the entrance, and the still-forming
   *  trailing block is held until it completes. Per-word can't format markdown (it is plain text
   *  with stable keys), so output — which is markdown — is revealed a whole block at a time. */
  perWord?: boolean | undefined;
}

/** A completed markdown block: parsed to formatted Markdown ONCE — memoized by content so a later
 *  streamed frame never re-parses it (this is what keeps per-frame cost at O(new blocks) and kills
 *  the old whole-block re-parse lag). A one-time `.cx-block-enter` plays as the block arrives;
 *  memoized blocks are never remounted, so it never re-runs. */
const CompletedBlock = memo(function CompletedBlock({
  content,
  muted,
}: {
  content: string;
  muted?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      className="cx-block-enter"
      data-enter={defaultReveal.block.variant}
      style={{ '--enter-dur': `${defaultReveal.block.durationMs}ms` } as React.CSSProperties}
    >
      <Markdown source={content} muted={muted} />
    </div>
  );
});

/** The per-word typing renderer (reasoning only): PLAIN TEXT with STABLE KEYS (key = token index).
 *  React reuses each word's DOM node across frames, so an already-revealed word is never remounted
 *  (its one-shot blur completes instead of restarting each ~16ms) and the growing last word only
 *  updates its text content — only a newly-arrived word mounts + animates. Whitespace stays as bare
 *  keyed nodes; the container collapses it like `Markdown` (default `white-space`), so a soft
 *  newline flows as a space and the text wraps identically once the trace settles (no reflow). */
function PerWordText({
  text,
  muted,
}: {
  text: string;
  muted?: boolean | undefined;
}): React.JSX.Element {
  const tokens = splitWords(text);
  return (
    <div
      className={cx('wrap-break-word text-body leading-[1.5]', muted ? 'text-s10' : 'text-s11')}
      data-reveal={defaultReveal.text.variant}
      style={{ '--reveal-dur': `${defaultReveal.text.durationMs}ms` } as React.CSSProperties}
    >
      {tokens.map((t, i) =>
        t.word ? (
          <span key={i} className="cx-word">
            {t.value}
          </span>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </div>
  );
}

/** Agent output: whole blocks only. Each COMPLETED markdown block appears formatted with the
 *  entrance; the in-progress trailing block is held (not rendered) until it completes and joins
 *  `completed`. The segmentation lives here rather than in the parent so the per-word reasoning
 *  path never pays for a split it discards (reasoning re-renders on every word). */
function OutputBlocks({
  source,
  muted,
}: {
  source: string;
  muted?: boolean | undefined;
}): React.JSX.Element {
  const { completed } = useMemo(() => splitStreamingMarkdown(source), [source]);
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {completed.map((block, i) => (
        <CompletedBlock key={i} content={block} muted={muted} />
      ))}
    </div>
  );
}

/** Live-only renderer for a streaming agent-text / reasoning block. The caller mounts this ONLY
 *  while `streaming === true` and swaps to plain `<Markdown>` on settle (D85 — byte-identical, no
 *  re-animate). Reasoning (`perWord`) types out per-word; agent output reveals a whole formatted
 *  markdown block at a time (its in-progress trailing block is held until it completes). */
export function StreamingMarkdown({
  source,
  muted,
  perWord,
}: StreamingMarkdownProps): React.JSX.Element {
  if (perWord === true) {
    return (
      <div className="min-w-0">
        <PerWordText text={source} muted={muted} />
      </div>
    );
  }
  return <OutputBlocks source={source} muted={muted} />;
}
