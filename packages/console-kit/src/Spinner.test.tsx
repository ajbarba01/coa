// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('announces as a status and spins motion-safe', () => {
    render(<Spinner label="loading conversation" />);
    const status = screen.getByRole('status', { name: 'loading conversation' });
    expect(status).toBeInTheDocument();
    expect(status.querySelector('.motion-safe\\:animate-spin')).not.toBeNull();
  });

  it('reveals late so fast transitions never flash it', () => {
    render(<Spinner label="loading" />);
    expect(screen.getByRole('status').className).toContain('spinner-reveal');
  });
});
