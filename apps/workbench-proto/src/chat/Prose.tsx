import { cx } from '@coa/console-kit';
import type { Block, Inline, ListItem } from './model.js';
import { splitWords } from './model.js';
import { CodeBlock } from './CodeBlock.js';

/** The assistant prose vocabulary — every markdown block on the sand scale.
 *
 *  The law of the scale: hierarchy is carried by weight and space, never by
 *  color or size jumps (product register — 15/14/13px semibold, all s12).
 *  Body ink is s11; emphasis reaches s12; secondary voices (quotes) step down
 *  to s10. Links stay ink with a stepped-down underline — accent hues never
 *  decorate prose.
 *
 *  Streaming: completed blocks enter whole (slip-enter); the trailing block
 *  reveals per-word (`.word-in`, keyed by index so an already-revealed word
 *  never re-animates). Settled transcripts render everything static. */
export function Prose({
  blocks,
  streaming = false,
}: {
  blocks: Block[];
  streaming?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1;
        return <BlockView key={i} block={b} entering={streaming} revealing={streaming && last} />;
      })}
    </div>
  );
}

function BlockView({
  block,
  entering,
  revealing,
}: {
  block: Block;
  /** Animate this block's mount (live stream only — reloads render static). */
  entering: boolean;
  /** This is the trailing, still-forming block — reveal per-word. */
  revealing: boolean;
}): React.JSX.Element {
  const enter = entering && !revealing ? 'slip-enter' : undefined;
  switch (block.t) {
    case 'h1':
      return (
        <h1 className={cx('pt-2.5 text-[15px] leading-snug font-semibold text-s12', enter)}>
          <InlineRuns inline={block.inline} revealing={revealing} />
        </h1>
      );
    case 'h2':
      return (
        <h2 className={cx('pt-2 text-[14px] leading-snug font-semibold text-s12', enter)}>
          <InlineRuns inline={block.inline} revealing={revealing} />
        </h2>
      );
    case 'h3':
      return (
        <h3 className={cx('pt-1.5 text-body leading-snug font-semibold text-s12', enter)}>
          <InlineRuns inline={block.inline} revealing={revealing} />
        </h3>
      );
    case 'p':
      return (
        <p className={cx('text-body leading-[1.55] text-s11', enter)}>
          <InlineRuns inline={block.inline} revealing={revealing} />
        </p>
      );
    case 'ul':
    case 'ol':
      return <ListView t={block.t} items={block.items} className={enter} revealing={revealing} />;
    case 'quote':
      return (
        <blockquote className={cx('border-l-2 border-s5 pl-3 text-s10', enter)}>
          <div className="flex min-w-0 flex-col gap-2">
            {block.blocks.map((b, i) => (
              <BlockView key={i} block={b} entering={false} revealing={false} />
            ))}
          </div>
        </blockquote>
      );
    case 'table':
      return (
        <div className={cx('overflow-x-auto', enter)}>
          <table className="border-collapse text-sec">
            <thead>
              <tr>
                {block.head.map((h, i) => (
                  <th
                    key={i}
                    className="border-b border-s4 px-2.5 py-1.5 text-left font-semibold whitespace-nowrap text-s12 first:pl-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-s3 last:border-0">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2.5 py-1.5 align-top text-s11 first:pl-0">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr className={cx('my-2 h-px w-full border-0 bg-s3', enter)} />;
    case 'code':
      return (
        <CodeBlock
          lang={block.lang}
          name={block.name}
          code={block.code}
          streaming={revealing}
          className={enter}
        />
      );
  }
}

function ListView({
  t,
  items,
  className,
  revealing,
  nested = false,
}: {
  t: 'ul' | 'ol';
  items: ListItem[];
  className?: string | undefined;
  revealing: boolean;
  nested?: boolean;
}): React.JSX.Element {
  const Tag = t;
  return (
    <Tag
      className={cx(
        'flex flex-col gap-1 pl-5 text-body leading-[1.5] text-s11',
        t === 'ul'
          ? cx('list-disc', nested ? 'marker:text-s6' : 'marker:text-s7')
          : 'list-decimal marker:font-mono marker:text-[11px] marker:text-s8',
        nested && 'mt-1',
        className,
      )}
    >
      {items.map((it, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className={cx(t === 'ul' && nested && 'list-[circle]')}>
            <InlineRuns inline={it.inline} revealing={revealing && last && it.sub === undefined} />
            {it.sub !== undefined && (
              <ListView t={it.sub.t} items={it.sub.items} revealing={revealing && last} nested />
            )}
          </li>
        );
      })}
    </Tag>
  );
}

/** Inline runs: text · **bold** · *italic* · `code` · [link](href). */
export function InlineRuns({
  inline,
  revealing = false,
}: {
  inline: Inline[];
  revealing?: boolean;
}): React.JSX.Element {
  return (
    <>
      {inline.map((run, i) => {
        switch (run.k) {
          case 't':
            return revealing ? <WordReveal key={i} text={run.text} /> : run.text;
          case 'b':
            return (
              <b key={i} className="font-semibold text-s12">
                {revealing ? <WordReveal text={run.text} /> : run.text}
              </b>
            );
          case 'i':
            return <i key={i}>{revealing ? <WordReveal text={run.text} /> : run.text}</i>;
          case 'c':
            return (
              <code
                key={i}
                className="rounded-r1 bg-s3 px-[4px] py-[1px] font-mono text-code text-s11"
              >
                {run.text}
              </code>
            );
          case 'a':
            return (
              <a
                key={i}
                href={run.href}
                target="_blank"
                rel="noreferrer"
                title={run.href}
                className="slip cursor-pointer text-s11 underline decoration-s6 underline-offset-[3px] hover:text-s12 hover:decoration-s8"
              >
                {run.text}
              </a>
            );
        }
      })}
    </>
  );
}

/** Per-word streaming reveal. Stable index keys mean an already-revealed word
 *  keeps its DOM node across growth frames — only the newly-arrived word
 *  mounts and plays its one-shot entrance. */
function WordReveal({ text }: { text: string }): React.JSX.Element {
  const tokens = splitWords(text);
  return (
    <>
      {tokens.map((t, i) =>
        t.word ? (
          <span key={i} className="word-in">
            {t.value}
          </span>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </>
  );
}
