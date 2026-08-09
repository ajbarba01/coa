// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PermissionModeChip } from './PermissionModeChip.js';

/** Open the popup via its trigger and return a query scoped to the popup panel
 *  alone — the trigger repeats the same mode LABEL text as its own row (e.g.
 *  mode="edits" renders "Edits" on both the trigger and the row), so an
 *  unscoped `getByText` is ambiguous whenever the popup is open. */
async function openPopup(triggerName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: triggerName }));
  return within(screen.getByText('Permission mode').parentElement!);
}

describe('PermissionModeChip', () => {
  it.each([
    ['plan', 'Plan', 'text-run'],
    ['manual', 'Manual', 'text-s9'],
    ['edits', 'Edits', 'text-warn'],
    ['bypass', 'Bypass', 'bg-crit'],
  ] as const)('renders %s with its label and its ruled color', (mode, label, colorClass) => {
    render(<PermissionModeChip mode={mode} effectiveMode={mode} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: label });
    expect(trigger).toHaveTextContent(label);
    expect(trigger.className).toContain(colorClass);
  });

  it('bypass is the one FILLED face — a solid crit background, not a text tint', () => {
    render(<PermissionModeChip mode="bypass" effectiveMode="bypass" onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Bypass' });
    expect(trigger.className).toContain('bg-crit');
    expect(trigger.className).toContain('text-s12');
  });

  it('lists all four modes in the popup, each with its own hint', async () => {
    render(<PermissionModeChip mode="manual" effectiveMode="manual" onChange={vi.fn()} />);
    const popup = await openPopup('Manual');
    for (const label of ['Plan', 'Manual', 'Edits', 'Bypass']) {
      expect(popup.getByText(label)).toBeInTheDocument();
    }
    expect(popup.getByText('Read-only — no writes, no commands')).toBeInTheDocument();
    expect(popup.getByText('Nothing blocked, nothing asked')).toBeInTheDocument();
  });

  it('marks the CONFIGURED mode as the selection — the trailing "Current" marker', async () => {
    render(<PermissionModeChip mode="edits" effectiveMode="edits" onChange={vi.fn()} />);
    const popup = await openPopup('Edits');
    const editsRow = popup.getByText('Edits').closest('button');
    expect(editsRow).not.toBeNull();
    expect(within(editsRow!).getByText('Current')).toBeInTheDocument();
    const planRow = popup.getByText('Plan').closest('button');
    expect(within(planRow!).queryByText('Current')).toBeNull();
  });

  it('switching mode calls onChange immediately — no confirmation gate on a riskier pick', async () => {
    const onChange = vi.fn();
    render(<PermissionModeChip mode="plan" effectiveMode="plan" onChange={onChange} />);
    const popup = await openPopup('Plan');
    const user = userEvent.setup();
    await user.click(popup.getByText('Bypass'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('bypass');
    // The popup closes on pick — nothing further to confirm.
    expect(screen.queryByText('Nothing blocked, nothing asked')).toBeNull();
  });

  it('renders the EFFECTIVE mode honestly when the backend has degraded enforcement to bypass', () => {
    render(
      <PermissionModeChip
        mode="plan"
        effectiveMode="bypass"
        degraded="the active backend has no approval seam — enforcement degrades to bypass"
        onChange={vi.fn()}
      />,
    );
    // The chip shows what is ACTUALLY enforcing (bypass), never the merely-requested plan.
    expect(screen.getByRole('button', { name: 'Bypass' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Bypass' });
    expect(trigger.className).toContain('bg-crit');
  });

  it('surfaces the honest degraded reason inside the popup', async () => {
    const popup = await (async () => {
      render(
        <PermissionModeChip
          mode="plan"
          effectiveMode="bypass"
          degraded="the active backend has no approval seam — enforcement degrades to bypass"
          onChange={vi.fn()}
        />,
      );
      return openPopup('Bypass');
    })();
    expect(
      popup.getByText('the active backend has no approval seam — enforcement degrades to bypass'),
    ).toBeInTheDocument();
    // The configured pick (plan) still carries the selection marker — the user's own
    // choice, not the degraded fallback the trigger is honestly showing instead.
    const planRow = popup.getByText('Plan').closest('button');
    expect(within(planRow!).getByText('Current')).toBeInTheDocument();
  });

  it('rests disabled with no session, and will not open', async () => {
    const user = userEvent.setup();
    render(<PermissionModeChip mode="manual" effectiveMode="manual" onChange={vi.fn()} disabled />);
    const trigger = screen.getByRole('button', { name: 'Manual' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByText('Asks before a write or a command')).toBeNull();
  });
});
