import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { CopyButton } from '../actions/CopyButton.js';
import { cx } from '../lib/cx.js';

export interface CodeBlockProps {
  code: string;
  /** Explicitly allows `undefined` (exactOptionalPropertyTypes) so callers can
   *  forward an optional fence language without narrowing it first. */
  language?: string | undefined;
}

/** Token-derived highlight style: colors come from CSS variables so the block stays
 *  on-theme. Highlighting renders <span>s (no innerHTML); text is byte-faithful. */
const HLJS_TOKEN_STYLE: Record<string, React.CSSProperties> = {
  hljs: { color: 'var(--color-fg)', background: 'transparent' },
  'hljs-keyword': { color: 'var(--color-accent)' },
  'hljs-built_in': { color: 'var(--color-info-text)' },
  'hljs-type': { color: 'var(--color-info-text)' },
  'hljs-string': { color: 'var(--color-success-text)' },
  'hljs-number': { color: 'var(--color-warning-text)' },
  'hljs-comment': { color: 'var(--color-faint)', fontStyle: 'italic' },
  'hljs-function': { color: 'var(--color-fg)' },
  'hljs-title': { color: 'var(--color-accent-hover)' },
  'hljs-params': { color: 'var(--color-fg)' },
  'hljs-attr': { color: 'var(--color-fg)' },
  'hljs-literal': { color: 'var(--color-warning-text)' },
};

export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  return (
    <div className={cx('relative rounded-surface border border-hairline bg-subtle')}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">{language ?? 'text'}</span>
        <CopyButton text={code} />
      </div>
      <div className="p-2">
        <SyntaxHighlighter
          language={language}
          style={HLJS_TOKEN_STYLE}
          customStyle={{ margin: 0, background: 'transparent' }}
          codeTagProps={{ className: 'font-mono text-label' }}
          PreTag="pre"
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
