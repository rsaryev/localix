import type { CapabilitySnapshot } from '@localixai/api/client'

/**
 * The composer-tip vocabulary, as the SERVER defines it.
 *
 * The wire types are derived from the capability snapshot rather than restated: the
 * client renders this vocabulary, and a second
 * declaration of a tip's shape is how a gate the server sends ends up being one the
 * client never evaluates.
 *
 * Its own module, beside `contracts.ts` rather than inside it, for two reasons: that
 * barrel is a pinned god-file the ratchet keeps from growing, and the value below must
 * come from the api's narrow LEAF — `tip-contracts.ts`, which imports nothing but zod
 * — never from the client barrel, whose module graph reaches server code and the node
 * builtins a browser bundle cannot have (see scripts/browser-graph-guard.test.ts).
 */

type ServerComposerTip = CapabilitySnapshot['tips'][number]
/** UI-owned settings tips can act locally without extending the wire contract. */
export type ComposerTip = Omit<ServerComposerTip, 'actions'> & {
  actions?: ComposerTipAction[]
  eligible?: () => boolean
  onDismiss?: () => void
}
export type ComposerTipGate = NonNullable<ComposerTip['when']>
export type ComposerTipAction =
  | NonNullable<ServerComposerTip['actions']>[number]
  | {
      kind: 'local'
      label: string
      onAction: () => void
    }
/** The session-fact vocabulary a gate names and `useTipSignals` answers. */
export type TipSignal = NonNullable<ComposerTipGate['signals']>[number]

export { TIP_SIGNALS } from '@localixai/api/tip-contracts'
