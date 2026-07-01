import { palette } from './palette.js';

export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact';

/** Tier-2 semantic tokens — the only tier components consume. */
const dark = {
  '--color-bg-base': palette.brown0,
  '--color-bg-subtle': palette.brown1,
  '--color-bg-surface': palette.brown2,
  '--color-bg-raised': palette.brown3,
  '--color-border': palette.brownBorder,
  '--color-hairline': palette.brownHair,
  '--color-fg-default': palette.cream,
  '--color-fg-muted': palette.cream2,
  '--color-fg-faint': palette.cream3,
  '--color-accent': palette.brass,
  '--color-danger': palette.danger,
  '--color-warning': palette.warning,
  '--color-success': palette.success,
} as const;

const light = {
  '--color-bg-base': palette.paper0,
  '--color-bg-subtle': palette.paper1,
  '--color-bg-surface': palette.paper2,
  '--color-bg-raised': palette.paper1,
  '--color-border': palette.paperBorder,
  '--color-hairline': palette.paperBorder,
  '--color-fg-default': palette.ink,
  '--color-fg-muted': palette.ink2,
  '--color-fg-faint': palette.ink3,
  '--color-accent': palette.brassInk,
  '--color-danger': palette.danger,
  '--color-warning': palette.warning,
  '--color-success': palette.success,
} as const;

/** Density remaps spacing/type steps (compact = dev-tool dense default). */
const density = {
  compact: { '--text-body': '13px', '--space-inset': '8px' },
  comfortable: { '--text-body': '14px', '--space-inset': '12px' },
} as const;

export const SEMANTIC_TOKEN_NAMES = [
  ...Object.keys(dark),
  ...Object.keys(density.compact),
] as const;

export const themes: Record<Theme, Record<string, string>> = { dark, light };
export const densities: Record<Density, Record<string, string>> = density;
