// Asserts the SPEC §A.4 dependency arrows as hard constraints. A violation fails
// CI. When a genuinely new edge is needed it changes the SPEC map AND this ruleset
// in the same commit (the same-commit doc rule). Rules whose path patterns match
// not-yet-built packages are inert until those packages exist.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Acyclic dependency graph: the topological build order only holds if there are no cycles.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-imports-nothing',
      severity: 'error',
      comment: 'M0 (shared) is the acyclic-graph root; it imports no other workspace package.',
      from: { path: '^packages/shared/src' },
      to: { path: '^packages/(?!shared/)' },
    },
    {
      name: 'backend-isolation',
      severity: 'error',
      comment:
        'Only adapter-claude-sdk may import a backend SDK. The core calls capability ports and takes the null-fallback (D109) — no which-backend branch anywhere else.',
      from: { pathNot: '^packages/adapter-claude-sdk/' },
      // (^|/) rather than ^: pnpm resolves externals through node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>,
      // so an anchored ^node_modules/ never matches a real resolved path.
      to: { path: 'node_modules/(@anthropic-ai|@ai-sdk)/|(^|/)node_modules/ai/' },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      comment: 'Apps depend on libraries, never the reverse.',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'core-consumer-rings-no-sideways',
      severity: 'error',
      comment:
        'Inside core, only the spine is shared mutable substrate. Consumer rings (flags = M3, governance = M7, …) import the spine + shared, never sideways from each other. The workbench (M6) is a producer that MAY read flags/context/governance per its SPEC deps, but no consumer ring imports it back (REPO_LAYOUT intra-core rule).',
      from: { path: '^packages/core/src/(flags|governance|compiler|context)/' },
      to: {
        path: '^packages/core/src/(flags|governance|compiler|context|workbench)/',
        pathNot: '^packages/core/src/$1/',
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'A module imported by nothing is usually dead code (or a missing wiring).',
      from: { orphan: true, pathNot: '(\\.d\\.ts$|index\\.ts$|\\.config\\.(ts|js|cjs|mjs)$)' },
      to: {},
    },
    {
      name: 'viewmodel-no-electron-react',
      severity: 'error',
      comment:
        'The pure console view-model maps daemon data to props; it never imports electron, react, or core.',
      from: { path: '^packages/console-viewmodel/src' },
      to: { path: 'node_modules/(electron|react|react-dom)/|^packages/core/' },
    },
    {
      name: 'console-ui-no-electron-core',
      severity: 'error',
      comment:
        'The kit and the conversation renderer are pure renderer-side libraries; neither imports electron or the daemon core (only react/@base-ui/lucide/react-markdown and friends).',
      from: { path: '^packages/(console-kit|console-transcript)/src' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
    {
      name: 'kit-never-depends-on-the-transcript',
      severity: 'error',
      comment:
        'The kit is the vocabulary and the transcript is one surface built from it. The dependency runs one way; if it ever runs both, the split that keeps the kit reviewable has collapsed (docs/adr/0025).',
      from: { path: '^packages/console-kit/src' },
      to: { path: '^packages/console-transcript/' },
    },
    {
      name: 'renderer-isolation',
      severity: 'error',
      comment:
        'The sandboxed renderer must import no electron and no daemon core; only main/preload may.',
      from: { path: '^apps/desktop/src/renderer' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
  ],
  options: {
    // node_modules is doNotFollow (NOT exclude): external modules stay in the graph as
    // endpoints so rules like backend-isolation can match edges into them, without the
    // cruiser descending into dependency internals.
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    // archive/ holds parked feature code — never compiled, linted, or imported.
    exclude: { path: '(\\.test\\.tsx?$|/dist/|(^|/)archive/)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // 'development' first: every workspace package's exports map carries a
      // `development` condition pointing at its TypeScript source, so cross-package
      // `@coa/*` edges resolve to `packages/*/src/**` — the paths the rules above are
      // written against. Without it they resolve to dist and every cross-package rule
      // silently goes inert (test/depcruise-canary.test.ts guards this mechanism).
      conditionNames: ['development', 'import', 'types', 'node'],
    },
  },
};
