import { formatTokens } from '@localixai/mini-app-sdk/ui/utilities'
import type { UsageIndicatorView } from './contextUsageView'

/**
 * The context usage `buildUsageIndicatorView` computed, as two lines of words (`/context`). It
 * adds no numbers of its own: the share, the window it was measured against and the checkpoint
 * are the view's.
 */
export function describeContextUsage(view: UsageIndicatorView): { title: string; detail: string } {
  const used = view.attempt?.contextTokens
  const window = view.ceilingTokens ?? view.policyWindowTokens ?? view.physicalWindowTokens
  if (used === undefined || !window)
    return { title: 'Context usage', detail: 'Nothing measured yet. Send a message first.' }
  const estimate = view.attempt?.tokenKind === 'estimated' ? ' (estimated)' : ''
  const checkpoint = view.checkpointAtTokens
    ? ` Next checkpoint at ${formatTokens(view.checkpointAtTokens)}.`
    : ''
  return {
    title: `Context ${view.percentLabel} full`,
    detail: `${formatTokens(used)} of ${formatTokens(window)} tokens${estimate}.${checkpoint}`,
  }
}
