// The native-free JSON-RPC transport surface: the pipe client + endpoint helpers a
// console/CLI process needs, WITHOUT pulling the graph/code-intel modules that
// eagerly load native addons (tree-sitter, better-sqlite3). Importing from here
// keeps a consumer (e.g. the Electron main process) ABI-safe — it never loads a
// Node-ABI native binary into a differently-built runtime.
export { connectClient } from './client.js';
export { canonicalProjectRoot, defaultDaemonPath } from './transport.js';
export { probeDaemon } from './lifecycle.js';
