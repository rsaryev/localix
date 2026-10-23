import {
  localixUiUri,
  parseLocalixUri,
  type LocalixUiPrimitive,
} from '@localixai/mini-app-sdk/navigation'

/**
 * Build a registry id from mini-app-supplied identity that is valid by construction.
 *
 * A location id must match `/^[a-z0-9][a-z0-9:._-]{0,127}$/`, but a mini app's view or
 * panel name is declared as a bare string and camelCase is ordinary in JS. Synthesizing
 * `mini-app-view.open.${fullName}` from `example:sqlConsole` therefore produced an invalid
 * id — and since views and panels register as ONE atomic batch, that single rejection
 * withdrew EVERY mini app destination from the catalog and from the agent's synchronized
 * copy of it.
 *
 * The id is our own registry key, not the mini app's identity: the addressable identity is
 * the URI, which percent-encodes `fullName` and is unaffected. So the host normalizes the
 * key rather than requiring manifests to be lowercase. Two names that normalize alike
 * collide, which the registry already reports and which costs one destination instead of
 * all of them.
 */
export function miniAppLocationId(prefix: string, fullName: string): string {
  const normalized = fullName
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${prefix}.${normalized || 'unnamed'}`.slice(0, 128)
}

export function parseRegisteredUri(
  value: string,
): { baseUri: string; searchParams: URLSearchParams } | null {
  const parsed = parseLocalixUri(value)
  if (parsed?.primitive !== 'ui') return null
  const [surface, ...segments] = parsed.breadcrumbs
  return {
    baseUri: localixUiUri(surface as LocalixUiPrimitive, segments),
    searchParams: parsed.query,
  }
}
