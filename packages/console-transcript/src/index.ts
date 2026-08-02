export { DenyNotice, type DenyNoticeProps, type DenyKind } from './DenyNotice.js';
export {
  Transcript,
  TranscriptRow,
  type TranscriptProps,
  type TranscriptFrame,
  type TranscriptRole,
  type RespondFn,
} from './dense/Transcript.js';
export { CodeBlock, type CodeBlockProps } from './dense/CodeBlock.js';
export { Markdown, type MarkdownProps } from './dense/Markdown.js';
export { StreamingMarkdown, type StreamingMarkdownProps } from './dense/StreamingMarkdown.js';
export {
  defaultReveal,
  type RevealConfig,
  type TextVariant,
  type BlockVariant,
  type ReasoningMode,
} from './dense/reveal.js';
export { describeTool, toolPath, toolTarget, type ToolDescriptor } from './dense/toolRegistry.js';
export { diffLines, type DiffLine, type LineDiff } from './dense/toolDiff.js';
export { estimateTokens, formatTokens } from './dense/tokenEstimate.js';
export { SyntaxText, type SyntaxTextProps } from './dense/syntaxTheme.js';
export { languageForPath } from './dense/pathLanguage.js';
export { clampLines, type ClampedLines } from './dense/clampLines.js';
export { parseMatchLine, type MatchLine } from './dense/matchLines.js';
export { markErrors } from './dense/errorMarks.js';
export {
  RunChecks,
  parseChecks,
  type RunChecksProps,
  type ChecksSummary,
  type CheckResult,
} from './dense/runChecks.js';
export { ToolDiffView, type ToolDiffViewProps } from './dense/ToolDiffView.js';
export { ToolCard, type ToolCardProps } from './dense/ToolCard.js';
export { FindBar, type FindBarProps } from './dense/FindBar.js';
