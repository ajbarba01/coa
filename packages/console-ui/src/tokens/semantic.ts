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
  '--color-hairline-lighter': palette.brownHairLighter,
  '--color-fg-default': palette.cream,
  '--color-fg-muted': palette.cream2,
  '--color-fg-faint': palette.cream3,
  '--color-accent': palette.brass,
  '--color-danger': palette.danger,
  '--color-warning': palette.warning,
  '--color-success': palette.success,
  '--color-bg-element': palette.brown2,
  '--color-bg-element-hover': palette.elementHover,
  '--color-bg-element-active': palette.elementActive,
  '--color-accent-hover': palette.brassHover,
  '--color-fg-on-accent': palette.onBrass,
  '--color-focus-ring': palette.focus,
  '--color-selection': palette.selection,
  '--color-danger-tint': palette.dangerTint,
  '--color-danger-text': palette.dangerText,
  '--color-warning-tint': palette.warningTint,
  '--color-warning-text': palette.warningText,
  '--color-success-tint': palette.successTint,
  '--color-success-text': palette.successText,
  '--color-info': palette.info,
  '--color-info-tint': palette.infoTint,
  '--color-info-text': palette.infoText,
  '--color-agent-slate': palette.agentSlate,
  '--color-agent-sky': palette.agentSky,
  '--color-agent-blue': palette.agentBlue,
  '--color-agent-teal': palette.agentTeal,
  '--color-agent-green': palette.agentGreen,
  '--color-agent-mauve': palette.agentMauve,
  '--color-agent-violet': palette.agentViolet,
  '--color-agent-coral': palette.agentCoral,
} as const;

const light = {
  '--color-bg-base': palette.paper0,
  '--color-bg-subtle': palette.paper1,
  '--color-bg-surface': palette.paper2,
  '--color-bg-raised': palette.paperRaised,
  '--color-border': palette.paperBorder,
  '--color-hairline': palette.paperHair,
  '--color-hairline-lighter': palette.paperHairLighter,
  '--color-fg-default': palette.ink,
  '--color-fg-muted': palette.ink2,
  '--color-fg-faint': palette.ink3,
  '--color-accent': palette.brassInk,
  '--color-danger': palette.danger,
  '--color-warning': palette.warning,
  '--color-success': palette.success,
  '--color-bg-element': palette.paper2,
  '--color-bg-element-hover': palette.elementHoverLight,
  '--color-bg-element-active': palette.elementActiveLight,
  '--color-accent-hover': palette.brassInkHover,
  '--color-fg-on-accent': palette.onBrassLight,
  '--color-focus-ring': palette.focusLight,
  '--color-selection': palette.selectionLight,
  '--color-danger-tint': palette.dangerTintLight,
  '--color-danger-text': palette.dangerTextLight,
  '--color-warning-tint': palette.warningTintLight,
  '--color-warning-text': palette.warningTextLight,
  '--color-success-tint': palette.successTintLight,
  '--color-success-text': palette.successTextLight,
  '--color-info': palette.infoLight,
  '--color-info-tint': palette.infoTintLight,
  '--color-info-text': palette.infoTextLight,
  '--color-agent-slate': palette.agentSlateLight,
  '--color-agent-sky': palette.agentSkyLight,
  '--color-agent-blue': palette.agentBlueLight,
  '--color-agent-teal': palette.agentTealLight,
  '--color-agent-green': palette.agentGreenLight,
  '--color-agent-mauve': palette.agentMauveLight,
  '--color-agent-violet': palette.agentVioletLight,
  '--color-agent-coral': palette.agentCoralLight,
} as const;

/** Density drives the whole type ramp + control heights + inset spacing, so the
 *  toggle scales every `text-*` and `h-control-*` utility at once (theme.css maps
 *  the `--fs-*` / `--control-h-*` runtime vars into the Tailwind tokens). compact =
 *  the dev-tool dense default. */
const density = {
  compact: {
    '--fs-eyebrow': '11px',
    '--fs-caption': '12px',
    '--fs-label': '13px',
    '--fs-body': '14px',
    '--fs-heading': '16px',
    '--fs-metric': '20px',
    '--control-h-sm': '28px',
    '--control-h-md': '36px',
    '--control-indicator': '18px',
    '--space-inset': '8px',
  },
  comfortable: {
    '--fs-eyebrow': '12px',
    '--fs-caption': '13px',
    '--fs-label': '14px',
    '--fs-body': '15px',
    '--fs-heading': '18px',
    '--fs-metric': '22px',
    '--control-h-sm': '32px',
    '--control-h-md': '40px',
    '--control-indicator': '20px',
    '--space-inset': '12px',
  },
} as const;

export const SEMANTIC_TOKEN_NAMES = [
  ...Object.keys(dark),
  ...Object.keys(density.compact),
] as const;

export const themes: Record<Theme, Record<string, string>> = { dark, light };
export const densities: Record<Density, Record<string, string>> = density;
