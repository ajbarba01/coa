import type { CapState } from '@coa/console-viewmodel';

export {};
declare global {
  interface Window {
    coa: {
      /** 'darwin' | 'win32' | other. */
      platform: string;
      capState(): Promise<CapState>;
      getLayout(): Promise<unknown>;
      saveLayout(descriptor: unknown): Promise<void>;
    };
  }
}
