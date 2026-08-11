import {
  reasoningValue,
  type ModelDescriptor,
  type ModelSelection,
  type TurnFrame,
} from '@coa/console-viewmodel';
// From the picker module directly, NOT via AgentsPanel's re-export: pulling the agents
// surface in here would drag the whole panel tree behind the store layer.
import { modelLabel } from '../panels/ModelPicker.js';

/** Builds the "switched model" note text from an applied override, e.g.
 *  `switched to Opus 4.8 · high`. `models` resolves the friendly label when the
 *  descriptor is known; falls back to the raw model id otherwise. Effort is omitted
 *  when the override carries no reasoning (defensive — a bare model switch shouldn't
 *  claim an effort it didn't set). Exported for unit testing. */
export function modelSwitchNoteText(override: ModelSelection, models: ModelDescriptor[]): string {
  const descriptor = models.find((m) => m.id === override.model);
  const label = descriptor ? modelLabel(descriptor) : (override.model ?? 'default model');
  const effort = override.reasoning ? reasoningValue(override.reasoning) : undefined;
  return effort !== undefined && effort !== 'off'
    ? `switched to ${label} · ${effort}`
    : `switched to ${label}`;
}

/** What an auth-shaped failure LOOKS like in an error frame. Advisory on purpose:
 *  a false hit costs an amber dot the next probe clears, never a block — so the net is
 *  wide (401s, OAuth, login wording) but only ever reads ERROR frames, never chat. */
const AUTH_FAILURE = /auth|401|unauthorized|oauth|logged? ?in|login/i;

/** Pure: whether a batch of pushed frames carries an auth failure. Exported for tests. */
export function detectAuthFailure(frames: TurnFrame[]): boolean {
  return frames.some((f) => f.kind === 'error' && AUTH_FAILURE.test(f.message));
}

/** The auth-failure hook: the bootstrap registers the store-side reporter (loginStore's —
 *  it owns the auth-store reach) so the push consumer can flag the active login WITHOUT
 *  importing the auth store, which imports the rpc wrappers — a static cycle the
 *  dependency ruleset forbids. */
let authFailureSink: () => void = () => {};
export const onAuthFailure = (fn: () => void): void => {
  authFailureSink = fn;
};
export const reportAuthFailure = (): void => authFailureSink();

/** The models-changed hook: the controller registers its `loadModels` here so a catalog
 *  edit refreshes the chip/agent-picker feed in the same breath. Lives beside the
 *  auth-failure hook for the same reason — the model editor's own store pokes it, and
 *  neither end may import the other. */
let modelsChanged: () => Promise<void> = () => Promise.resolve();
export const onModelsChanged = (fn: () => Promise<void>): void => {
  modelsChanged = fn;
};
export const notifyModelsChanged = (): Promise<void> => modelsChanged();
