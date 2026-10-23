import type {
  UiLocationContribution,
  UiLocationExposure,
  UiLocationParamSchema,
} from '@localixai/mini-app-sdk/ui'
import {
  isValidUiLocationAgentMetadata,
  isValidUiLocationParamSchema,
  isValidUiMutationBaseUri,
  normalizeUiLocationBaseUri,
} from '@localixai/mini-app-sdk/ui'

const UI_SURFACE_KINDS = new Set([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'mini-app',
  'command',
  'action',
])

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function validExposure(exposure: UiLocationExposure | undefined): exposure is UiLocationExposure {
  if (!exposure) return false
  const entries = Object.entries(exposure)
  return (
    entries.every(
      ([key, value]) => (key === 'search' || key === 'palette') && typeof value === 'boolean',
    ) && entries.length <= 2
  )
}

/**
 * Admit a contribution, or name the single rule it violates.
 *
 * Rejection used to be a bare `false`. For a statically discovered `*.surface.ts` that
 * still failed startup — but with the generic "invalid or colliding metadata", which does
 * not say which of thirteen rules was broken. For a mini app or runtime view it failed
 * SILENTLY: the destination simply never existed, and because runtime views register as
 * one atomic batch, a single malformed entry rolled back every mini app destination and then
 * propagated that absence to the agent's synchronized catalog.
 *
 * The conditions and their order are unchanged. Returning the normalized uri and the
 * guarded schema keeps the narrowings the old inline condition gave `register` for free.
 */
type ContributionCheck =
  | { ok: true; uri: string; schema: UiLocationParamSchema }
  | { ok: false; reason: string }

export function checkContribution(
  contribution: UiLocationContribution<UiLocationParamSchema>,
): ContributionCheck {
  const id = contribution.id.trim()
  const uri = normalizeUiLocationBaseUri(contribution.uri, contribution.surface)
  const schema = contribution.params ?? {}
  const no = (reason: string): ContributionCheck => ({ ok: false, reason })
  if (!/^[a-z0-9][a-z0-9:._-]{0,127}$/.test(id))
    return no('id must be lowercase, dotted, ≤128 chars')
  if (!uri)
    return no(`uri "${contribution.uri}" is not a canonical ${contribution.surface} base URI`)
  if (!contribution.title.trim()) return no('title is empty')
  if (contribution.title.length > 120) return no('title exceeds 120 chars')
  if ((contribution.description?.length ?? 0) > 240) return no('description exceeds 240 chars')
  if ((contribution.keywords?.length ?? 0) > 16) return no('more than 16 keywords')
  if (contribution.keywords?.some((keyword) => !keyword || keyword.length > 64)) {
    return no('a keyword is empty or exceeds 64 chars')
  }
  if (contribution.effect !== 'read' && contribution.effect !== 'write') {
    return no(`effect must be "read" or "write", got ${JSON.stringify(contribution.effect)}`)
  }
  if (!UI_SURFACE_KINDS.has(contribution.surface)) {
    return no(`unknown surface ${JSON.stringify(contribution.surface)}`)
  }
  if ((contribution.effect === 'write') !== (contribution.surface === 'action')) {
    return no('effect "write" and surface "action" are one decision — both or neither')
  }
  if (contribution.effect === 'write' && !isValidUiMutationBaseUri(uri)) {
    return no('a write intent needs a localix://ui/action/<owner>/<name> URI')
  }
  if (!validExposure(contribution.exposure))
    return no('exposure must be { search?, palette? } booleans')
  if (contribution.agent !== undefined && !isValidUiLocationAgentMetadata(contribution.agent)) {
    return no('agent metadata must be { description, availability? }')
  }
  if (contribution.effect === 'write' && contribution.agent !== undefined) {
    return no('a write intent must never be agent-exposed')
  }
  if (contribution.effect === 'write' && !hasOwn(contribution, 'params')) {
    return no('a write intent must declare params explicitly, even when empty')
  }
  if (!isValidUiLocationParamSchema(schema)) return no('params schema is invalid')
  if (
    contribution.agent !== undefined &&
    Object.values(schema).some((definition) => !definition.description)
  ) {
    return no('every param of an agent-exposed destination needs a description')
  }
  return { ok: true, uri, schema }
}
