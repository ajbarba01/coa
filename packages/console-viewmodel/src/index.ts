export * from './agents.js';
export * from './cap.js';
export * from './model-info.js';
export * from './reads.js';
export * from './reasoning.js';
export * from './session-tree.js';
export { appendStreamingFrame, reconcileStreaming } from './streaming.js';
export {
  pushToBanner,
  pushToViewFrames,
  reloadToViewFrames,
  persistedTurnSchema,
  persistedTurnsSchema,
  reloadedConversationSchema,
  type PersistedTurnWire,
  type ReloadedConversationWire,
} from './turn-map.js';
// The daemon push wire type + schema, re-exported so the console edge validates the
// real shared wire shape without every consumer taking a direct @coa/shared dependency.
export { pushSchema, type Push } from '@coa/shared';
// The system-banner wire type (drift/cache notices), re-exported for the shell.
export { bannerSchema, type Banner, type BannerAction } from '@coa/shared';
// The model-selection + faithful reasoning types the console renders + sends.
export {
  modelSelectionSchema,
  claudeReasoningSchema,
  modelDescriptorSchema,
  type ModelSelection,
  type ClaudeReasoning,
  type ClaudeEffort,
  type ModelDescriptor,
} from '@coa/shared';
// The per-model info catalog (context window/pricing/modalities/reasoning) the
// context ring, model-picker hover card, and attach-control capability gating all
// read, plus the pure vision-capability predicate they gate on.
export {
  modelMetadataSchema,
  modelImageInputSupport,
  type ModelMetadata,
  type ModelPricing,
  type ModelModalities,
  type CapabilitySupport,
} from '@coa/shared';
// The attachment wire shape (images/text files on a send) — re-exported so the
// composer's attach control and the send path validate the real shared shape.
export { attachmentSchema, type Attachment } from '@coa/shared';
// F2: the permission-mode wire vocabulary — re-exported so the console edge (the
// composer chip, the ask/response round trip) validates the real shared wire shape
// without every consumer taking a direct @coa/shared dependency.
export {
  PERMISSION_MODES,
  permissionModeSchema,
  toolClassSchema,
  approvalDecisionSchema,
  type PermissionMode,
  type ToolClass,
  type ApprovalDecision,
} from '@coa/shared';
