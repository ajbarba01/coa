export {};
declare global {
  interface Window {
    coa: { getCap(): Promise<unknown> };
  }
}
