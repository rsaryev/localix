declare module 'fontkit' {
  export function create(bytes: Uint8Array): { hasGlyphForCodePoint(code: number): boolean }
}
