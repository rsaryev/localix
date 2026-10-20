/**
 * WHAT ONE `codemode` CALL DID, read from the call itself: the script (the call's input) and the
 * calls it made (the result's details, `agent-core/tools/codemode/call-record.ts`). The results of
 * those calls stay in the script — only what it printed or returned reaches the transcript.
 */
import type { ToolCallItem } from '@localixai/agent/agents'

import { readInputPaths } from './batchInput'
import { formatCommand } from './commandFormat'
import { asRecord, numField, strField } from './format'

export type CodemodeCallStatus = 'running' | 'ok' | 'error' | 'cancelled'

export interface CodemodeCall {
  name: string
  status: CodemodeCallStatus
  args?: Record<string, unknown>
  durationMs?: number
  error?: string
}

export interface CodemodeShape {
  code: string
  calls: CodemodeCall[]
  /** False when the record left calls or their arguments out. */
  complete: boolean
}

/** What one call was about: the files it named, or the command it ran. */
export type CodemodeCallTarget = { paths: string[] } | { command: string } | undefined

const STATUSES: ReadonlySet<string> = new Set(['running', 'ok', 'error', 'cancelled'])

export function codemodeShape(item: Pick<ToolCallItem, 'input' | 'output'>): CodemodeShape {
  const details = asRecord(item.output)
  const calls = Array.isArray(details?.calls) ? details.calls : []
  return {
    code: strField(asRecord(item.input), 'code') ?? '',
    calls: calls.flatMap((raw): CodemodeCall[] => {
      const call = asRecord(raw)
      const name = strField(call, 'name')
      const status = strField(call, 'status')
      if (!name || !status || !STATUSES.has(status)) return []
      const args = asRecord(call?.args)
      const durationMs = numField(call, 'durationMs')
      const error = strField(call, 'error')
      return [
        {
          name,
          status: status as CodemodeCallStatus,
          ...(args ? { args } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(error ? { error } : {}),
        },
      ]
    }),
    complete: details?.complete !== false,
  }
}

/** Every `path` of a batch field (`files`, `edits`) or the top-level one. */
function batchPaths(args: Record<string, unknown>, field: string): string[] {
  const top = strField(args, 'path')
  const entries = Array.isArray(args[field]) ? (args[field] as unknown[]) : []
  const paths = entries.flatMap((entry) => {
    const path = strField(entry, 'path')
    return path ? [path] : []
  })
  return top ? [top, ...paths] : paths
}

export function codemodeCallTarget(call: CodemodeCall): CodemodeCallTarget {
  const args = call.args
  if (!args) return undefined
  if (call.name === 'bash') {
    const command = strField(args, 'command')
    return command ? { command: formatCommand(command) } : undefined
  }
  const paths =
    call.name === 'read'
      ? readInputPaths(args)
      : call.name === 'write'
        ? batchPaths(args, 'files')
        : call.name === 'edit'
          ? batchPaths(args, 'edits')
          : []
  return paths.length > 0 ? { paths } : undefined
}

/** "Script · write, read, bash": the tools it called, in the order it first called them. */
export function codemodeTitle(shape: CodemodeShape): string {
  const names = [...new Set(shape.calls.map((call) => call.name))]
  if (names.length === 0) return 'Script'
  const shown = names.slice(0, 3).join(', ')
  return `Script · ${shown}${names.length > 3 ? ` +${names.length - 3}` : ''}`
}

/** "3 calls", "3 calls · 1 failed · 1 cancelled": the card's line once the script has settled. */
export function codemodeSubtitle(shape: CodemodeShape): string {
  const count = shape.calls.length
  const made = count === 0 ? 'No tool calls' : `${count} call${count === 1 ? '' : 's'}`
  const failed = shape.calls.filter((call) => call.status === 'error').length
  const cancelled = shape.calls.filter((call) => call.status === 'cancelled').length
  return [
    shape.complete ? made : `${made}+`,
    failed > 0 ? `${failed} failed` : undefined,
    cancelled > 0 ? `${cancelled} cancelled` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * What the script reported, for reading: a JSON object or array it printed is indented, since
 * `JSON.stringify(result)` on one line is the common way a script hands back several values.
 */
export function codemodeOutput(text: string): string {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}
