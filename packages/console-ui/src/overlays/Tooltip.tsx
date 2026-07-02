import type { ReactNode } from 'react';
import { Tooltip as RxTooltip } from 'radix-ui';

export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  children: ReactNode;
  delayDuration?: number;
}): React.JSX.Element {
  // skipDelayDuration=0 closes Radix's "skip the delay on quick re-hover" window,
  // which otherwise re-shows a tooltip instantly without replaying the enter
  // animation (a flash). Every hover now uses the same delay + transition.
  return (
    <RxTooltip.Provider delayDuration={delayDuration} skipDelayDuration={0}>
      {children}
    </RxTooltip.Provider>
  );
}

export interface TooltipProps {
  content: string;
  /** Which edge to anchor to (defaults to 'top'; use 'right' beside a left rail). */
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}

export function Tooltip({ content, side = 'top', children }: TooltipProps): React.JSX.Element {
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content
          side={side}
          sideOffset={4}
          className="overlay-content z-[700] rounded-control bg-raised px-2 py-1 text-label text-fg shadow-md"
        >
          {content}
          <RxTooltip.Arrow className="fill-[var(--color-bg-raised)]" />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}
