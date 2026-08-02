// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { allIntents } from '@coa/console-kit';
import { KitSpecimens } from './KitSpecimens.js';

describe('KitSpecimens', () => {
  it('renders a specimen for every registered kit member', () => {
    const { container } = render(<KitSpecimens />);
    const shown = new Set(
      [...container.querySelectorAll('[data-specimen]')].map((el) =>
        el.getAttribute('data-specimen'),
      ),
    );
    const missing = allIntents.map((m) => m.name).filter((name) => !shown.has(name));
    expect(missing).toEqual([]);
  });
});
