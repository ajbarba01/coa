import type { DiffLine } from './toolDiff.js';
import { SyntaxText } from './syntaxTheme.js';
import { cx } from '@coa/console-kit';

export interface ToolDiffViewProps {
  lines: DiffLine[];
  language?: string | undefined;
}

/** Byte-faithful inline diff: the LINE carries the add/del tint as a background wash, the
 *  gutter marker keeps the tint as ink (a separate span, never fused into the highlighted
 *  text, so payload bytes stay exact), and the code keeps its full syntax coloring
 *  (maintainer ruling: line-highlight over text-tint). Context rows recede by opacity, hue
 *  intact. */
export function ToolDiffView({ lines, language }: ToolDiffViewProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto py-1 font-mono text-[11px] leading-[1.65]">
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} language={language} />
      ))}
    </div>
  );
}

function DiffRow({
  line,
  language,
}: {
  line: DiffLine;
  language?: string | undefined;
}): React.JSX.Element {
  const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
  return (
    <div
      className={cx(
        'px-3 whitespace-pre',
        line.kind === 'added' && 'bg-diff-add/12',
        line.kind === 'removed' && 'bg-diff-del/12',
        line.kind === 'context' && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'select-none',
          line.kind === 'added' && 'text-diff-add',
          line.kind === 'removed' && 'text-diff-del',
        )}
      >
        {`${marker} `}
      </span>
      <SyntaxText code={line.text} language={language} />
    </div>
  );
}
