import { useMemo, useState } from 'react'
import type { ProviderConnection } from '@/shared/api/contracts'
import { useChatStore } from '@/features/chat/model/store'
import { startupModelOf, startupProject } from '../../model/startupModel'
import type { ModelRoutingSlot } from '@/features/chat/ui/prompt-input/model-select/taskReasoning'

/**
 * Resolves what the Provider step will commit: the model pair the user picked in
 * the browser, or the one a previous run remembered.
 *
 * Kept out of the step component because it is all derivation — three sources
 * (this session's click, the project's own default, the live connections) folded
 * into one validated answer, where "validated" means the connection still exists
 * and still holds a key. A stale remembered pair must never enable Continue.
 *
 * The remembered half is read from the PROJECT, not from the browser: it is the same field the
 * project settings screen shows and the same one the model chain consults, so setup cannot
 * remember a provider the workspace has never heard of (see `model/startupModel.ts`).
 */
export function useProviderPick({
  connections,
  seededProviderId,
}: {
  connections: ProviderConnection[]
  /** Provider just connected from the environment — open its model list. */
  seededProviderId: string | null
}) {
  const [pickedSlot, setPickedSlot] = useState<ModelRoutingSlot>(null)

  const usable = useMemo(() => connections.filter((c) => c.hasApiKey), [connections])

  const projects = useChatStore((state) => state.projects)
  const rememberedSlot = useMemo<ModelRoutingSlot>(() => {
    const remembered = startupModelOf(startupProject(projects))
    if (!remembered) return null
    return usable.some((c) => c.id === remembered.providerConnectionId) ? remembered : null
  }, [usable, projects])

  const live = (slot: ModelRoutingSlot) =>
    slot && usable.some((c) => c.id === slot.providerConnectionId) ? slot : null
  const selected = live(pickedSlot) ?? live(rememberedSlot)

  // Which connection the browser opens: the one just connected from
  // the environment, else the most recently added — the one the user is looking at.
  const focusConnection = useMemo(() => {
    if (usable.length === 0) return null
    const seeded = seededProviderId
      ? usable.find((c) => c.providerId === seededProviderId)
      : undefined
    return seeded ?? [...usable].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  }, [usable, seededProviderId])

  return { selected, setPickedSlot, focusConnection }
}
