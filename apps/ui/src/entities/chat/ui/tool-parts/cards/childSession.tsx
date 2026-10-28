import { ArrowUpRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSessionActivity } from '@localixai/mini-app-sdk/ui/session-activity'
import type { UiSession } from '@/shared/api/contracts'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { useChatStore } from '../../../model/store'
import { findSessionInState } from '../../../model/findSession'
import { ToolHeaderAction } from '../ToolIO'
import { asRecord, strField } from './format'

/**
 * The child a subagent call started, as the person follows it: the card reads the same roster the
 * Agent sessions strip draws, so its status moves with the child and no tool result is rewritten.
 * The call's own output only names the child and says how it stood when the call returned.
 */
export type ChildPhase = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'

export const PHASE_LABEL: Record<ChildPhase, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

type RuntimeStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'stopped'

const PHASE_OF_STATUS: Record<RuntimeStatus, ChildPhase> = {
  idle: 'queued',
  queued: 'queued',
  running: 'running',
  completed: 'done',
  failed: 'failed',
  stopped: 'stopped',
}

/** A child no longer running: its answer, if any, is in. */
export const isFinished = (phase: ChildPhase) =>
  phase === 'done' || phase === 'failed' || phase === 'stopped'

/** What the call that started a child recorded about it (`output.tasks[0]`). */
export interface LaunchedChild {
  sessionId: string
  title?: string
  status?: RuntimeStatus
}

export function launchedChild(output: unknown): LaunchedChild | null {
  const tasks = asRecord(output)?.tasks
  const first = Array.isArray(tasks) ? asRecord(tasks[0]) : undefined
  const sessionId = strField(first, 'sessionId')
  if (!sessionId) return null
  const status = strField(first, 'status')
  return {
    sessionId,
    title: strField(first, 'title'),
    ...(status && status in PHASE_OF_STATUS ? { status: status as RuntimeStatus } : {}),
  }
}

/** Which child a call is about: by id, or by the exact title of exactly one subagent. */
export interface ChildTarget {
  id?: string
  name?: string
  launch?: LaunchedChild | null
}

export interface ChildView {
  sessionId: string
  title: string
  phase: ChildPhase
  projectId?: string
  /** What the child is doing now; only while it runs. */
  activity?: string
}

/** The one subagent whose title is exactly `name`; none when it names no subagent or several. */
function subagentTitled(state: { allSessions: readonly UiSession[] }, name?: string) {
  if (!name) return undefined
  const named = state.allSessions.filter((s) => s.sessionKind === 'subagent' && s.title === name)
  return named.length === 1 ? named[0] : undefined
}

/** The child's live state: the roster first, the call's own record while it is not in it. */
export function useChild(target: ChildTarget): ChildView | null {
  const roster = useChatStore(
    useShallow((state) => {
      const id = target.launch?.sessionId ?? target.id
      const session =
        (id ? findSessionInState(state, id) : undefined) ?? subagentTitled(state, target.name)
      if (session?.sessionKind !== 'subagent') return null
      return {
        id: session.id,
        title: session.title,
        status: session.runtimeStatus,
        projectId: session.projectId,
        waiting: Boolean(session.pendingInteraction),
      }
    }),
  )
  const sessionId = roster?.id ?? target.launch?.sessionId
  const { activity } = useSessionActivity(sessionId)
  if (!sessionId) return null
  const status = roster?.status ?? target.launch?.status
  if (!status) return null
  const phase = roster?.waiting && status === 'running' ? 'waiting' : PHASE_OF_STATUS[status]
  return {
    sessionId,
    title: roster?.title?.trim() || target.launch?.title || 'Subagent',
    phase,
    ...(roster?.projectId ? { projectId: roster.projectId } : {}),
    ...(phase === 'running' && activity ? { activity } : {}),
  }
}

/** The header's second line: how the child stands and what it is doing, else the fallback. */
export function childSubtitle(child: ChildView, fallback: string): string {
  return [PHASE_LABEL[child.phase], child.activity ?? fallback].filter(Boolean).join(' · ')
}

/** Header flags that give the child's own state the row's icon: spinner, red, muted. */
export function childLiveFlags(child: ChildView) {
  return {
    isLoading: child.phase === 'running',
    hasError: child.phase === 'failed',
    isDismissed: child.phase === 'stopped',
  }
}

/** The one control a child's row adds: open its session. */
export function OpenChildAction({ child }: { child: ChildView }) {
  const navigation = useRoutedNavigation()
  return (
    <ToolHeaderAction
      icon={ArrowUpRight}
      label={`Open ${child.title}`}
      onClick={() =>
        navigation.goToSession(
          child.sessionId,
          child.projectId ? { project: child.projectId } : undefined,
        )
      }
    />
  )
}
