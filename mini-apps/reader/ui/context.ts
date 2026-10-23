import {
  PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS,
  type PublishedMessageContext,
} from '@localixai/mini-app-sdk/ui'

export type ReaderPaneId = 'primary' | 'secondary'

export function mergeReaderPublishedContexts(
  primary: PublishedMessageContext | null,
  secondary: PublishedMessageContext | null,
  active: ReaderPaneId,
): PublishedMessageContext | null {
  const ordered = active === 'secondary' ? [secondary, primary] : [primary, secondary]
  const bindings = [] as PublishedMessageContext['bindings'][number][]
  const seen = new Set<string>()
  for (const context of ordered) {
    for (const binding of context?.bindings ?? []) {
      const key = JSON.stringify(binding.target)
      if (seen.has(key)) continue
      seen.add(key)
      bindings.push(binding)
      if (bindings.length >= PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS) break
    }
    if (bindings.length >= PUBLISHED_MESSAGE_CONTEXT_MAX_BINDINGS) break
  }
  return bindings.length ? { strategy: 'replace', bindings } : null
}
