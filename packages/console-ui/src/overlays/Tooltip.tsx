import type { ReactNode } from 'react';
import { Tooltip as RxTooltip } from 'radix-ui';

export function TooltipProvider({
  children,
  delayDuration = 300,
}: {
  children: ReactNode;
  delayDuration?: number;
}): React.JSX.Element {
  return <RxTooltip.Provider delayDuration={delayDuration}>{children}</RxTooltip.Provider>;
}

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps): React.JSX.Element {
  return (
    <RxTooltip.Root>
      <RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
      <RxTooltip.Portal>
        <RxTooltip.Content
          sideOffset={4}
          className="z-[700] rounded-control bg-raised px-2 py-1 text-[12px] text-fg shadow-md"
        >
          {content}
          <RxTooltip.Arrow className="fill-[var(--color-bg-raised)]" />
        </RxTooltip.Content>
      </RxTooltip.Portal>
    </RxTooltip.Root>
  );
}
