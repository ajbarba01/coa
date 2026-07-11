import { cx } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import type { Lang, TokenClass } from './model.js';
import { tokenize } from './model.js';

/** Syntax token class → theme token. THE token map — the implementation lifts
 *  this table into the real highlighter's style object (hljs classes on the
 *  left column of the intent doc; see the showcase's palette section). */
export const SYNTAX_CLASS: Record<TokenClass, string> = {
  key: 'text-syn-key',
  str: 'text-syn-str',
  num: 'text-syn-num',
  type: 'text-syn-type',
  fn: 'text-syn-fn',
  punct: 'text-syn-punct',
  comment: 'text-syn-comment italic',
  plain: 'text-s11',
};

/** One line of highlighted code — byte-faithful, tokens only wrap. */
export function CodeLine({ line, lang }: { line: string; lang: Lang }): React.JSX.Element {
  return (
    <div className="min-h-[1lh]">
      {tokenize(line, lang).map((t, i) => (
        <span key={i} className={SYNTAX_CLASS[t.cls]}>
          {t.text}
        </span>
      ))}
    </div>
  );
}

/** The fenced code block: quiet s2 card chrome on the s1 canvas. The header
 *  carries the filename (ink, mono) or bare language (faint) and the copy
 *  affordance — which only surfaces when the pointer is over the block
 *  (detail is proximity). Anonymous blocks (no name, no lang) drop the header
 *  and float the copy control over the body's top-right instead. */
export function CodeBlock({
  code,
  lang,
  name,
  streaming = false,
  className,
}: {
  code: string;
  lang: Lang;
  name?: string | undefined;
  streaming?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  const lines = code.split('\n');
  const headed = name !== undefined || lang !== 'text';
  return (
    <div
      className={cx(
        'group/code relative min-w-0 overflow-hidden rounded-r2 border border-s3 bg-s2',
        className,
      )}
    >
      {headed && (
        <div className="flex items-center gap-2 border-b border-s3 px-3 py-1.5">
          {name !== undefined ? (
            <>
              <span className="truncate font-mono text-meta text-s9">{name}</span>
              <span className="font-mono text-caps text-s6">{lang}</span>
            </>
          ) : (
            <span className="font-mono text-caps tracking-[0.05em] text-s7">{lang}</span>
          )}
          <span className="ml-auto">
            <CopyButton text={code} />
          </span>
        </div>
      )}
      {!headed && (
        <span className="absolute top-1.5 right-1.5 z-10">
          <CopyButton text={code} />
        </span>
      )}
      <div className="overflow-x-auto px-3 py-2 font-mono text-code leading-[1.7] whitespace-pre">
        {lines.map((ln, i) => (
          <CodeLine key={i} line={ln} lang={lang} />
        ))}
        {streaming && (
          <span aria-hidden className="text-s7 motion-safe:animate-pulse">
            ▎
          </span>
        )}
      </div>
    </div>
  );
}

/** The copy affordance: invisible until the block is hovered or it is focused,
 *  confirms inline (`copied`) and settles back. Ink-only — chrome never
 *  competes with the code. */
export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
      className={cx(
        'slip cursor-pointer rounded-r1 px-1.5 py-0.5 font-mono text-caps',
        'opacity-0 group-hover/code:opacity-100 focus-visible:opacity-100',
        copied ? 'text-s9' : 'text-s7 hover:bg-s3 hover:text-s10',
      )}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}
