// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { settingsPanel, selectSettingsVm } from './SettingsPanel.js';
import { makeState } from './fixtures.js';
import type { ConsoleState } from './state.js';

const SettingsView = settingsPanel.render;
const host = {
  title: 'Settings',
  setTitle: () => {},
  onVisibilityChange: () => () => {},
  requestFocus: () => {},
};

const state = (setSettings = vi.fn()): ConsoleState =>
  makeState({ ui: { activeMainPanelId: 'settings' }, actions: { setSettings } });

describe('SettingsView', () => {
  it('renders the theme, density, and motion controls', () => {
    render(<SettingsView vm={selectSettingsVm(state())} host={host} />);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Density')).toBeTruthy();
    expect(screen.getByText(/reduce motion/i)).toBeTruthy();
  });
});
