/**
 * session-audit — one stored session, every layer that spent time or money, in order.
 *
 *   bun apps/api/scripts/session-audit.ts <sessionId> [--db PATH] [--slow-ms N]
 *
 * Per assistant turn: the tool calls it made (name, status, exit code, duration), its timing
 * split (model / tool / wait / TTFT), its provider usage (input, cached, output, cost) and the
 * measured context. Then the run ledger (retries, failures, interruptions) and the flags an
 * efficiency review looks for: a tool that failed, a file read twice without a write between,
 * a slow tool, a turn whose input was mostly uncached, and a steered user row that landed after
 * the reply it shaped. Read-only.
 */
import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { StoredMessagePayload } from '../src/db/payload'

const args = process.argv.slice(2)
const sessionId = args.find((a) => !a.startsWith('--'))
if (!sessionId) {
  console.error('usage: session-audit <sessionId> [--db PATH] [--slow-ms N]')
  process.exit(2)
}
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const slowMs = Number(flag('slow-ms') ?? 15_000)
const db = new Database(flag('db') ?? join(homedir(), '.localix', 'localix.db'), {
  readonly: true,
})

interface Row {
  id: string
  sequence: number
  role: string
  created_at: string
  payload: StoredMessagePayload
}
const rows = (
  db
    .query(
      'select id, sequence, role, created_at, payload_json from agent_messages where session_id = ? order by sequence',
    )
    .all(sessionId) as Array<Omit<Row, 'payload'> & { payload_json: string }>
).map((r) => ({ ...r, payload: JSON.parse(r.payload_json) as StoredMessagePayload }))
const runs = db
  .query(
    'select id, status, error_code, substr(coalesce(error_json, ""), 1, 200) as error, started_at, finished_at from agent_runs where session_id = ? order by started_at',
  )
  .all(sessionId) as Array<{
  id: string
  status: string
  error_code: string | null
  error: string
  started_at: string
  finished_at: string | null
}>
const participantCount = (
  db
    .query('select count(*) as count from conversation_participants where session_id = ?')
    .get(sessionId) as {
    count: number
  }
).count

