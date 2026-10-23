import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import { parseLocalixResourceUri } from '@localixai/mini-app-sdk/ui'

export const vaultItemResourceUri = (key: string): string =>
  localixResourceUri('vault', ['items', key])

export const vaultKeyFromResourceUri = (uri: string): string | undefined => {
  const parsed = parseLocalixResourceUri(uri)
  if (parsed?.provider !== 'vault' || parsed.segments.length !== 2) return undefined
  try {
    if (decodeURIComponent(parsed.segments[0]) !== 'items') return undefined
    const key = decodeURIComponent(parsed.segments[1])
    return key || undefined
  } catch {
    return undefined
  }
}
