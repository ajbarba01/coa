// The hljs language modules ship without bundled types. Each default export is an
// hljs language definition function; typing it loosely (not `any`) keeps strict mode.
declare module 'react-syntax-highlighter/dist/esm/languages/hljs/*' {
  const language: (hljs: unknown) => unknown;
  export default language;
}
