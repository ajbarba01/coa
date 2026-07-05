/** Tier-1 primitives — raw values, never consumed by components directly. */
export const palette = {
  // warm-dark "forge" neutrals — the elevation ramp. Steps are widened above the
  // canvas so adjacent surfaces read as distinct layers: the pane body (brown2) → a
  // raised card like the user message / composer / overlays (brown3) is a ~1.34:1
  // luminance step, and the box rims (brownHair ~1.49:1) / frames (brownBorder ~2:1)
  // carry the identifying boundary (WCAG 1.4.11 governs interactive boundaries; the
  // fill step follows Material-style tonal elevation). brown1 stays the recessed tone
  // for the thinking/plan wells. base is the locked canvas anchor.
  brown0: '#14100d',
  brown1: '#1b1511',
  brown2: '#241c17',
  brown3: '#3f3126',
  brownBorder: '#5c4a3e',
  brownHair: '#463830',
  brownHairLighter: '#6e5f55',
  cream: '#ece0d0',
  cream2: '#a89180',
  cream3: '#6e5d50',
  brass: '#c39a3e',
  danger: '#c0432f',
  warning: '#cf9a4e',
  success: '#7c9a6b',
  // light theme — the elevation ramp mirrors dark: the pane body (paper2) → a raised
  // card (paperRaised) is a ~1.22:1 step toward white and the chrome/thinking well
  // (paper1) recesses ~1.25:1 darker, so the user box and thinking box each read as
  // distinct layers (paper1 and raised were formerly the same value). paper0 is the
  // locked canvas anchor; paperHair is the soft rim, paperBorder the stronger frame.
  paper0: '#f6f1e9',
  paper1: '#d8ccb5',
  paper2: '#ebe3d5',
  paperRaised: '#fdfaf4',
  paperHair: '#cdbfa4',
  paperHairLighter: '#c8baa2',
  paperBorder: '#c2b092',
  ink: '#241c14',
  ink2: '#5c5142',
  ink3: '#8a7d6b',
  brassInk: '#8a6a1f',
  // component-consumed extensions (dark)
  brassHover: '#d4ab52',
  onBrass: '#1b1207',
  elementHover: '#4a3a2f',
  elementActive: '#59463a',
  focus: '#c39a3e',
  selection: '#c39a3e33',
  dangerTint: '#3a1f1a',
  dangerText: '#e8a597',
  warningTint: '#332715',
  warningText: '#e6c489',
  successTint: '#1e2a1c',
  successText: '#a8c39a',
  info: '#5b7fb0',
  infoTint: '#1b2733',
  infoText: '#9fc0e6',
  // agent identity categoricals (Okabe-Ito-anchored, warm-dark-tuned; ≥3:1 on
  // surface; brass + status hues deliberately excluded so an agent can never
  // dress as the system or as a severity)
  agentSlate: '#a3adb8',
  agentSky: '#6ec3f0',
  agentBlue: '#6b9bd8',
  agentTeal: '#45b48e',
  agentGreen: '#96bd70',
  agentMauve: '#d48fb4',
  agentViolet: '#ab93e0',
  agentCoral: '#e28f68',
  // agent identity categoricals (light companions; tuned later)
  agentSlateLight: '#5c6670',
  agentSkyLight: '#21759e',
  agentBlueLight: '#2f5fa8',
  agentTealLight: '#177355',
  agentGreenLight: '#55742e',
  agentMauveLight: '#a04f78',
  agentVioletLight: '#6a4bab',
  agentCoralLight: '#b3541f',
  // component-consumed extensions (light companions; tuned later)
  brassInkHover: '#75581a',
  onBrassLight: '#fbf6ec',
  elementHoverLight: '#ddd0bb',
  elementActiveLight: '#d0c2a8',
  focusLight: '#8a6a1f',
  selectionLight: '#8a6a1f2e',
  dangerTintLight: '#f6e0da',
  dangerTextLight: '#8a2c1d',
  warningTintLight: '#f6ead2',
  warningTextLight: '#7a5410',
  successTintLight: '#e2ecdc',
  successTextLight: '#3e5730',
  infoLight: '#3f6aa0',
  infoTintLight: '#dde8f4',
  infoTextLight: '#274a73',
} as const;
