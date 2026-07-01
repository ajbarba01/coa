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
      to: { path: 'node_modules/(@anthropic-ai|@ai-sdk)/|^node_modules/ai/' },
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
        'The UI kit is a pure renderer-side library; it never imports electron or the daemon core (only react/radix/lucide/react-virtuoso).',
      from: { path: '^packages/console-ui/src' },
      to: { path: 'node_modules/electron/|^packages/core/' },
    },
    {
      name: 'console-layout-no-electron-core',
      severity: 'error',
      comment:
        'The layout core is a pure renderer-side library; it never imports electron or the daemon core (only react/react-resizable-panels/zod).',
      from: { path: '^packages/console-layout/src' },
      to: { path: 'node_modules/electron/|^packages/core/' },
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
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    exclude: { path: '(\\.test\\.ts$|/dist/|node_modules)' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'types', 'node'],
    },
  },
};
