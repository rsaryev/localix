/**
 * Is this agent mid-turn? Read from its own transcript, not from its screen.
 *
 * THE GAP THIS FILLS. When no manifest rule matches a screen the evaluator degrades to `idle` —
 * the behaviour for a known agent — and `idle` is in `wait`'s default target set, so a busy
 * delegation settles a wait instantly. For Claude Code that is EVERY non-blocked screen: its
 * working state is read from the terminal's OSC title, and the host's snapshot carries text, cursor and
 * size but no title, so there is no positive working signal to match. `WaitOutcome.degraded` reports
 * the guess honestly; this produces an answer instead.
 *
 * The evidence is the provider's own file. Both JSONL formats append as the turn runs, and the LAST
 * record says whether the turn is over:
 *
 *   claude-code   `{type:"assistant", message:{content:[{type:"tool_use"}]}}` → a tool is running
 *                 `{type:"user", message:{content:[{type:"tool_result"}]}}`   → the model is being called back
 *                 `{type:"assistant", message:{content:[{type:"text"}]}}`     → the turn ended
 *   codex         `{type:"response_item",payload:{type:"function_call"}}`       → mid-turn
 *                 `{type:"response_item",payload:{type:"message",role:"assistant"}}` → ended
 *
 * Recency alone separates a running session sharply: the session doing the writing was written to
 * seconds ago, and the next most recent is usually minutes or hours old. What it cannot separate is
 * "still working" from "answered a moment ago", which is why the last record's SHAPE decides and
 * recency only bounds how long an answer is worth trusting.
 *
 * Deliberately NOT a manifest: a manifest matches rendered text, and this reads structure. Mixing
 * them would put a file format inside a screen grammar.
 */

/** How long a transcript's last record is taken as evidence about now. */
export const TURN_EVIDENCE_MS = 90_000

/**
 * How much of an appending transcript's end is read to decide whether a turn is running.
 *
 * The answer lives in the last few records; this holds them for every format here even when one
 * carries a large tool result, and keeps a month-old 33 MB session as cheap as a new one.
 */
export const TURN_TAIL_BYTES = 64 * 1024

export type TurnState = 'working' | 'idle'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** The `type` values of a message's content blocks, for either shape a provider writes. */
function blockTypes(record: Record<string, unknown>): string[] {
  const message = asRecord(record.message)
  const content = message?.content ?? record.content
  if (!Array.isArray(content)) return []
  return content
    .map((block) => asRecord(block)?.type)
    .filter((type): type is string => typeof type === 'string')
}

/**
 * The state the LAST usable record implies, or `undefined` when it implies nothing.
 *
 * Records are taken newest-last, the order both formats are written in. Anything unrecognised is
 * skipped rather than treated as an ending: a summary line, a sidechain marker or a format we have
 * not seen must not be read as "the turn is over", which is the one mistake that settles a wait on a
 * working agent — the very failure this exists to prevent.
 */
export function turnStateOf(records: readonly unknown[]): TurnState | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const envelope = asRecord(records[index])
    if (!envelope) continue
    // Codex wraps conversational records in `response_item`; Claude Code writes its record
    // directly. Keep accepting a direct record so this reader remains format-tolerant.
    const record =
      envelope.type === 'response_item' || envelope.type === 'event_msg'
        ? asRecord(envelope.payload)
        : envelope
    if (!record) continue
    const type = typeof record.type === 'string' ? record.type : undefined
    if (!type) continue

    /**
     * Codex SAYS when a turn is over, and it is the last thing it writes.
     *
     * A rollout's final record is usually `task_complete` or `turn_aborted`. Those arrive as
     * `event_msg`, which this reader used to skip — so it walked back past the terminator to the
     * `function_call` before it and reported a finished session as WORKING. That is the expensive
     * direction of the error: a wait on a delegation that had already answered would have run to
     * its timeout.
     */
    if (type === 'task_complete' || type === 'turn_aborted') return 'idle'

    /**
     * GitHub Copilot brackets its turns explicitly, which makes it the least ambiguous of the three
     * formats that can be read at all.
     *
     * `assistant.turn_start` and `assistant.turn_end` come in near-exact pairs, and a FINAL record
     * is one of `session.shutdown`, `assistant.turn_end`, `abort`, `subagent.failed` or
     * `session.error`. None of those names matched anything here before, so a Copilot delegation
     * got no reading at all — every one of them fell back to the manifest's degraded guess.
     *
     * `subagent.failed` is deliberately NOT an ending: a child failing leaves the parent's turn
     * running, and the record beneath it says what that turn is doing.
     */
    if (type === 'assistant.turn_end' || type === 'abort') return 'idle'
    if (type === 'session.shutdown' || type === 'session.error') return 'idle'
    if (type === 'assistant.turn_start' || type === 'user.message') return 'working'
    if (type === 'tool.execution_start' || type === 'tool.execution_complete') return 'working'

    // Codex names both standard and custom tool-call halves in the response-item payload.
    if (
      type === 'function_call' ||
      type === 'function_call_output' ||
      type === 'custom_tool_call' ||
      type === 'custom_tool_call_output'
    )
      return 'working'

    const blocks = blockTypes(record)
    if (type === 'assistant') {
      if (blocks.includes('tool_use')) return 'working'
      // Prose or reasoning with no call after it: the model handed the turn back.
      if (blocks.includes('text') || blocks.includes('thinking')) return 'idle'
      continue
    }
    if (type === 'user') {
      // A tool result is the model being called again; a person's own message is a turn beginning.
      if (blocks.includes('tool_result')) return 'working'
      return 'working'
    }
    if (type === 'message') {
      const role = asRecord(record.message)?.role ?? record.role
      if (role === 'assistant') return blocks.includes('tool_use') ? 'working' : 'idle'
      if (role === 'user') return 'working'
    }
    // `summary`, `system`, `file-history-snapshot` and anything else: not evidence either way.
  }
  return undefined
}

/**
 * The same reading, bounded by how old the file is.
 *
 * An `idle` conclusion keeps for as long as it is true — a finished turn stays finished. A `working`
 * one must not: a transcript whose last line is a tool_result and which has not moved for an hour
 * describes an agent that died mid-call, and reporting that as `working` would hang every `all` wait
 * until its timeout instead of settling.
 */
export function turnStateAt(
  records: readonly unknown[],
  mtimeMs: number,
  now: number,
): TurnState | undefined {
  const state = turnStateOf(records)
  if (state === 'working' && now - mtimeMs > TURN_EVIDENCE_MS) return undefined
  return state
}

/**
 * The reading for a format that APPENDS: take the last records and ask the rule.
 *
 * Shared by claude-code, codex and github-copilot, which differ in what their records say and not
 * in how they are stored. The bound is bytes from the end, so a 33 MB session costs what a new one
 * does.
 */
export async function tailTurnState(
  sourcePath: string,
  maxBytes: number,
  mtimeMs: number,
  now: number,
  read: (path: string, bytes: number) => AsyncIterable<Record<string, unknown>>,
): Promise<TurnState | undefined> {
  const records: unknown[] = []
  for await (const record of read(sourcePath, maxBytes)) records.push(record)
  return turnStateAt(records, mtimeMs, now)
}
