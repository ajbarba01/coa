import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const markdownIntent: ComponentIntent = assertIntent({
  name: 'Markdown',
  family: 'Dense/Viz',
  intent:
    'Renders GitHub-flavored markdown as kit elements, with highlighted, copy-able code blocks.',
  useWhen: ['Rendering agent/user prose that may contain markdown, code, links, or task lists.'],
  dontUseWhen: ['Showing raw, untrusted bytes that must not be interpreted — use Code block.'],
  anatomy:
    'A prose container mapping markdown nodes to Link, Code, and CodeBlock; GFM tables/task-lists supported.',
  variantsStates: ['prose', 'inline-code', 'fenced-code', 'task-list', 'table', 'link'],
  accessibility:
    'Semantic headings/lists/links; code blocks expose a labelled copy button; text is byte-faithful.',
  related: ['Code', 'CopyButton', 'Link', 'Transcript'],
});
