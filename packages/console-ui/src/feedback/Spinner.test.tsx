// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spinner } from './Spinner.js';

describe('Spinner', () => {
  it('is a labelled live status', () => {
    render(<Spinner label="Loading turns" />);
    expect(screen.getByRole('status', { name: 'Loading turns' })).toBeInTheDocument();
  });
});
