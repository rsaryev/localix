import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'

/**
 * Only one agent's Store page may be opened from a transcript's agent link: `kind=agent` and an
 * id, nothing else, so a model cannot steer the Store anywhere through a link it writes.
 */
export function isAgentProfileHref(href: string): boolean {
  const parsed = parseLocalixUri(href)
  if (parsed?.primitive !== 'ui' || parsed.breadcrumbs.join('/') !== 'work-item/store') return false
  const limits: Record<string, number> = { kind: 32, id: 512 }
  if (parsed.query.get('kind') !== 'agent' || !parsed.query.has('id')) return false
  for (const [key, value] of parsed.query) {
    if (
      !Object.hasOwn(limits, key) ||
      parsed.query.getAll(key).length !== 1 ||
      value.length > limits[key]! ||
      /\p{Cc}/u.test(value)
    )
      return false
  }
  return true
}
