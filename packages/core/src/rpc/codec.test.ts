import { describe, expect, it } from 'vitest';
import { encodeLine, FrameDecoder } from './codec.js';

describe('encodeLine', () => {
  it('serializes a value as one newline-terminated JSON line', () => {
    expect(encodeLine({ jsonrpc: '2.0', id: 1, result: 'ok' })).toBe(
      '{"jsonrpc":"2.0","id":1,"result":"ok"}\n',
    );
  });
});

describe('FrameDecoder — newline-delimited JSON framing', () => {
  it('yields one line per complete message', () => {
    const d = new FrameDecoder();
    expect(d.push('{"a":1}\n')).toEqual(['{"a":1}']);
  });

  it('splits multiple messages in a single chunk', () => {
    const d = new FrameDecoder();
    expect(d.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('buffers a message split across chunks until its newline arrives', () => {
    const d = new FrameDecoder();
    expect(d.push('{"a":')).toEqual([]);
    expect(d.push('1}\n')).toEqual(['{"a":1}']);
  });

  it('keeps a trailing partial line buffered', () => {
    const d = new FrameDecoder();
    expect(d.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(d.push('2}\n')).toEqual(['{"b":2}']);
  });

  it('strips a Windows CRLF carriage return', () => {
    const d = new FrameDecoder();
    expect(d.push('{"a":1}\r\n')).toEqual(['{"a":1}']);
  });

  it('skips blank lines', () => {
    const d = new FrameDecoder();
    expect(d.push('\n{"a":1}\n\n')).toEqual(['{"a":1}']);
  });
});
