// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Toast, ToastProvider } from './Toast.js';

describe('Toast', () => {
  it('renders an open toast inside the provider', async () => {
    render(
      <ToastProvider>
        <Toast open tone="success" title="Saved">
          Layout persisted
        </Toast>
      </ToastProvider>,
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Layout persisted')).toBeInTheDocument();
  });
});
