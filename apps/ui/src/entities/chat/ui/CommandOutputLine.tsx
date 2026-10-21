import { memo } from 'react'
import { CircleCheck, Info } from 'lucide-react'

import type { CommandOutput } from '@/shared/api/contracts'
import { PROBLEM_SEVERITY, type SeverityPresentation } from '@/shared/ui/problem-report'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { cleanSystemMessageText } from '../model/systemMessageText'
import { MessageText } from './MessageText'
import { systemMessageLabel } from './coalesceSystemMessages'

const TONE: Record<
  CommandOutput['tone'],
  { Icon: SeverityPresentation['Icon']; label: string; iconClass: string }
> = {
  neutral: { Icon: Info, label: 'Result', iconClass: 'text-text-soft' },
  success: { Icon: CircleCheck, label: 'Completed', iconClass: 'text-status-success' },
  // Warning and error are severities, so their glyph and colour come from the app's one
  // severity table — this row used to pick a CircleX nothing else in the product uses.
  warning: {
    Icon: PROBLEM_SEVERITY.warning.Icon,
    label: 'Attention',
    iconClass: PROBLEM_SEVERITY.warning.color,
  },
  error: {
    Icon: PROBLEM_SEVERITY.error.Icon,
    label: 'Failed',
    iconClass: PROBLEM_SEVERITY.error.color,
  },
}

/**
 * Durable output of a slash command. It intentionally has no assistant avatar,
 * provider badge, cost, timestamp, or chat bubble: the application produced it.
 */
export const CommandOutputLine = memo(function CommandOutputLine({
  output,
  repeatCount,
}: {
  output: CommandOutput
  repeatCount?: number
}) {
  if (output.activity?.state === 'running') {
    const activityLabel = output.activity.subject
      ? `${output.activity.label} · ${output.activity.subject}`
      : output.activity.label

    return (
      <div
        className="flex w-full justify-center py-1"
        data-command-output={output.command}
        data-command-activity={output.activity.action}
      >
        <ActivitySignal
          label={systemMessageLabel(activityLabel, repeatCount)}
          className="max-w-[min(90%,46rem)] px-1 py-1 text-xs text-text-soft"
          labelClassName="max-w-[min(76vw,38rem)]"
        />
      </div>
    )
  }

  const { Icon, label, iconClass } = TONE[output.tone]
  const text = systemMessageLabel(cleanSystemMessageText(output.text), repeatCount)

  return (
    <div className="flex w-full justify-center py-1" data-command-output={output.command}>
      <div
        className="grid w-fit max-w-[min(90%,46rem)] grid-cols-[1rem_minmax(0,1fr)] gap-1.5 px-1 py-1"
        role="status"
        title={`${output.command} · ${label}`}
      >
        <Icon className={`mt-0.5 size-3 ${iconClass}`} aria-hidden />
        <div className="min-w-0">
          <div className="text-xs leading-relaxed text-text-soft">
            <MessageText text={text} />
          </div>
        </div>
      </div>
    </div>
  )
})
