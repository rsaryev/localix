import { localixResourceUri, parseLocalixUri } from '@localixai/mini-app-sdk/navigation'
import { resourceMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { setMessageBindingDrag } from '@localixai/mini-app-sdk/ui/message-binding-drag'
import { linkKeyOf, parseLinkKey } from '@localixai/api/external-agent-identity'
import { EXTERNAL_AGENT_RESOURCE_PROVIDER } from '@localixai/api/external-agent-resource'
import type { RosterRow } from '@localixai/api/external-agent-contracts'

export const EXTERNAL_NAMESPACE = EXTERNAL_AGENT_RESOURCE_PROVIDER
export type ExternalSessionSource = Pick<RosterRow, 'key' | 'title' | 'cwd' | 'provider'>
export type ExternalResource =
  | { kind: 'root' }
  | { kind: 'provider'; provider: string }
  | { kind: 'project'; provider: string; cwd: string }
  | { kind: 'session'; provider: string; nativeSessionId: string; key: string }

export function externalSessionUri(key: string): string {
  const identity = parseLinkKey(key)
  if (!identity) throw new Error('Invalid external session identity')
  return localixResourceUri(EXTERNAL_NAMESPACE, [identity.provider, identity.nativeSessionId])
}

export function parseExternalResource(uri: string): ExternalResource | null {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs[0] !== EXTERNAL_NAMESPACE) return null
  const parts = parsed.breadcrumbs.slice(1)
  const [provider, session, cwd] = parts
  if (!parts.length) return { kind: 'root' }
  if (!provider) return null
  if (parts.length === 1) return { kind: 'provider', provider }
  if (parts.length === 3 && session === 'cwd' && cwd) return { kind: 'project', provider, cwd }
  if (parts.length === 2 && session) {
    return {
      kind: 'session',
      provider,
      nativeSessionId: session,
      key: linkKeyOf({ provider, nativeSessionId: session }),
    }
  }
  return null
}

export function externalSessionBinding(source: ExternalSessionSource) {
  return resourceMessageBindingDraft(
    { uri: externalSessionUri(source.key), label: source.title },
    'active-tab',
  )
}

export function dragExternalResource(transfer: DataTransfer, uri: string, label: string): void {
  const binding = resourceMessageBindingDraft({ uri, label }, 'drag')
  setMessageBindingDrag(transfer, binding, { previewLabel: label, plainText: binding.target.token })
}
