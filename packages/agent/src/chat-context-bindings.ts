import type { MessageBinding, MessageContextBinding } from './chat'

/** Keep only the newest binding for each stable semantic target. */
export function latestContextBindingsByTarget(
  bindings: readonly MessageContextBinding[],
): MessageContextBinding[] {
  const latest = new Map<string, MessageContextBinding>()
  for (const binding of bindings) {
    latest.delete(binding.target.token)
    latest.set(binding.target.token, binding)
  }
  return [...latest.values()]
}

/** Minimal message shape needed to reduce durable system bindings into current context. */
export interface SystemContextBindingMessage {
  role: string
  bindings?: readonly MessageBinding[]
}

/** Reduce system state slots newest-first; a completed turn settles stale run failures. */
export function latestSystemContextBindings(
  messages: readonly SystemContextBindingMessage[],
): MessageContextBinding[] {
  const latest = new Map<string, MessageContextBinding>()
  for (const message of messages) {
    if (message.role === 'assistant') latest.delete('run:latest-status')
    for (const binding of message.bindings ?? []) {
      if (binding.kind !== 'context' || binding.source !== 'system') continue
      latest.delete(binding.target.token)
      latest.set(binding.target.token, binding)
    }
  }
  return [...latest.values()]
}

export const SYSTEM_CONTEXT_SELECTION_KIND = 'system-context-selection'

/** A model-empty binding that records which system context slots the user kept enabled. */
export function systemContextSelectionBinding(
  sessionId: string,
  selectedTokens: readonly string[],
): MessageContextBinding {
  return {
    kind: 'context',
    id: `system-context-selection:${sessionId}`,
    source: 'system',
    target: {
      kind: SYSTEM_CONTEXT_SELECTION_KIND,
      token: 'system:selection',
      label: 'System context selection',
      attributes: { selectedTokens: JSON.stringify([...selectedTokens].sort()) },
    },
    resolution: { status: 'empty', contributions: [] },
  }
}

export function isSystemContextSelectionBinding(binding: MessageContextBinding): boolean {
  return binding.target.kind === SYSTEM_CONTEXT_SELECTION_KIND
}

export function selectedSystemContextTokens(
  binding: MessageContextBinding | undefined,
): ReadonlySet<string> | null {
  if (!binding || !isSystemContextSelectionBinding(binding)) return null
  const encoded = binding.target.attributes?.selectedTokens
  if (typeof encoded !== 'string') return new Set()
  try {
    const parsed: unknown = JSON.parse(encoded)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? new Set(parsed)
      : new Set()
  } catch {
    return new Set()
  }
}
