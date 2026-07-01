import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp.js';

describe('contentSecurityPolicy', () => {
  it('is strict in production: same-origin scripts only, no network', () => {
    const csp = contentSecurityPolicy(false);
    expect(csp).toContain("script-src 'self';"); // exactly 'self', no unsafe-*
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("default-src 'none'");
  });

  it('relaxes script-src and connect-src for Vite HMR in dev', () => {
    const csp = contentSecurityPolicy(true);
    // The React Fast Refresh preamble is an inline/eval script; without this the
    // renderer throws "@vitejs/plugin-react can't detect preamble" and whites out.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval';");
    expect(csp).toContain('ws:');
  });
});
