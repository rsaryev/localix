/** The identifier a script reaches a tool by: `my-tool` is `tools.my_tool` (and `tools["my-tool"]`). */
export function toIdentifier(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_$]/g, '_')
  return safe === '' || /^[0-9]/.test(safe) ? `_${safe}` : safe
}
