/**
 * Whether a package that opens `kinds` takes the file at `path`. A kind is what a mini app's
 * `fileAssociations` names in `ext`: an extension (`docx`), one of several parts
 * (`request.json`, which `package.json` is not) or a whole file name (`dockerfile`). Case does not
 * count, nor which separator the path uses.
 */
export function opensFile(kinds: readonly string[], path: string): boolean {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  return kinds.some((kind) => {
    const wanted = kind.toLowerCase().replace(/^\./, '')
    return wanted !== '' && (name === wanted || name.endsWith(`.${wanted}`))
  })
}
