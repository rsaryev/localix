import type { MessageTiming } from '../../contracts'
import type { TurnEventContext } from './event-handlers'
import { findUsedKey, maskKey } from './key-meta'
import type { ResolvedRunModel } from './model-selection'
import { finalizeTiming } from './turn-state'

/**
 * Seal a finished run's payload: finalize its timing now that all events are processed, and make
 * sure the persisted payload carries the latest aggregate and the provider that answered (its
 * name, the model, and the key it used, masked).
 */
export function sealFinalPayload(
  ctx: Pick<TurnEventContext, 'state' | 'connection' | 'providerId'>,
  providerEntry: ResolvedRunModel['providerEntry'],
  rawModelId: string,
): void {
  const { state } = ctx
  finalizeTiming(state)
  const finalTiming: MessageTiming = {
    ...state.timing,
    tools: [...state.timing.tools],
  }
  const usedKey = findUsedKey(ctx.connection, state.usedKeyId)
  const providerMeta = {
    providerId: ctx.providerId,
    providerName: providerEntry.name,
    modelId: rawModelId,
    keyLabel: usedKey?.label || undefined,
    keyMasked: maskKey(usedKey),
  }
  if (state.currentPayload.timing !== finalTiming) {
    state.currentPayload = {
      ...state.currentPayload,
      timing: finalTiming,
      providerMeta,
    }
    state.payload = state.currentPayload
  } else if (state.currentPayload.providerMeta === undefined) {
    state.currentPayload = { ...state.currentPayload, providerMeta }
    state.payload = state.currentPayload
  }
}
