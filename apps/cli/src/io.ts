/**
 * The CLI's injectable IO seam, in its own module so the verb modules
 * (`auth-cli`, `web-cli`) can type against it without importing `cli.ts`
 * back — `cli.ts` imports their run functions, and the reverse type-import
 * made the dependency graph circular.
 */
export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** Endpoint override (tests); defaults to `defaultDaemonPath`. */
  path?: string;
}
