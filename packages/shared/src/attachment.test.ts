import { describe, expect, it } from 'vitest';
import { AttachmentCapabilityError, attachmentSchema } from './attachment.js';
import { backendMessageSchema } from './backend-message.js';

describe('attachmentSchema', () => {
  it('parses an image attachment', () => {
    const parsed = attachmentSchema.parse({
      kind: 'image',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
      name: 'screenshot.png',
    });
    expect(parsed).toEqual({
      kind: 'image',
      mimeType: 'image/png',
      data: 'aGVsbG8=',
      name: 'screenshot.png',
    });
  });

  it('parses a text attachment', () => {
    const parsed = attachmentSchema.parse({ kind: 'text', text: 'file contents' });
    expect(parsed).toEqual({ kind: 'text', text: 'file contents' });
  });

  it('rejects an unknown kind', () => {
    expect(attachmentSchema.safeParse({ kind: 'video', data: 'x' }).success).toBe(false);
  });
});

describe('backendMessageSchema with attachments', () => {
  it('carries attachments on a user message', () => {
    const parsed = backendMessageSchema.parse({
      role: 'user',
      content: 'what is in this image?',
      attachments: [{ kind: 'image', mimeType: 'image/jpeg', data: 'YWJj' }],
    });
    expect(parsed.attachments).toHaveLength(1);
  });

  it('omits attachments by default (byte-identical to today)', () => {
    const parsed = backendMessageSchema.parse({ role: 'user', content: 'hi' });
    expect(parsed.attachments).toBeUndefined();
  });
});

describe('AttachmentCapabilityError', () => {
  it('carries the attachment kind and model id', () => {
    const err = new AttachmentCapabilityError('image', 'deepseek-v4-flash');
    expect(err.attachmentKind).toBe('image');
    expect(err.modelId).toBe('deepseek-v4-flash');
    expect(err.name).toBe('AttachmentCapabilityError');
    expect(err.message).toContain('deepseek-v4-flash');
    expect(err).toBeInstanceOf(Error);
  });

  it('accepts a custom message', () => {
    const err = new AttachmentCapabilityError('image', 'x', 'nope');
    expect(err.message).toBe('nope');
  });
});
