/** Electron custom-title-bar drag policy, inverted the standard way: each
 *  title-bar strip is one whole drag surface and every interactive child opts
 *  OUT — so any dead pixel in the strip moves the window, in every mode.
 *  jsdom cannot observe this property (cssstyle drops -webkit-app-region);
 *  the running app is the verification gate. */
export const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties;
export const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
