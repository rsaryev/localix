/**
 * The hosts a call reads, as a permission rule names them (`WebFetch(domain:example.com)` in a
 * skill's `allowed-tools`): `domain:<host>` per URL, lowercased, a trailing dot dropped. A call
 * that also searches the web names no host, so a domain rule never covers its search.
 */
export function researchPermissionResources(input: unknown): string[] {
  const record = (input ?? {}) as { urls?: unknown; queries?: unknown }
  if (!Array.isArray(record.urls) || record.urls.length === 0 || record.queries !== undefined)
    return []
  const hosts = record.urls.map((url) => {
    try {
      return new URL(String(url)).hostname.toLowerCase().replace(/\.$/, '')
    } catch {
      return ''
    }
  })
  return hosts.every(Boolean) ? [...new Set(hosts.map((host) => `domain:${host}`))] : []
}
