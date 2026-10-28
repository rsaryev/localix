import type { ReactNode } from 'react'
import { BookOpen, Terminal, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { IORow, ToolBody, OutputBlock, type ToolSectionLabel } from '../ToolIO'
import {
  isItemStreaming,
  hasItemError,
  isItemDeclined,
  itemErrorHeadline,
  itemErrorMessage,
} from '../itemHelpers'
import { asRecord, strField } from './format'

interface Row {
  label: Exclude<ToolSectionLabel, number>
  value: string
  /** Inline mono span instead of an OutputBlock (keys, names, cron exprs). */
  mono?: boolean
  /** Natural language (a prompt, a message, an answer): set as text that wraps at words. */
  prose?: boolean
}

const EMPTY_ROWS: Row[] = []

/** Shared primitive for the small action-style tool cards (memory, skill, profile…). */
export function ActionCard({
  item,
  icon,
  title,
  subtitle,
  rows = EMPTY_ROWS,
  live,
}: {
  item: ToolCallItem
  icon: LucideIcon
  title: string
  /** Done-state subtitle; while streaming the spinner stands in (no subtitle), failure shows 'Failed'. */
  subtitle: string
  rows?: Row[]
  /** State the call's own result cannot know (a subagent that keeps running after its call returned). */
  live?: { isLoading?: boolean; hasError?: boolean; isDismissed?: boolean; actions?: ReactNode }
}) {
  const streaming = isItemStreaming(item)
  const callFailed = hasItemError(item)
  const hasError = callFailed || live?.hasError === true
  const errorMessage = itemErrorMessage(item)

  const allRows = rows.filter((r) => r.value)
  if (errorMessage) allRows.push({ label: 'Error', value: errorMessage })

  return (
    <ToolLine
      icon={icon}
      title={title}
      // The same line while running and after: a subtitle that appeared on completion grew
      // every row by a line as its call finished.
      subtitle={itemErrorHeadline(item) ?? (callFailed ? 'Failed' : subtitle)}
      isLoading={streaming || live?.isLoading === true}
      hasError={hasError}
      isDismissed={isItemDeclined(item) || live?.isDismissed === true}
      headerActions={live?.actions}
    >
      {allRows.length > 0 && (
        <ToolBody>
          {allRows.map((r) => (
            <IORow key={`${r.label}:${r.value}`} label={r.label}>
              {r.mono ? (
                <span className="font-mono text-2xs text-text-faint">{r.value}</span>
              ) : (
                <OutputBlock prose={r.prose}>{r.value}</OutputBlock>
              )}
            </IORow>
          ))}
        </ToolBody>
      )}
    </ToolLine>
  )
}

export function SkillCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const action = strField(input, 'action')
  const name = strField(input, 'name') ?? ''
  const title =
    action === 'save'
      ? `Save skill: ${name}`
      : action === 'get'
        ? `Skill: ${name}`
        : action === 'list'
          ? 'Skills list'
          : action === 'delete'
            ? `Delete skill: ${name}`
            : 'Skill'
  const subtitle =
    action === 'save'
      ? 'Saved'
      : action === 'get'
        ? 'Retrieved'
        : action === 'list'
          ? 'Listed'
          : action === 'delete'
            ? 'Deleted'
            : 'Done'
  return (
    <ActionCard
      item={item}
      icon={BookOpen}
      title={title}
      subtitle={subtitle}
      rows={[
        { label: 'In', value: name, mono: true },
        { label: 'Out', value: item.resultText ?? '' },
      ]}
    />
  )
}

export function JobsCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const action = strField(input, 'action')
  const jobId = strField(input, 'job_id') ?? ''
  const title =
    action === 'list'
      ? 'Background jobs'
      : action === 'stop'
        ? 'Stop job'
        : action === 'send_input'
          ? 'Send input'
          : 'Jobs'
  const subtitle =
    action === 'list'
      ? 'Listed'
      : action === 'stop'
        ? 'Stopped'
        : action === 'send_input'
          ? 'Sent'
          : 'Done'
  return (
    <ActionCard
      item={item}
      icon={Terminal}
      title={title}
      subtitle={subtitle}
      rows={[
        { label: 'In', value: action === 'list' ? '' : jobId, mono: true },
        { label: 'Out', value: item.resultText ?? '' },
      ]}
    />
  )
}
