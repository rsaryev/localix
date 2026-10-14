/** Keep importer diagnostics and warnings, but remove instructions meant for an agent tool call. */
export function importMessageForUi(message: string): string {
  return message
    .split(/\n\n+/)
    .filter((paragraph) => {
      const text = paragraph.trimStart()
      return !text.startsWith('Re-run with {') && !text.startsWith('Send one with {')
    })
    .map((paragraph) =>
      paragraph.replace(/\s*To build a request by hand instead, use \{[^\n]+\}\.?$/s, ''),
    )
    .filter((paragraph) => paragraph.trim() !== '')
    .join('\n\n')
}
