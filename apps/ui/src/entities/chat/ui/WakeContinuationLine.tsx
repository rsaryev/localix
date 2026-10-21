import type { WakeSource } from '@/shared/api/contracts'
import { WAKE_SOURCE_META } from './prompt-input/wakeSourceMeta'
import { SystemLine } from './SystemNoticeLine'

/**
 * A wake joined a run mid-answer — a delegator's message, a finished job — and the answer
 * continues below it.
 *
 * That is an event in the conversation, so it renders as one: a centered system line with its
 * source's glyph. It used to be a small caption riding on top of the agent's next segment, where
 * it read as the first words of the reply rather than as something that happened to the run.
 */
export function WakeContinuationLine({ source }: { source: WakeSource }) {
  const { Icon, label } = WAKE_SOURCE_META[source]
  return <SystemLine icon={Icon} text={`${label} update · continuing`} />
}
