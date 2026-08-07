import { describe, expect, it } from 'vitest';
import { handleParseRequest } from './parser-process.js';

describe('handleParseRequest (the parser child-process protocol)', () => {
  it('answers a valid request with a serialized CST line', () => {
    const response = JSON.parse(handleParseRequest('{"lang":"typescript","bytes":"const x = 1;"}'));
    expect(response.lang).toBe('typescript');
    expect(response.tree.type).toBe('program');
    expect(response.bytesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers an ungrammared request with the floor CST', () => {
    const response = JSON.parse(handleParseRequest('{"lang":"plain","bytes":"hello\\n"}'));
    expect(response.lang).toBe('plain');
    expect(response.tree.children).toEqual([]);
  });

  it('maps an unreadable request to the parse-failure union', () => {
    expect(JSON.parse(handleParseRequest('{not valid json')).ok).toBe(false);
    expect(JSON.parse(handleParseRequest('{"lang":"typescript"}')).ok).toBe(false);
  });
});
