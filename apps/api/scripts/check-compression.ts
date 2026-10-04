/**
 * check-compression — diagnose where an agent conversation's tokens go and how much
 * Value-Budgeted Compression (VBC) reclaims before a context checkpoint has to evict, from
 * a raw OpenRouter/OpenAI messages dump (the `messages` array sent to the model).
 *
 *   bun apps/api/scripts/check-compression.ts <path-to-raw.json> [--context-window N]
 *
 * VBC no longer runs on every turn: it runs only when a checkpoint is taken, against the
 * checkpoint's low-water target, and whatever it cannot reclaim there is evicted into epoch
 * cards. So the question this answers is "how far do masking and folding get on their own?"
 * — priced at the SAME target and keep-recent parameters the checkpoint stage uses
 * (`checkpointTargetTokens`, `MODEL_TRIM_KEEP_RECENT`), so the number is real. It does not
 * plan the eviction itself; `replay-context-policy.ts` does that from a stored session.
 */
import { readFileSync } from 'node:fs'
import {
  planContextCompression,
  applyPlan,
  estimateMessagesTokens,
  estimateItemResultTokens,
  type ChatMessage,
} from '@localixai/agent'
import {
  isToolBackedItem,
  type AgentItem,
  type CommandItem,
  type FileChangeItem,
  type ToolBackedItem,
  type ToolCallItem,
} from '@localixai/agent/agents'
import {
  DEFAULT_CONTEXT_WINDOW,
  MODEL_TRIM_KEEP_RECENT,
  resolveKeepRecentTokens,
} from '../src/features/chat/runtime/agent-runner-constants'
import { resolveContextBudgetFrame } from '../src/features/chat/runtime/context-budget'
import {
  checkpointAtTokens,
  checkpointTargetTokens,
} from '../src/features/chat/runtime/model-view/checkpoint-policy'

const MUTATE = new Set(['write', 'edit', 'apply_patch', 'patch'])
const COMMAND = new Set(['bash', 'shell', 'terminal'])

/** Build a tool-backed item from a wire tool call (mirrors the live item producer). */
function buildItem(name: string, id: string, input: unknown, resultText: string): ToolBackedItem {
  const base = { id, toolCallId: id, name, input, status: 'completed' as const }
  const rec = (
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  ) as Record<string, unknown>
  if (MUTATE.has(name)) {
    const path = (rec.path ?? rec.file ?? rec.file_path) as string | undefined
    const item: FileChangeItem = {
      ...base,
      type: 'file_change',
      changes: path ? [{ path, kind: 'modify' }] : [],
      resultText,
    }
    return item
  }
  if (COMMAND.has(name)) {
    const item: CommandItem = {
      ...base,
      type: 'command',
      command: typeof rec.command === 'string' ? rec.command : '',
      output: resultText,
      resultText,
    }
    return item
  }
  const item: ToolCallItem = {
    ...base,
    type: 'tool_call',
    activeVerb: '',
    output: resultText,
    resultText,
  }
  return item
}

const itemName = (it: AgentItem): string => ('name' in it ? (it as ToolBackedItem).name : '')

// ---- args ---------------------------------------------------------------------
const args = process.argv.slice(2)
let path: string | undefined
let contextWindow: number | undefined
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--context-window') {
    contextWindow = Number(args[++i])
  } else if (arg.startsWith('--context-window=')) {
    contextWindow = Number(arg.slice('--context-window='.length))
  } else if (!arg.startsWith('--') && path === undefined) {
    path = arg
  }
}
if (!path) {
  console.error('usage: bun apps/api/scripts/check-compression.ts <raw.json> [--context-window N]')
  process.exit(1)
}
if (contextWindow !== undefined && (!Number.isFinite(contextWindow) || contextWindow <= 0)) {
  console.error('--context-window must be a positive finite number')
  process.exit(1)
}
const modelContextWindow = contextWindow ?? DEFAULT_CONTEXT_WINDOW
// The dump carries the system prompt as a message, so the frame's fixed overhead stays 0 and
// the prompt is priced where it sits.
const frame = resolveContextBudgetFrame({ contextWindow: modelContextWindow })
const checkpointAt = checkpointAtTokens(frame)
const target = checkpointTargetTokens(frame, 0)
// Exactly the checkpoint stage's keep-recent window (`history/stages/checkpoint.ts`).
const keepRecentTokens = Math.min(
  resolveKeepRecentTokens(frame.effectiveWindow),
  Math.floor(target / 2),
)

// ---- reconstruct ChatMessage[] from the wire format ---------------------------
interface WireMessage {
  role?: string
  content?: unknown
  tool_call_id?: string
  tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
  items?: unknown[]
}

const wire = JSON.parse(readFileSync(path, 'utf8')) as WireMessage[]
if (!Array.isArray(wire)) {
  console.error('Expected a JSON array of messages (the OpenRouter `messages` array).')
  process.exit(1)
}

// Two accepted inputs: the OpenRouter/OpenAI wire `messages` array, OR a dump of
// our own ChatMessage payloads (e.g. `agent_messages.payload_json` — they carry
// `items`). Detect the latter and use it directly.
const isChatDump = wire.some((m) => Array.isArray(m.items))

const resultByCallId = new Map<string, string>()
for (const m of wire) {
  if (m.role === 'tool') {
    const c = m.content
    resultByCallId.set(m.tool_call_id ?? '', typeof c === 'string' ? c : JSON.stringify(c))
  }
}

let n = 0
const messages: ChatMessage[] = []
const srcRoles: Array<'system' | 'user' | 'assistant'> = [] // original wire role, parallel to messages

if (isChatDump) {
  for (const m of wire as unknown as ChatMessage[]) {
    messages.push(m)
    srcRoles.push(m.role === 'user' ? 'user' : 'assistant')
  }
}

