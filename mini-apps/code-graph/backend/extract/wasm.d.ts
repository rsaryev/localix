// `import path from 'x.wasm' with { type: 'file' }`: Bun copies the file beside the bundle and
// hands back its path, relative to the importing module once bundled and absolute from source.
declare module '*.wasm' {
  const path: string
  export default path
}
