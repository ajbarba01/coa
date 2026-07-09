import { describe, expect, it } from 'vitest';
import { resultText } from './transcript.js';

describe('resultText — the full tool-result text the model saw', () => {
  it('returns a plain string result unchanged', () => {
    expect(resultText('THE FULL RESULT BODY')).toBe('THE FULL RESULT BODY');
  });

  it('flattens an array of text parts to their joined text', () => {
    expect(resultText([{ type: 'text', text: 'line1\n' }, { type: 'text', text: 'line2' }])).toBe(
      'line1\nline2',
    );
  });

  it('drops array parts with no text field', () => {
    expect(resultText([{ type: 'image' }, { type: 'text', text: 'kept' }])).toBe('kept');
  });

  it('falls back to an empty string for content that is neither a string nor an array', () => {
    expect(resultText(undefined)).toBe('');
    expect(resultText(null)).toBe('');
    expect(resultText(42)).toBe('');
  });
});
