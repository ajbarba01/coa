import { describe, expect, it } from 'vitest';
import type { NeutralConfig } from '@coa/shared';
import { renderSystemPrompt } from './render.js';

function config(): NeutralConfig {
  return {
    prefixHead: [
      {
        order: 1,
        piece: {
          name: 'baseline-tone',
          description: 'd',
          body: 'Be concise.',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'tone',
        },
      },
      {
        order: 0,
        piece: {
          name: 'baseline-identity',
          description: 'd',
          body: 'You are a coa agent.',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'identity',
        },
      },
      {
        order: 2,
        piece: {
          name: 'baseline-environment',
          description: 'd',
          body: 'cwd: /w',
          axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
          slot: 'volatile',
        },
      },
    ],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
  };
}

describe('renderSystemPrompt (DeepSeek)', () => {
  it('renders every piece as ordered sections with no drop-set and no boundary heading', () => {
    const out = renderSystemPrompt(config());
    expect(out).toBe(
      [
        '## Identity',
        'You are a coa agent.',
        '## Tone',
        'Be concise.',
        '## Environment',
        'cwd: /w',
      ].join('\n\n'),
    );
    expect(out.startsWith('## Identity')).toBe(true);
    expect(out).toContain('## Tone');
    expect(out).toContain('## Environment');
    expect(out).not.toContain('# coa governance layer');
  });

  it('renders the model line under its own Model section', () => {
    const out = renderSystemPrompt({
      ...config(),
      prefixHead: [
        {
          order: 1,
          piece: {
            name: 'baseline-model',
            description: 'd',
            body: 'You are running as deepseek/deepseek-v4-pro (max)',
            axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
            slot: 'model',
          },
        },
      ],
    });
    expect(out).toBe(
      ['## Model', 'You are running as deepseek/deepseek-v4-pro (max)'].join('\n\n'),
    );
  });

  it('appends standing-authority reminders after the sections', () => {
    const out = renderSystemPrompt({
      ...config(),
      systemReminders: [{ rule: 'r1', reason: 'because' }],
    });
    expect(out.endsWith('[r1] because')).toBe(true);
  });
});
