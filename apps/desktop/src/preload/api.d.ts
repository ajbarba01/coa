import type {
  Accounts,
  ActiveAccount,
  CapState,
  Checkpoint,
  FeedView,
} from '@coa/console-viewmodel';
import type { ConsoleSettings } from '../shared/settings.js';

export {};
declare global {
  interface Window {
    coa: {
      /** 'darwin' | 'win32' | other. */
      platform: string;
      capState(): Promise<CapState>;
      flagsForUser(): Promise<FeedView>;
      listTimeline(): Promise<Checkpoint[]>;
      listAccounts(): Promise<Accounts>;
      currentAccount(): Promise<ActiveAccount>;
      useAccount(params: { label: string }): Promise<ActiveAccount>;
      getLayout(): Promise<unknown>;
      saveLayout(descriptor: unknown): Promise<void>;
      getSettings(): Promise<ConsoleSettings>;
      saveSettings(settings: ConsoleSettings): Promise<void>;
    };
  }
}
