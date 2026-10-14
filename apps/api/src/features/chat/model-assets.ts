/**
 * Binding → model-wire assets: the one rule for what an approved `@`-context contribution
 * looks like once it reaches the model.
 *
 * A leaf on purpose. Resolution (who may contribute, secret shielding, ref expansion) is
 * the SERVICE's job in `service/message-bindings.ts`; materializing an already-approved
 * contribution onto the wire is the RUNTIME's, in `runtime/history/stages/media.ts`. Keeping the
 * shared half here is what lets the run layer stay off `features/chat/service*` — the
 * layer rule `run/types.ts` states and `runtime-layers.test.ts` enforces.
 */
import type { MessageBinding } from '@localixai/agent'
import { contextContributionModelText } from '@localixai/agent'

/** Materialize only approved contribution content onto the model wire copy. */
export function contextBindingsToModelAssets(bindings: readonly MessageBinding[] | undefined) {
  return (bindings ?? []).flatMap((binding) => {
    if (binding.kind !== 'context') return []
    return binding.resolution.contributions.map((item) => {
      const text = contextContributionModelText(item)
      return {
        kind: 'text' as const,
        name: `@context:${item.id}`,
        text,
        size: Buffer.byteLength(text, 'utf8'),
        contextRef: true,
      }
    })
  })
}