for (const m of isChatDump ? [] : wire) {
  if (m.role === 'tool') continue // folded into the preceding assistant's items
  const role: ChatMessage['role'] = m.role === 'user' || m.role === 'system' ? 'user' : 'assistant'
  const content = typeof m.content === 'string' ? m.content : ''
  const items: AgentItem[] = (m.tool_calls ?? []).map((tc) => {
    const fn: { name?: string; arguments?: string } = tc.function ?? {}
    let input: unknown
    try {
      input = JSON.parse(fn.arguments ?? '{}')
    } catch {
      input = { raw: fn.arguments }
    }
    const id = tc.id ?? `c${n++}`
    return buildItem(fn.name ?? '', id, input, resultByCallId.get(tc.id ?? '') ?? '')
  })
  messages.push({ id: `m${n++}`, role, content, ...(items.length ? { items } : {}) })
  srcRoles.push(m.role === 'system' ? 'system' : m.role === 'user' ? 'user' : 'assistant')
}

// ---- token breakdown by source (buckets sum to the total) ---------------------
const charsToTok = (c: number) => Math.ceil(c / 4)
let sysTok = 0
let userTok = 0
let asstTextTok = 0
let argTok = 0 // tool-call arguments (the coding-agent cost)
let resultTok = 0
const writeTargets = new Map<string, number[]>()
const readTargets = new Map<string, number[]>()

messages.forEach((m, i) => {
  const contentTok = charsToTok((m.content ?? '').length)
  if (srcRoles[i] === 'system') sysTok += contentTok
  else if (srcRoles[i] === 'user') userTok += contentTok
  else asstTextTok += contentTok
  for (const it of m.items ?? []) {
    if (!isToolBackedItem(it)) continue
    argTok += charsToTok(it.input != null ? JSON.stringify(it.input).length : 0)
    resultTok += estimateItemResultTokens(it)
    const name = itemName(it)
    const input = (it.input ?? {}) as Record<string, unknown>
    const target = (input.path ?? input.file ?? input.file_path) as string | undefined
    if (target && (name === 'write' || name === 'edit' || name === 'apply_patch')) {
      writeTargets.set(target, [...(writeTargets.get(target) ?? []), i])
    } else if (target && name === 'read') {
      readTargets.set(target, [...(readTargets.get(target) ?? []), i])
    }
  }
})

const total = estimateMessagesTokens(messages)
const pct = (x: number) => `${Math.round((100 * x) / total)}%`.padStart(4)

console.log(`\n═══ Compression check — ${path} ═══`)
console.log(`messages: ${messages.length} (from ${wire.length} wire entries)`)
console.log(`total context: ${total.toLocaleString()} tokens\n`)
console.log('token breakdown by source:')
const rows: Array<[string, number]> = [
  ['tool-call args (write/patch contents)', argTok],
  ['assistant text', asstTextTok],
  ['system prompt', sysTok],
  ['tool results', resultTok],
  ['user', userTok],
]
for (const [label, tok] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pct(tok)}  ${tok.toLocaleString().padStart(8)}  ${label}`)
}

// ---- supersession candidates --------------------------------------------------
const dupWrites = [...writeTargets].filter(([, idx]) => idx.length > 1)
const dupReads = [...readTargets].filter(([, idx]) => idx.length > 1)
if (dupWrites.length || dupReads.length) {
  console.log('\nrepeated targets (supersession candidates):')
  for (const [p, idx] of dupWrites) console.log(`  ✎ written ${idx.length}× — ${p}`)
  for (const [p, idx] of dupReads) console.log(`  ▸ read ${idx.length}× — ${p}`)
}

// ---- run VBC at the checkpoint's own target ---------------------------------------
const plan = planContextCompression(messages, {
  budget: target,
  keepRecentCount: MODEL_TRIM_KEEP_RECENT,
  keepRecentTokens,
  protectFirstTask: true,
})
const after = estimateMessagesTokens(applyPlan(messages, plan))
const saved = total - after
const savedPct = Math.round((100 * saved) / total)
const ops: Record<string, number> = {}
for (const a of plan.assignment)
  if (a.op.kind !== 'verbatim') ops[a.op.kind] = (ops[a.op.kind] ?? 0) + 1

console.log(
  `\nVBC at a checkpoint (window=${modelContextWindow.toLocaleString()}, checkpoint at ${checkpointAt.toLocaleString()}, target=${target.toLocaleString()}, keepRecent=${MODEL_TRIM_KEEP_RECENT}/${keepRecentTokens}tok):`,
)
console.log(`  before: ${total.toLocaleString()} tok`)
console.log(`  after:  ${after.toLocaleString()} tok`)
console.log(`  saved:  ${saved.toLocaleString()} tok  (${savedPct}%)`)
console.log(`  ops:    ${Object.keys(ops).length ? JSON.stringify(ops) : '(none — already lean)'}`)

// ---- verdict ------------------------------------------------------------------
const dominant = rows.sort((a, b) => b[1] - a[1])[0]
let verdict: string
if (total < checkpointAt)
  verdict = `✅ no checkpoint yet (${total.toLocaleString()} < ${checkpointAt.toLocaleString()} tok) — the view stays append-only and fully cached`
else if (after <= target)
  verdict = `✅ masking and folding ALONE reach the ${target.toLocaleString()} token target (${savedPct}% reduction) — a checkpoint here evicts nothing`
else if (total < 8000) verdict = `➖ context small (${total} tok) — little to compress yet`
else
  verdict = `⚠️  VBC stops at ${after.toLocaleString()} tok, above the ${target.toLocaleString()} target — a checkpoint evicts the rest into cards; dominant cost is "${dominant[0]}" (${pct(dominant[1])})`
console.log(`\nverdict: ${verdict}\n`)
