import { Brain, BookOpen, Terminal, type LucideIcon } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import { ToolLine } from '../ToolLine'
import { IORow, ToolBody, OutputBlock } from '../ToolIO'
import {
  isItemStreaming,
  hasItemError,
  isItemDeclined,
  itemErrorHeadline,
  itemErrorMessage,
} from '../itemHelpers'
import { asRecord, strField } from './format'

interface Row {
  label: string
  value: string
  /** Inline mono span instead of an OutputBlock (keys, names, cron exprs). */
  mono?: boolean
}

const EMPTY_ROWS: Row[] = []

/** Shared primitive for the small action-style tool cards (memory, skill, profile…). */
function ActionCard({
  item,
  icon,
  title,
  subtitle,
  rows = EMPTY_ROWS,
}: {
  item: ToolCallItem
  icon: LucideIcon
  title: string
  /** Done-state subtitle; while streaming the spinner stands in (no subtitle), failure shows 'Failed'. */
  subtitle: string
  rows?: Row[]
}) {
  const streaming = isItemStreaming(item)
  const hasError = hasItemError(item)
  const errorMessage = itemErrorMessage(item)

  const allRows = rows.filter((r) => r.value)
  if (errorMessage) allRows.push({ label: 'ERR', value: errorMessage })

  return (
    <ToolLine
      icon={icon}
      title={title}
      // The same line while running and after: a subtitle that appeared on completion grew
      // every row by a line as its call finished.
      subtitle={itemErrorHeadline(item) ?? (hasError ? 'Failed' : subtitle)}
      isLoading={streaming}
      hasError={hasError}
      isDismissed={isItemDeclined(item)}
    >
      {allRows.length > 0 && (
        <ToolBody>
          {allRows.map((r) => (
            <IORow key={r.label} label={r.label}>
              {r.mono ? (
                <span className="font-mono text-2xs text-text-faint">{r.value}</span>
              ) : (
                <OutputBlock>{r.value}</OutputBlock>
              )}
            </IORow>
          ))}
        </ToolBody>
      )}
    </ToolLine>
  )
}

export function MemoryCard({ item }: { item: ToolCallItem }) {
  const input = asRecord(item.input)
  const action = strField(input, 'action')
  const key = strField(input, 'key') ?? ''
  const title =
    action === 'set'
      ? `Remember: ${key}`
      : action === 'get'
        ? `Recall: ${key}`
        : action === 'list'
          ? 'Memory list'
          : action === 'delete'
            ? `Forget: ${key}`
            : 'memory'
  const subtitle =
    action === 'set'
      ? 'Saved'
      : action === 'get'
        ? 'Found'
        : action === 'list'
          ? 'Listed'
          : action === 'delete'
            ? 'Deleted'
            : 'Done'
  const value = action === 'set' ? strField(input, 'value') : item.resultText
  return (
    <ActionCard
      item={item}
      icon={Brain}
      title={title}
      subtitle={subtitle}
      rows={[
        { label: 'KEY', value: key, mono: true },
        { label: action === 'set' ? 'VAL' : 'OUT', value: value ?? '' },
      ]}
    />
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
        { label: 'NAME', value: name, mono: true },
        { label: 'OUT', value: item.resultText ?? '' },
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
        { label: 'JOB', value: action === 'list' ? '' : jobId, mono: true },
        { label: 'OUT', value: item.resultText ?? '' },
      ]}
    />
  )
}
