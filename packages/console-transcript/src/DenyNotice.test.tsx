// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DenyNotice } from './DenyNotice.js';

describe('DenyNotice', () => {
  it('surfaces a cost-cap denial as a status region with the reason, verbatim', () => {
    render(
      <DenyNotice
        kind="cost-cap"
        reason="Spending cap reached"
        detail="Raise the cap to continue."
      />,
    );
    // One of the only two blocks in the system — a firm stop, not an alarm.
    // role="status" (not "alert") reads as an informational, non-modal notice.
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-deny-kind', 'cost-cap');
    expect(screen.getByText('Spending cap reached')).toBeInTheDocument();
    expect(screen.getByText('Raise the cap to continue.')).toBeInTheDocument();
  });

  it('surfaces a close-gate denial and names the source', () => {
    render(<DenyNotice kind="close-gate" reason="Change blocked at close" />);
    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('data-deny-kind', 'close-gate');
    // it labels which of the two real blocks issued this — it never invents one
    expect(notice).toHaveTextContent(/close/i);
  });

  it('renders both deny kinds with their caps label and their two ways-forward', () => {
    const { rerender } = render(<DenyNotice kind="cost-cap" reason="cap reached" />);
    expect(screen.getByText(/cost cap/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /raise the cap/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review spend/i })).toBeInTheDocument();

    rerender(<DenyNotice kind="close-gate" reason="flags unresolved" />);
    expect(screen.getByText(/close gate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review the flags/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see the record/i })).toBeInTheDocument();
  });

  it('carries exactly one critical dot — the only red in the notice', () => {
    const { container } = render(<DenyNotice kind="cost-cap" reason="cap reached" />);
    const critical = container.querySelectorAll('.bg-crit');
    expect(critical).toHaveLength(1);
  });

  it('renders the daemon reason verbatim, unaltered', () => {
    const reason = 'Session cost cap reached ($5.00). No further tool calls will run.';
    render(<DenyNotice kind="cost-cap" reason={reason} />);
    expect(screen.getByText(reason)).toBeInTheDocument();
  });
});
