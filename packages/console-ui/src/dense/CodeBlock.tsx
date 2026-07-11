import { useEffect, useRef, useState } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { cx } from '../lib/cx.js';
import { HLJS_TOKEN_STYLE } from './syntaxTheme.js';

export interface CodeBlockProps {
  code: string;
  /** Explicitly allows `undefined` (exactOptionalPropertyTypes) so callers can
   *  forward an optional fence language without narrowing it first. */
  language?: string | undefined;
}

// The fenced-code chrome — see apps/workbench-proto/src/chat/CodeBlock.tsx, the design
// reference this re-skins onto. Headed only when a language is known; an anonymous block
// drops the header and floats the copy control over the body's top-right instead.
export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  const headed = language !== undefined;
  return (
    <div className="group/code relative min-w-0 overflow-hidden rounded-r2 border border-s3 bg-s2">
      {headed && (
        <div className="flex items-center gap-2 border-b border-s3 px-3 py-1.5">
          <span className="font-mono text-caps tracking-[0.05em] text-s7">{language}</span>
          <span className="ml-auto">
            <CodeCopyButton text={code} />
          </span>
        </div>
      )}
      {!headed && (
        <span className="absolute top-1.5 right-1.5 z-10">
          <CodeCopyButton text={code} />
        </span>
      )}
      <div className="overflow-x-auto px-3 py-2 font-mono text-code leading-[1.7] whitespace-pre">
        <SyntaxHighlighter
          language={language}
          style={HLJS_TOKEN_STYLE}
          customStyle={{ margin: 0, background: 'transparent' }}
          codeTagProps={{ className: 'font-mono text-code' }}
          PreTag="pre"
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

// A copy affordance local to CodeBlock rather than a re-tokened `../actions/CopyButton` —
// that shared primitive also drives Transcript's icon-based hover-copy (see
// Transcript.tsx), and retokening it here to the proto's text-label treatment would
// regress that surface's distinct look (same reasoning as Markdown.tsx's local
// Code/Link retokening). Invisible until the block is hovered or it is focused;
// confirms inline (`copied`) then settles back. Ink-only — chrome never competes
// with the code.
function CodeCopyButton({ text }: { text: string }): React.JSX.Element {
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
