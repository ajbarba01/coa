import type { CapState, Checkpoint, FeedView } from '@coa/console-viewmodel';

export {};
declare global {
  interface Window {
    coa: {
      /** 'darwin' | 'win32' | other. */
      platform: string;
      capState(): Promise<CapState>;
      flagsForUser(): Promise<FeedView>;
      listTimeline(): Promise<Checkpoint[]>;
      getLayout(): Promise<unknown>;
      saveLayout(descriptor: unknown): Promise<void>;
    };
  }
}
