import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Code } from '../data/Code.js';
import { Link } from '../actions/Link.js';
import { cx } from '../lib/cx.js';
import { CodeBlock } from './CodeBlock.js';

export interface MarkdownProps {
  source: string;
  className?: string;
}

export function Markdown({ source, className }: MarkdownProps): React.JSX.Element {
  return (
    <div className={cx('text-body leading-[1.5] text-fg', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <Link href={href ?? '#'} external>
              {children}
            </Link>
          ),
          // react-markdown wraps fenced code in its own <pre>; CodeBlock renders its
          // own <pre> too, so unwrap here to avoid nesting <pre> inside <pre>.
          pre: ({ children }) => <>{children}</>,
          code: ({ className: cls, children }) => {
            const lang = /language-(\w+)/.exec(cls ?? '')?.[1];
            const text = String(children).replace(/\n$/, '');
            // react-markdown passes a language class only for fenced blocks.
            return lang !== undefined || text.includes('\n') ? (
              <CodeBlock code={text} language={lang} />
            ) : (
              <Code>{text}</Code>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
