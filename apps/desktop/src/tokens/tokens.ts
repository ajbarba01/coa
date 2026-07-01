import { densities, themes, SEMANTIC_TOKEN_NAMES, type Density, type Theme } from './semantic.js';

export { SEMANTIC_TOKEN_NAMES };
export type { Theme, Density };

export function resolveTokens(theme: Theme, density: Density): Record<string, string> {
  return { ...themes[theme], ...densities[density] };
}

export function tokensToCss(theme: Theme, density: Density): string {
  const entries = Object.entries(resolveTokens(theme, density))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `:root {\n${entries}\n}`;
}
