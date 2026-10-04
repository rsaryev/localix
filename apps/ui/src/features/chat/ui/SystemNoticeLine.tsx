import { memo, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Brain,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  FoldVertical,
  Info,
  Play,
  Plug,
  Repeat2,
  RotateCw,
  ShieldCheck,
  SquareTerminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { parseRecovery, recoveryLabel, recoveryUri } from '@localixai/api/recovery'
import { useWorkItemSessionId } from '@localixai/plugin-sdk/ui/work-item-session'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { navigateUiAction } from '@/shared/lib/uiNavigation'
import type { SystemNoticeRecovery } from '@/shared/api/contracts'
import type { SystemNotice, SystemNoticeKind, SystemNoticeTone } from '../model/types'
import { cleanSystemMessageText } from '../model/systemMessageText'
import { PERMISSION_MODE_PRESENTATION } from './prompt-input/permissionModeIcons'

const ICONS: Partial<Record<SystemNoticeKind, LucideIcon>> = {
  model_change: Cpu,
  reasoning_change: Brain,
  connection_change: Plug,
  hook_notice: TriangleAlert,
  terminal_activity: SquareTerminal,
  // A run cut off by a backend restart — the row above it is an INCOMPLETE answer, which is the
  // one system notice the user has to act on (send again), so it gets the alert glyph.
  run_interrupted: TriangleAlert,
  // A run that stopped on the person's own limit rather than on a fault. Not the alert glyph:
  // nothing went wrong, the run did exactly what it was told — and the recovery beside it is
  // how the reader carries on.
  turn_limit: Repeat2,
  // A run that stopped on something transient — the same glyph, because the reader's
  // situation is the same one: an answer that is not finished and a decision to make.
  run_failed: TriangleAlert,
  // The turns above were folded into the agent's checkpoint cards — folded, not lost.
  context_checkpoint: FoldVertical,
  // Ordinary lines in the server's own tone (muted): the plan's decisions are acted on in the
  // strip and the plan tab, so these only mark WHEN in the conversation each one happened.
  permission_mode_change: ShieldCheck,
  plan_presented: ClipboardList,
  plan_changes_requested: ClipboardList,
  plan_approved: ClipboardCheck,
  plan_dismissed: ClipboardList,
  plan_resumed: Play,
  plan_completed: ClipboardCheck,
}

const TONE_CLASS: Record<SystemNoticeTone, string> = {
  neutral: 'text-text-faint',
  info: 'text-text-soft',
  warning: 'text-status-warning',
  success: 'text-status-success',
  error: 'text-status-error',
}

/**
 * A mode line drawn by its KIND alone was one shield in one tone for every mode, so a switch to
 * Autonomous read exactly like a switch back to Default. When the notice names the mode it is
 * drawn the way the composer's mode control draws that mode — the one presentation map — and
 * a row stored before the mode was recorded keeps the generic look.
 */
function noticeLook(notice: SystemNotice): { icon: LucideIcon; toneClass: string } {
  if (notice.kind === 'permission_mode_change' && notice.mode) {
    const { icon, tone } = PERMISSION_MODE_PRESENTATION[notice.mode]
    return { icon, toneClass: tone }
  }
  return { icon: ICONS[notice.kind] ?? Info, toneClass: TONE_CLASS[notice.tone] }
}

const ACTION_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-md border border-current/30 px-1.5 py-0.5 font-medium outline-none transition-colors hover:bg-surface-hover focus-ring'

/**
 * A recovery that OPENS something (`open-settings:…`, `sign-in:…`, `restart:…`), resolved
 * through the same `localix://` registry every tip and message link uses. Its own component so
 * a notice with only a Retry does not pull the router in, and so a destination this build
 * cannot resolve renders nothing rather than a dead button.
 */
function RecoveryLink({ recovery }: { recovery: SystemNoticeRecovery }) {
  const navigation = useUiNavigation({ sessionId: useWorkItemSessionId() })
  const parsed = parseRecovery(recovery)
  const uri = parsed ? recoveryUri(parsed) : undefined
  if (!parsed || !uri) return null
  const label = recoveryLabel(parsed)
  return (
    <button
      type="button"
      onClick={() => void navigateUiAction({ type: 'ui.navigate', uri, label }, navigation)}
      className={ACTION_CLASS}
    >
      <ArrowUpRight className="size-3" aria-hidden="true" />
      {label}
    </button>
  )
}

/**
 * Centered inline notice in the chat timeline — a compact "X happened"
 * system line with no surface pill. Purely presentational; the notice may be
 * projected from a durable backend event or created locally for a client-owned setting.
 *
 * A notice that carries a `recovery` renders its action inline. The alternative — prose
 * telling the reader to perform a gesture ("send again") with no control anywhere near it —
 * is what this replaces: the one line in the transcript that asks for a decision was also
 * the one line offering no way to make it, and its instruction was then truncated to
 * "Check b…" by the same clamp every other notice wants.
 */
export const SystemNoticeLine = memo(function SystemNoticeLine({
  notice,
  onRetry,
}: {
  notice: SystemNotice
  /** Re-run the turn this notice is about. Absent = the surface cannot run anything. */
  onRetry?: () => void
}) {
  const text = cleanSystemMessageText(notice.text)
  const detail = notice.detail ? cleanSystemMessageText(notice.detail) : undefined
  const recoveries = notice.recovery ?? []
  const retry = recoveries.includes('retry') && onRetry ? onRetry : undefined
  const links = recoveries.filter((recovery) => recovery !== 'retry')
  const look = noticeLook(notice)

  return (
    <SystemLine
      icon={look.icon}
      toneClass={look.toneClass}
      text={text}
      // The text is truncated to one line; expose the full message (plus any
      // secondary detail) on hover so a long hook `systemMessage` isn't lost.
      title={detail ? `${text}\n${detail}` : text}
      // An actionable notice is the one place the clamp costs more than it saves: its
      // text says what to check BEFORE pressing the button beside it. A plan approval is the
      // other: it carries the person's own note, and a clamp would cut their words mid-sentence.
      wrap={Boolean(retry) || links.length > 0 || notice.kind === 'plan_approved'}
    >
      {retry && (
        <button type="button" onClick={retry} className={ACTION_CLASS}>
          <RotateCw className="size-3" aria-hidden="true" />
          Retry
        </button>
      )}
      {links.map((recovery) => (
        <RecoveryLink key={recovery} recovery={recovery} />
      ))}
    </SystemLine>
  )
})

/**
 * The look of every "something happened" line in the transcript: centered, an icon, one muted
 * line, no surface pill. Shared so a line that is not a stored notice — a wake that joined a run
 * mid-answer (`WakeContinuationLine`) — reads as the system event it is, not as a caption of
 * the agent's message.
 */
export function SystemLine({
  icon: Icon,
  toneClass = TONE_CLASS.neutral,
  text,
  title,
  wrap = false,
  children,
}: {
  icon: LucideIcon
  toneClass?: string
  text: string
  title?: string
  /** Let the text wrap instead of truncating to one line. */
  wrap?: boolean
  children?: ReactNode
}) {
  return (
    <div className="flex w-full justify-center py-1">
      <div
        className={[
          'inline-flex max-w-[min(90%,46rem)] items-center gap-1.5',
          'px-1 py-1 text-2xs font-medium',
          toneClass,
        ].join(' ')}
        role="status"
        title={title ?? text}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        <span className={wrap ? 'min-w-0' : 'truncate'}>{text}</span>
        {children}
      </div>
    </div>
  )
}
