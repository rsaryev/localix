import { parseLocalixUri } from '@localixai/plugin-sdk/navigation'

/** Only the profile surface may be opened from a transcript's agent link. */
export function isAgentProfileHref(href: string): boolean {
  const parsed = parseLocalixUri(href)
  if (parsed?.primitive !== 'ui' || parsed.breadcrumbs.join('/') !== 'work-item/agent') return false
  const limits: Record<string, number> = { agent: 256, scope: 256, handle: 100, section: 20 }
  if (!parsed.query.has('agent')) return false
  for (const [key, value] of parsed.query) {
    if (
      !Object.hasOwn(limits, key) ||
      parsed.query.getAll(key).length !== 1 ||
      value.length > limits[key]! ||
      /\p{Cc}/u.test(value)
    )
      return false
    if (key === 'section' && value !== 'rules' && value !== 'definition') return false
  }
  return true
}
