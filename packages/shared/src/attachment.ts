import { z } from 'zod';

/**
 * An attachment carried on a {@link BackendMessage} — the ONE wire shape every
 * adapter maps to its own request format (extend this, never a parallel
 * attachment type). `image` becomes a real multimodal content block only when
 * the active model reports vision support (checked at the adapter seam —
 * {@link AttachmentCapabilityError} on a mismatch); `text` is always safe,
 * every adapter inlines it into the message's plain-text `content` (no
 * capability gate needed for a text file).
 */
export const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    /** e.g. `image/png`, `image/jpeg`, `image/webp`, `image/gif`. */
    mimeType: z.string(),
    /** Base64-encoded bytes, no `data:` URI prefix — each adapter maps this to its own multimodal encoding. */
    data: z.string(),
    name: z.string().optional(),
  }),
  z.object({
    kind: z.literal('text'),
    name: z.string().optional(),
    text: z.string(),
  }),
]);
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * Thrown at the adapter seam when a message carries an attachment its backend/model
 * cannot honor (today: an `image` attachment and the active model does not report
 * vision support). A typed reject, not a silent drop or an unrelated wire-format
 * crash — the caller (the session host) surfaces `message` to the user rather than
 * losing the attachment or failing opaquely.
 */
export class AttachmentCapabilityError extends Error {
  override readonly name = 'AttachmentCapabilityError';
  readonly attachmentKind: Attachment['kind'];
  readonly modelId: string;

  constructor(attachmentKind: Attachment['kind'], modelId: string, message?: string) {
    super(message ?? `model "${modelId}" does not support ${attachmentKind} attachments`);
    this.attachmentKind = attachmentKind;
    this.modelId = modelId;
  }
}
