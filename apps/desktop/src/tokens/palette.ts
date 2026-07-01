/** Tier-1 primitives — raw values, never consumed by components directly. */
export const palette = {
  // warm-dark "forge" neutrals
  brown0: '#14100d',
  brown1: '#1b1511',
  brown2: '#221a15',
  brown3: '#2c211b',
  brownBorder: '#3a2c24',
  brownHair: '#2e231d',
  cream: '#ece0d0',
  cream2: '#a89180',
  cream3: '#6e5d50',
  brass: '#c39a3e',
  danger: '#c0432f',
  warning: '#cf9a4e',
  success: '#7c9a6b',
  // light theme (starter values; tuned later per spec §6.5)
  paper0: '#f6f1e9',
  paper1: '#efe8dd',
  paper2: '#e7ddce',
  paperBorder: '#d8cbb6',
  ink: '#241c14',
  ink2: '#5c5142',
  ink3: '#8a7d6b',
  brassInk: '#8a6a1f',
} as const;
