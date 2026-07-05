import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { CopyButton } from '../actions/CopyButton.js';
import { cx } from '../lib/cx.js';
import { HLJS_TOKEN_STYLE } from './syntaxTheme.js';

export interface CodeBlockProps {
  code: string;
  /** Explicitly allows `undefined` (exactOptionalPropertyTypes) so callers can
   *  forward an optional fence language without narrowing it first. */
  language?: string | undefined;
}

export function CodeBlock({ code, language }: CodeBlockProps): React.JSX.Element {
  return (
    <div className={cx('relative rounded-surface border border-hairline bg-subtle')}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">{language ?? 'text'}</span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto p-2">
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
