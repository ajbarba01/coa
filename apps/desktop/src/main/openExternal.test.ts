import { describe, expect, it } from 'vitest';
import { validateExternalUrl } from './openExternal.js';

describe('validateExternalUrl', () => {
  it('accepts an http URL', () => {
    expect(validateExternalUrl('http://example.com/a')).toEqual({
      ok: true,
      url: 'http://example.com/a',
    });
  });

  it('accepts an https URL and returns its normalized href', () => {
    const res = validateExternalUrl('https://example.com/path?q=1#frag');
    expect(res).toEqual({ ok: true, url: 'https://example.com/path?q=1#frag' });
  });

  it('rejects a file: URL', () => {
    const res = validateExternalUrl('file:///etc/passwd');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/file:/);
  });

  it('rejects a javascript: URL', () => {
    expect(validateExternalUrl('javascript:alert(1)').ok).toBe(false);
  });

  it('rejects a mailto: URL', () => {
    expect(validateExternalUrl('mailto:a@b.com').ok).toBe(false);
  });

  it('rejects a non-URL string', () => {
    const res = validateExternalUrl('not a url');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/valid URL/);
  });

  it('rejects an empty string', () => {
    expect(validateExternalUrl('').ok).toBe(false);
  });
});
