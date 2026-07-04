import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface AppShellProps {
  /** 'darwin' | 'win32' | other; injected main->renderer so insets apply without `process`. */
  platform: string;
  /** The active workspace label shown next to the wordmark. */
  workspaceName: string;
  /** The active account/session context, when known. */
  account?: string | undefined;
  /** Right-aligned title-bar chrome (e.g. the daemon status control). */
  statusSlot?: ReactNode;
  /** The custom window controls (min/max/close), flush to the right edge. On Windows
   *  the host passes {@link WindowControls}; macOS leaves it unset (native traffic
   *  lights sit on the left instead). */
  windowControls?: ReactNode;
  /** The content slot; the layout engine mounts here. */
  children: ReactNode;
  className?: string | undefined;
}

/** Drag region + platform inset. macOS reserves the traffic-light safe area on the left;
 *  Windows draws its own controls as DOM (see `windowControls`), so the right edge needs
 *  no reserve — they occupy it. `-webkit-app-region` is not in the CSSProperties type, so
 *  it is asserted once here. */
function titleBarStyle(platform: string): React.CSSProperties {
  const mac = platform === 'darwin';
  // macOS reserves the traffic-light width on both sides; Windows/Linux only need the
  // left inset (their controls are DOM on the right).
  const style = {
    WebkitAppRegion: 'drag',
    paddingLeft: mac ? 78 : 8,
    paddingRight: mac ? 8 : undefined,
  };
  return style as React.CSSProperties;
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function AppShell({
  platform,
  workspaceName,
  account,
  statusSlot,
  windowControls,
  children,
  className,
}: AppShellProps): React.JSX.Element {
  return (
    <div className={cx('flex h-full min-h-0 flex-col bg-base text-fg', className)}>
      <header
        aria-label="Application title bar"
        style={titleBarStyle(platform)}
        // Fixed px (matching the main-process `TITLE_BAR_HEIGHT`) rather than a rem `h-*`,
        // so the bar height is stable across density/font changes; the Ctrl+/- content
        // zoom scales the whole bar — px and all — uniformly, so no drift there.
        className="flex h-[44px] shrink-0 select-none items-center gap-3 border-b border-hairline bg-subtle text-label"
      >
        <span className="font-bold tracking-[-0.01em] text-accent">co&middot;a</span>
        <span className="text-muted">{workspaceName}</span>
        <div className="ml-auto flex items-center gap-2" style={noDrag}>
          {account !== undefined && (
            <span data-testid="account-context" className="text-muted">
              {account}
            </span>
          )}
          {statusSlot}
        </div>
        {windowControls}
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
