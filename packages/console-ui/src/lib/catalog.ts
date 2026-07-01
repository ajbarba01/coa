import type { ComponentIntent } from './intent.js';

/** Deterministic markdown catalogue: families alphabetical, components alphabetical within. */
export function generateCatalog(intents: ComponentIntent[]): string {
  const families = [...new Set(intents.map((i) => i.family))].sort((x, y) => x.localeCompare(y));
  const lines: string[] = [
    '# Component catalogue',
    '',
    "_Generated from each component's intent declaration. Do not edit by hand._",
    '',
  ];
  for (const family of families) {
    lines.push(`## ${family}`, '');
    const members = intents
      .filter((i) => i.family === family)
      .sort((x, y) => x.name.localeCompare(y.name));
    for (const c of members) {
      lines.push(`### ${c.name}`, '');
      lines.push(c.intent, '');
      lines.push('- **Use it when:** ' + c.useWhen.join(' '));
      lines.push("- **Don't use it when:** " + c.dontUseWhen.join(' '));
      lines.push('- **Anatomy:** ' + c.anatomy);
      lines.push('- **Variants & states:** ' + c.variantsStates.join(', '));
      lines.push('- **Accessibility:** ' + c.accessibility);
      lines.push('- **Related:** ' + c.related.join(', '));
      lines.push('');
    }
  }
  return lines.join('\n');
}
