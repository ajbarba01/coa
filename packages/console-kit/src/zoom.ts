import { createContext, useContext } from 'react';

/** The app's base scale (Electron `webFrame.setZoomFactor` / the proto's body
 *  zoom). Pointer math that converts viewport coordinates into layout px must
 *  divide by it; kit components read it here instead of hardcoding the app's
 *  value. Defaults to 1 (tests, unzoomed hosts). */
const ZoomContext = createContext(1);

export const ZoomProvider = ZoomContext.Provider;

export function useZoom(): number {
  return useContext(ZoomContext);
}
