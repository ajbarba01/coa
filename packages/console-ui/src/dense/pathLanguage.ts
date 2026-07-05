/** Extension → hljs language id. Only languages registered in syntaxTheme.ts appear here. */
const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', json: 'json', md: 'markdown', markdown: 'markdown',
  css: 'css', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash', rs: 'rust', go: 'go',
  yml: 'yaml', yaml: 'yaml', sql: 'sql',
};

/** The hljs language for a file path, by extension; undefined when unknown or absent.
 *  Pure; never throws. */
export function languageForPath(path: string): string | undefined {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return undefined; // no extension, or a dotfile like `.gitignore`
  return EXT_LANG[base.slice(dot + 1).toLowerCase()];
}
