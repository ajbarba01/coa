// The native-free JSON-RPC transport surface: the pipe client + endpoint helpers a
// console/CLI process needs, WITHOUT pulling the graph/code-intel modules that
// eagerly load native addons (tree-sitter, better-sqlite3). Importing from here
// keeps a consumer (e.g. the Electron main process) ABI-safe — it never loads a
// Node-ABI native binary into a differently-built runtime.
export { connectClient, type RpcClient } from './client.js';
export { defaultDaemonPath, listen, type RpcServer } from './transport.js';
export { probeDaemon } from './lifecycle.js';
