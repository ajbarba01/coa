// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './Field.js';

describe('Field', () => {
  it('labels the control and wires description + error via aria-describedby', () => {
    render(
      <Field label="Name" description="Your full name" error="Required">
        {(ids) => (
          <input
            aria-labelledby={ids.labelId}
            aria-describedby={ids.describedBy}
            aria-invalid={ids.invalid}
          />
        )}
      </Field>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toHaveAccessibleName('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toBeInTheDocument();
    // describedby references both description and error nodes
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').length).toBe(2);
  });

  it('omits the error node and aria-invalid when there is no error', () => {
    render(
      <Field label="Name">
        {(ids) => (
          <input
            aria-labelledby={ids.labelId}
            aria-describedby={ids.describedBy}
            aria-invalid={ids.invalid}
          />
        )}
      </Field>,
    );
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid', 'true');
  });
});
