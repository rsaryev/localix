import type { ActionTarget } from '@localixai/mini-app-sdk/ui'

/** Content identity excludes transient rendered SVG and dimensions, which change with layout. */
function identity(target: ActionTarget): string {
  switch (target.kind) {
    case 'markdown':
      return JSON.stringify(['markdown', target.markdown])
    case 'table':
      return JSON.stringify(['table', target.markdown])
    case 'code':
      return JSON.stringify(['code', target.text, target.language ?? ''])
    case 'visualization':
      return JSON.stringify(['visualization', target.format, target.source])
    case 'image':
      return JSON.stringify(['image', target.src])
    case 'link':
      return JSON.stringify(['link', target.url])
    case 'file':
      return JSON.stringify(['file', target.path, target.line ?? null])
  }
}

const cache = new Map<string, { id?: string; pending: Promise<string> }>()
const CACHE_CHARS = 512 * 1024
let cacheChars = 0
const identities = new WeakMap<ActionTarget, string>()
const preparedIds = new WeakMap<ActionTarget, string>()
const preparing = new WeakMap<ActionTarget, Promise<string>>()
function key(target: ActionTarget) {
  let value = identities.get(target)
  if (!value) {
    value = identity(target)
    // A data URI can be tens of MB. Do not retain a second copy of it just to name a fragment.
    if (value.length <= 64 * 1024) identities.set(target, value)
  }
  return value
}

export const knownFragmentId = (target: ActionTarget) => {
  const prepared = preparedIds.get(target)
  if (prepared) return prepared
  if (target.kind === 'image' && target.src.length > 64 * 1024) return undefined
  return cache.get(key(target))?.id
}

/**
 * A stable create id lets the store serialize concurrent copies of the same fragment into one
 * element. Deleting that element frees the id, so adding it again is a new undoable creation.
 * Hashing happens once outside rendering; retaining only recent targets bounds the cache.
 */
export function prepareFragmentId(target: ActionTarget): Promise<string> {
  const active = preparing.get(target)
  if (active) return active
  const source = key(target)
  const existing = cache.get(source)
  if (existing)
    return existing.pending.then((id) => {
      preparedIds.set(target, id)
      return id
    })
  while (cache.size && (cache.size >= 256 || cacheChars + source.length > CACHE_CHARS)) {
    const first = cache.keys().next().value!
    cacheChars -= first.length
    cache.delete(first)
  }
  const entry: { id?: string; pending: Promise<string> } = {
    pending: crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)).then((digest) => {
      const hex = [...new Uint8Array(digest)]
        .slice(0, 16)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
      entry.id = `fragment_${hex}`
      preparedIds.set(target, entry.id)
      return entry.id
    }),
  }
  preparing.set(target, entry.pending)
  if (source.length <= 64 * 1024) {
    cache.set(source, entry)
    cacheChars += source.length
  }
  return entry.pending
}
