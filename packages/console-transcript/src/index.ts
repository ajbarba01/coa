export {
  Transcript,
  type TranscriptFrame,
  type RespondFn,
  type OpenSessionFn,
} from './dense/Transcript.js';
// The composition-time token estimate (≈ chars/4, always surfaced with a `≈`) — the
// composer's context ring reuses it for the live-typing-before-send case rather than
// inventing a second estimator.
export { estimateTokens, formatTokens } from './dense/tokenEstimate.js';
