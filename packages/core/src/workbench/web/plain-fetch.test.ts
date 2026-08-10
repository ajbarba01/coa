import { describe, expect, it } from 'vitest';
import { makePlainFetch } from './plain-fetch.js';

function fakeFetch(res: {
  ok?: boolean;
  status: number;
  contentType?: string;
  body?: string;
}): typeof fetch {
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (res.contentType ?? '') : null,
    },
    text: async () => res.body ?? '',
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim();

describe('makePlainFetch', () => {
  it('fetches html and returns non-clean markdown', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'text/html', body: '<p>hello</p>' }),
      htmlToMarkdown: stripTags,
    });
    expect(await provider.fetch('https://x.test')).toEqual({
      status: 'ok',
      value: 'hello',
      clean: false,
    });
  });

  it('accepts text/plain content', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'text/plain', body: 'raw' }),
      htmlToMarkdown: (s) => s,
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'ok', clean: false });
  });

  it('never returns a limit — a non-ok status is an error', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 404 }),
      htmlToMarkdown: stripTags,
    });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'error', reason: 'http-404' });
  });

  it('rejects an unsupported content type as an error', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'application/octet-stream', body: 'bin' }),
      htmlToMarkdown: stripTags,
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('a fetch throw becomes an error outcome', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    expect(await makePlainFetch({ fetchImpl }).fetch('https://x.test')).toMatchObject({
      status: 'error',
    });
  });
});
