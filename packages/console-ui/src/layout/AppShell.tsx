import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface AppShellProps {
  /** 'darwin' | 'win32' | other; injected main->renderer so insets apply without `process`. */
  platform: string;
  /** The active workspace label shown next to the wordmark. */
  workspaceName: string;
  /** The active account/session context, when known. */
  account?: string | undefined;
  /** The content slot; the layout engine mounts here. */
  children: ReactNode;
  className?: string | undefined;
}

/** Traffic-light safe area (macOS) / window-controls inset (Windows). `-webkit-app-region`
 *  is not part of the CSSProperties type, so it is wrapped once here. */
function titleBarStyle(platform: string): React.CSSProperties {
  const inset =
    platform === 'darwin'
      ? { paddingLeft: 78, paddingRight: 8 }
      : { paddingLeft: 8, paddingRight: 140 };
  return { WebkitAppRegion: 'drag', ...inset } as React.CSSProperties;
}

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function AppShell({
  platform,
  workspaceName,
  account,
  children,
  className,
}: AppShellProps): React.JSX.Element {
  return (
    <div className={cx('flex h-full min-h-0 flex-col bg-base text-fg', className)}>
      <header
        aria-label="Application title bar"
        style={titleBarStyle(platform)}
        // Absolute px (not a rem-based `h-*`) so the bar is pinned to the Windows
        // overlay's pixel `height` (main-process `TITLE_BAR_HEIGHT`) independent of the
        // root font-size — a rem height could drift from it and overflow the controls.
        className="flex h-[44px] shrink-0 select-none items-center gap-3 border-b border-hairline bg-subtle text-label"
      >
        <span className="font-bold tracking-[-0.01em] text-accent">co&middot;a</span>
        <span className="text-muted">{workspaceName}</span>
        {account !== undefined && (
          <span data-testid="account-context" className="ml-auto text-muted" style={noDrag}>
            {account}
          </span>
        )}
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
