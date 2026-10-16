/** Native globs for the supported CC command grammar; `:*` ends at a word boundary. */
export function nativeCommandPatterns(specifier: string): string[] {
  return specifier.endsWith(':*')
    ? [specifier.slice(0, -2), `${specifier.slice(0, -2)} *`]
    : [specifier]
}
