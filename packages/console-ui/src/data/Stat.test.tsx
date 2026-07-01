// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stat } from './Stat.js';

describe('Stat', () => {
  it('renders a labelled metric with value and sub', () => {
    render(<Stat label="Cost" value="$2.14" sub="of $5.00" />);
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('$2.14')).toBeInTheDocument();
    expect(screen.getByText('of $5.00')).toBeInTheDocument();
  });
});
