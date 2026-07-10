import { describe, expect, it } from 'vitest';
import { splitStreamingMarkdown, splitWords } from './markdownBlocks.js';

describe('splitStreamingMarkdown', () => {
  it('treats a single in-progress paragraph as the trailing block', () => {
    expect(splitStreamingMarkdown('hello world')).toEqual({
      completed: [],
      trailing: 'hello world',
      trailingIsOpenCode: false,
    });
  });

  it('is empty for empty input', () => {
    expect(splitStreamingMarkdown('')).toEqual({ completed: [], trailing: '', trailingIsOpenCode: false });
  });

  it('splits a completed paragraph (blank-line boundary) from the trailing one', () => {
    expect(splitStreamingMarkdown('para one\n\npara two')).toEqual({
      completed: ['para one'],
      trailing: 'para two',
      trailingIsOpenCode: false,
    });
  });

  it('does NOT complete a paragraph on a trailing single newline (soft-break ambiguity)', () => {
    // 'para\n' could still gain a soft-break continuation next frame — must stay trailing,
    // or completed[] would flip-flop and break append-only stability + memo keys.
    expect(splitStreamingMarkdown('para\n')).toEqual({
      completed: [],
      trailing: 'para',
      trailingIsOpenCode: false,
    });
    expect(splitStreamingMarkdown('para\nmore')).toEqual({
      completed: [],
      trailing: 'para\nmore',
      trailingIsOpenCode: false,
    });
  });

  it('completes a paragraph on a confirmed blank line even before the next block arrives', () => {
    expect(splitStreamingMarkdown('para\n\n')).toEqual({
      completed: ['para'],
      trailing: '',
      trailingIsOpenCode: false,
    });
  });

  it('flags an open code fence as the trailing block', () => {
    expect(splitStreamingMarkdown('```js\nconst x = 1')).toEqual({
      completed: [],
      trailing: '```js\nconst x = 1',
      trailingIsOpenCode: true,
    });
  });

  it('closes a fence into a completed block (highlighting happens on render)', () => {
    expect(splitStreamingMarkdown('```js\nconst x = 1\n```')).toEqual({
      completed: ['```js\nconst x = 1\n```'],
      trailing: '',
      trailingIsOpenCode: false,
    });
  });

  it('keeps blank lines inside a fence (not a block boundary)', () => {
    expect(splitStreamingMarkdown('```\na\n\nb')).toEqual({
      completed: [],
      trailing: '```\na\n\nb',
      trailingIsOpenCode: true,
    });
  });

  it('flushes prose before a fence that opens without a blank line', () => {
    expect(splitStreamingMarkdown('intro\n```js\nx')).toEqual({
      completed: ['intro'],
      trailing: '```js\nx',
      trailingIsOpenCode: true,
    });
  });

  it('appends only (earlier completed blocks are stable as text grows)', () => {
    const a = splitStreamingMarkdown('one\n\ntwo\n\nthr');
    expect(a.completed).toEqual(['one', 'two']);
    const b = splitStreamingMarkdown('one\n\ntwo\n\nthree');
    expect(b.completed).toEqual(['one', 'two']); // unchanged prefix
    expect(b.trailing).toBe('three');
  });
});

describe('splitWords', () => {
  it('splits into word and whitespace runs, preserving whitespace', () => {
    expect(splitWords('a  b')).toEqual([
      { value: 'a', word: true },
      { value: '  ', word: false },
      { value: 'b', word: true },
    ]);
  });
  it('is empty for empty text', () => {
    expect(splitWords('')).toEqual([]);
  });
});
