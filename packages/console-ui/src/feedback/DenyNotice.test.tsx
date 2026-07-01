// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DenyNotice } from './DenyNotice.js';

describe('DenyNotice', () => {
  it('surfaces a cost-cap denial as an alert with the reason', () => {
    render(
      <DenyNotice
        kind="cost-cap"
        reason="Spending cap reached"
        detail="Raise the cap to continue."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-deny-kind', 'cost-cap');
    expect(screen.getByText('Spending cap reached')).toBeInTheDocument();
    expect(screen.getByText('Raise the cap to continue.')).toBeInTheDocument();
  });

  it('surfaces a close-gate denial and names the source', () => {
    render(<DenyNotice kind="close-gate" reason="Change blocked at close" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-deny-kind', 'close-gate');
    // it labels which of the two real blocks issued this — it never invents one
    expect(alert).toHaveTextContent(/close/i);
  });
});
