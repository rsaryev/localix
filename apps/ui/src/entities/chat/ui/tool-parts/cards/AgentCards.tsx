import { Bot, MessageSquareShare, CircleStop } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ActionCard } from './actionCards'
import { asRecord, strField } from './format'
import {
  OpenChildAction,
  childLiveFlags,
  childSubtitle,
  isFinished,
  launchedChild,
  useChild,
  type ChildTarget,
  type ChildView,
} from './childSession'

/** The card state a child adds to a call: its header flags, its open control and its subtitle. */
function liveOf(child: ChildView | null) {
  return child
    ? { ...childLiveFlags(child), actions: <OpenChildAction child={child} /> }
    : undefined
}

/**
 * What a background start says in Out. The call's result is the model's instruction (do not poll,
 * you will be notified); the person is told what happens to the child.
 */
function startedFor(queued: boolean): string {
  return queued
    ? 'Queued. It starts on its own when a running subagent finishes, and its reply arrives here as a message.'
    : 'Started in the background. Its reply arrives here as a message when it finishes.'
}

/**
 * The subagent tools as Claude Code shows them: `Agent` by what it was asked, its subagent type
 * after the child's status, `SendMessage` and `TaskStop` by the subagent or job they reached. The child's status,
 * its latest activity and a way into its session follow the child itself, not the call's result.
 */
export function AgentCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const type = strField(input, 'subagent_type')
  const fork = type?.trim().toLowerCase() === 'fork'
  const kind = fork ? 'Fork' : (type ?? 'Agent')
  const description = strField(input, 'description')?.trim() ?? ''
  const launch = launchedChild(item.output)
  const pending = launch?.status === 'idle' || launch?.status === 'queued'
  const child = useChild({ launch })
  const waited = input?.run_in_background === false || input?.wait === true
  // A call that returned before its child finished carries only an acknowledgement; one that
  // waited and found the child finished carries its report, whatever status it recorded.
  const acknowledgement =
    (launch?.status === 'running' || pending) && !(waited && child && isFinished(child.phase))
  return (
    <ActionCard
      item={item}
      icon={Bot}
      title={description || kind}
      subtitle={child ? childSubtitle(child, kind) : kind}
      live={liveOf(child)}
      rows={[
        { label: 'In', value: strField(input, 'prompt') ?? '', prose: true },
        {
          label: 'Out',
          value: acknowledgement ? startedFor(pending) : (item.resultText ?? ''),
          prose: true,
        },
      ]}
    />
  )
}

/** A call that names its subagent by id or title (`to`, `task_id`): the child it reached, if one. */
function useReached(ref: string): ChildView | null {
  const target: ChildTarget = { id: ref, name: ref }
  return useChild(ref ? target : {})
}

export function SendMessageCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const to = strField(input, 'to') ?? ''
  const message = strField(input, 'message') ?? ''
  const child = useReached(to)
  return (
    <ActionCard
      item={item}
      icon={MessageSquareShare}
      title={`Message to ${child?.title ?? to}`}
      subtitle={child ? childSubtitle(child, '') : (strField(input, 'summary') ?? message)}
      live={liveOf(child)}
      rows={[
        { label: 'In', value: message, prose: true },
        { label: 'Out', value: item.resultText ?? '', prose: true },
      ]}
    />
  )
}

export function TaskStopCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const id = strField(input, 'task_id') ?? ''
  const child = useReached(id)
  const result = item.resultText?.split('\n')[0] ?? ''
  return (
    <ActionCard
      item={item}
      icon={CircleStop}
      title={`Stop ${child?.title ?? id}`}
      subtitle={child ? childSubtitle(child, '') : result}
      live={liveOf(child)}
      rows={[
        { label: 'In', value: id, mono: true },
        { label: 'Out', value: item.resultText ?? '', prose: true },
      ]}
    />
  )
}
