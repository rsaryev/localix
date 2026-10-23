import type { MessageBinding, MessageContextBinding } from '@localixai/agent'
import { isSystemContextSelectionBinding } from '@localixai/agent'

import type { ChatServiceDeps } from './context'

type SessionScope = {
  id: string
  projectId: string | null
  rootSessionId?: string | null
}

/**
 * Resolve every context binding exactly once at message acceptance. The persisted
 * binding is both provenance for the transcript and the immutable model snapshot;
 * there is no second `contextRefs`/`contextCapture` channel.
 *
 * Resolution itself is Context Fabric's (`context-fabric/binding-capture.ts`): one path for every
 * kind, so a linked file and a mini app's resource pass the same admission policy. This function
 * only picks the bindings that need it and writes the answers back in place.
 */
export async function resolveMessageBindings(
  deps: ChatServiceDeps,
  userId: string,
  session: SessionScope,
  bindings: MessageBinding[] | undefined,
): Promise<MessageBinding[] | undefined> {
  if (!bindings?.length) return bindings
  const contextBindings = bindings.filter(
    (binding): binding is MessageContextBinding =>
      binding.kind === 'context' && !isSystemContextSelectionBinding(binding),
  )
  if (contextBindings.length === 0) return bindings

  const resolved = deps.resolveContextBindings
    ? await deps.resolveContextBindings(userId, session, contextBindings)
    : new Map<string, MessageContextBinding['resolution']>()

  return bindings.map((binding) => {
    if (binding.kind !== 'context') return binding
    if (isSystemContextSelectionBinding(binding)) return binding
    const resolution = resolved.get(binding.id)
    return {
      ...binding,
      resolution: resolution ?? { status: 'unsupported', contributions: [] },
    }
  })
}

/**
 * Materializing an approved contribution onto the wire is a shared leaf
 * (`chat/model-assets.ts`): the run layer needs it and must not import this module.
 */
export { contextBindingsToModelAssets } from '../model-assets'
