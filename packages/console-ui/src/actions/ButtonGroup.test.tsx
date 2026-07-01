// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ButtonGroup } from './ButtonGroup.js';
import { Button } from './Button.js';

describe('ButtonGroup', () => {
  it('groups its children with a group role and a label', () => {
    render(
      <ButtonGroup label="Actions">
        <Button>A</Button>
        <Button>B</Button>
      </ButtonGroup>,
    );
    const group = screen.getByRole('group', { name: 'Actions' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });
});