const fmt = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString('en-US'))
const secs = (ms: number | undefined) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`)
const clip = (s: string | undefined, n: number) =>
  (s ?? '').replace(/\s+/g, ' ').slice(0, n) + ((s ?? '').length > n ? '…' : '')

interface ToolItem {
  type: string
  name?: string
  status?: string
  exitCode?: number
  input?: unknown
  resultText?: string
  isError?: boolean
}

const flags: string[] = []
let totalCost = 0
let totalInput = 0
let totalCached = 0
let totalOutput = 0
const costSources = new Set<string>()
const readsSinceWrite = new Map<string, number>()

console.log(`session ${sessionId}: ${rows.length} rows, ${runs.length} runs\n`)
for (const row of rows) {
  const p = row.payload
  if (row.role === 'user') {
    const tag = p.isInternal
      ? `hidden${p.origin ? ` (${p.origin})` : ''}${p.contextBoundary ? ' BOUNDARY' : ''}`
      : p.uiOnly
        ? `notice ${p.systemNotice?.kind ?? ''}`
        : p.origin === 'user-steer'
          ? 'user STEER'
          : 'user'
    console.log(`#${row.sequence} ${tag}: ${clip(String(p.content ?? ''), 90)}`)
    continue
  }
  if (row.role !== 'assistant') continue
  const items = (p.items ?? []) as ToolItem[]
  const tools = items.filter((i) => i.type !== 'text' && i.type !== 'reasoning')
  const textItems = items.filter(
    (item): item is ToolItem & { text: string } =>
      item.type === 'text' && typeof (item as { text?: unknown }).text === 'string',
  )
  const itemText = textItems.map((item) => item.text).join('')
  const flatText = typeof p.content === 'string' ? p.content : ''
  const author = p.authorSnapshot?.handle ?? p.from?.replace(/^agent:/, '') ?? 'unknown'
  const visibility = p.isInternal ? ' hidden' : ''
  const timing = p.timing
  const usage = p.usage
  const cached = usage?.cachedInputTokens ?? 0
  const input = usage?.inputTokens ?? 0
  totalCost += usage?.totalCost ?? 0
  if (usage?.costSource) costSources.add(usage.costSource)
  totalInput += input
  totalCached += cached
  totalOutput += usage?.outputTokens ?? 0
  const cacheRate = input > 0 ? Math.round((cached / input) * 100) : undefined
  console.log(
    `#${row.sequence} assistant @${author}${visibility}: turns ${timing?.turns ?? '—'} · model ${secs(timing?.modelMs)} · tools ${secs(timing?.toolMs)} · wait ${secs(timing?.waitMs)} · ttft ${secs(timing?.ttftMs)} · total ${secs(timing?.totalMs)}`,
  )
  console.log(
    `    usage: in ${fmt(input)} (cached ${cacheRate === undefined ? '—' : `${cacheRate}%`}) · out ${fmt(usage?.outputTokens)} · reasoning ${fmt(usage?.reasoningTokens)} · ctx ${fmt(usage?.contextTokens)} · value $${(usage?.totalCost ?? 0).toFixed(4)} (${usage?.costSource ?? 'unknown'})`,
  )
  if (input > 20_000 && cacheRate !== undefined && cacheRate < 30 && (timing?.turns ?? 0) > 1)
    flags.push(
      `#${row.sequence}: ${fmt(input)} input tokens with only ${cacheRate}% cached across ${timing?.turns} turns — inspect request prefixes; usage alone does not establish the cause`,
    )
  const durations = new Map((timing?.tools ?? []).map((t) => [t.toolCallId, t.durationMs]))
  const acknowledgements = tools.filter(
    (tool) => tool.name === 'acknowledge' && tool.status === 'completed' && !tool.isError,
  )
  const active = tools.some((tool) => tool.status === 'running')
  if (participantCount >= 2 && !active && acknowledgements.length !== 1) {
    flags.push(
      `#${row.sequence}: @${author} has ${acknowledgements.length} successful acknowledge calls`,
    )
  }
  if (p.isInternal && itemText.trim()) {
    flags.push(
      `#${row.sequence}: @${author} was hidden although its text items contain public prose — the next agent cannot see its reply`,
    )
  } else if (itemText.trim() && flatText !== itemText) {
    flags.push(
      `#${row.sequence}: @${author} flat content differs from its ordered text items — multi-turn prose may be lost`,
    )
  }
  for (const tool of tools) {
    const ms = tool.toolCallId ? durations.get(tool.toolCallId as string) : undefined
    const input = tool.input as Record<string, unknown> | undefined
    const target =
      typeof input?.path === 'string'
        ? input.path
        : typeof input?.command === 'string'
          ? input.command
          : typeof input?.action === 'string'
            ? `action:${input.action}`
            : ''
    const failed = tool.isError || tool.status === 'failed' || (tool.exitCode ?? 0) !== 0
    console.log(
      `    ${failed ? '✗' : '·'} ${tool.name ?? tool.type} ${clip(target, 70)} → ${tool.status ?? '?'}${tool.exitCode !== undefined ? ` exit ${tool.exitCode}` : ''}${ms !== undefined ? ` ${secs(ms)}` : ''}`,
    )
    if (failed) flags.push(`#${row.sequence}: ${tool.name} failed — ${clip(tool.resultText, 120)}`)
    if (ms !== undefined && ms > slowMs)
      flags.push(`#${row.sequence}: ${tool.name} took ${secs(ms)} (${clip(target, 60)})`)
    if (tool.name === 'read' && typeof input?.path === 'string') {
      const n = (readsSinceWrite.get(input.path) ?? 0) + 1
      readsSinceWrite.set(input.path, n)
      if (n > 1) flags.push(`#${row.sequence}: ${input.path} read ${n}× without a write in between`)
    }
    if (
      (tool.name === 'write' || tool.name === 'edit' || tool.name === 'apply_patch') &&
      typeof input?.path === 'string'
    )
      readsSinceWrite.delete(input.path)
  }
  console.log(`    reply: ${clip(itemText || flatText, 110)}`)
}

// A steered user row must precede the assistant row that consumed it.
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]!
  if (r.payload.origin !== 'user-steer') continue
  const previous = rows[i - 1]
  if (
    previous?.role === 'assistant' &&
    !previous.payload.content &&
    (previous.payload.items ?? []).length === 0
  )
    flags.push(
      `#${r.sequence}: steer row follows an EMPTY assistant row #${previous.sequence} — response-before-instruction order`,
    )
}

console.log('\nruns:')
for (const run of runs) {
  const dur = run.finished_at
    ? (Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000
    : undefined
  console.log(
    `  ${run.status}${run.error_code ? ` (${run.error_code})` : ''} ${dur !== undefined ? `${dur.toFixed(0)}s` : ''} ${run.error ? clip(run.error, 120) : ''}`,
  )
  if (run.status !== 'completed') flags.push(`run ${run.status}: ${clip(run.error, 120)}`)
}
console.log(
  `\ntotals: input ${fmt(totalInput)} (cached ${totalInput ? Math.round((totalCached / totalInput) * 100) : 0}%) · output ${fmt(totalOutput)} · value $${totalCost.toFixed(4)} (${[...costSources].sort().join(', ') || 'unknown'})`,
)
console.log(
  flags.length ? `\nflags (${flags.length}):\n  - ${flags.join('\n  - ')}` : '\nflags: none',
)
