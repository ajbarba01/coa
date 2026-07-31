// packages/console-ui/src/dense/syntaxTheme.ts
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css';
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go';
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/hljs/markdown';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml';
import { cx } from '../lib/cx.js';

// The `Light` build ships with NO languages registered, so without this every code
// block renders unhighlighted. Register once at module load (side effect on import).
const LANGUAGES: Record<string, (hljs: unknown) => unknown> = {
  bash,
  css,
  go,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};
for (const [name, mod] of Object.entries(LANGUAGES)) {
  SyntaxHighlighter.registerLanguage(name, mod);
}

/** Token-derived highlight style: colors come from CSS token variables so code stays
 *  on-theme in both themes. The highlighter applies these as inline styles (byte-faithful
 *  spans, no innerHTML); token class names are stripped. */
export const HLJS_TOKEN_STYLE: Record<string, React.CSSProperties> = {
  hljs: { color: 'var(--color-s11)', background: 'transparent' },
  'hljs-keyword': { color: 'var(--color-syn-key)' },
  'hljs-built_in': { color: 'var(--color-syn-type)' },
  'hljs-type': { color: 'var(--color-syn-type)' },
  'hljs-string': { color: 'var(--color-syn-str)' },
  'hljs-number': { color: 'var(--color-syn-num)' },
  'hljs-comment': { color: 'var(--color-syn-comment)', fontStyle: 'italic' },
  'hljs-function': { color: 'var(--color-syn-fn)' },
  'hljs-title': { color: 'var(--color-syn-fn)' },
  'hljs-params': { color: 'var(--color-s11)' },
  'hljs-attr': { color: 'var(--color-s11)' },
  'hljs-literal': { color: 'var(--color-syn-num)' },
  'hljs-punctuation': { color: 'var(--color-syn-punct)' },
  'hljs-operator': { color: 'var(--color-syn-punct)' },
};

export interface SyntaxTextProps {
  code: string;
  /** hljs language id (see languageForPath). Undefined renders plain, still byte-faithful. */
  language?: string | undefined;
  className?: string | undefined;
}

/** One line/fragment of code as inline syntax-highlighted spans on a transparent
 *  background, so a surrounding row tint shows through. Byte-faithful — the text is
 *  never mutated, only wrapped in colored spans. */
export function SyntaxText({ code, language, className }: SyntaxTextProps): React.JSX.Element {
  if (language === undefined) {
    // No detected language: the sand ink, sized by the parent row (a diff/code body sets
    // its own mono size). The old `text-label` (a 13px legacy token) OVERRODE that size, so
    // code and diffs rendered a step too large against the reference's 11px — dropped here.
    return <span className={cx('font-mono text-s11', className)}>{code}</span>;
  }
  return (
    <SyntaxHighlighter
      language={language}
      style={HLJS_TOKEN_STYLE}
      customStyle={{ margin: 0, padding: 0, background: 'transparent', display: 'inline' }}
      codeTagProps={{ className: cx('font-mono', className) }}
      PreTag="span"
      CodeTag="span"
    >
      {code}
    </SyntaxHighlighter>
  );
}
