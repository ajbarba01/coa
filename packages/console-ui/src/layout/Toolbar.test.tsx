// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toolbar } from './Toolbar.js';

describe('Toolbar', () => {
  it('renders a labelled toolbar region', () => {
    render(
      <Toolbar label="Transcript actions">
        <button type="button">Copy</button>
      </Toolbar>,
    );
    expect(screen.getByRole('toolbar', { name: 'Transcript actions' })).toBeInTheDocument();
  });
});
