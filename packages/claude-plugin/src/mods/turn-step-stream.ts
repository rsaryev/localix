import type { StreamSite } from './stream'

/**
 * `turn.step` as a stream (Claude Code's TurnStepChunk): a response's text, its tool calls (a
 * `tool` chunk, then its arguments as `input` JSON) and a closing `stop`, each block numbered from
 * 0. A result answered whole streams as those chunks; chunks a hook yields on its own make the
 * result (TurnStepResult) the turn goes on with.
 */

type Fields = Record<string, unknown>

const fields = (value: unknown): Fields =>
  value && typeof value === 'object' ? (value as Fields) : {}

function chunksOf(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return []
  const { answer, toolUses, stopReason, usage } = fields(result)
  const chunks: unknown[] = []
  let index = 0
  if (typeof answer === 'string' && answer)
    chunks.push({ kind: 'text', index: index++, text: answer })
  for (const use of Array.isArray(toolUses) ? toolUses : []) {
    const { name, input } = fields(use)
    if (typeof name !== 'string') continue
    const block = index++
    chunks.push(
      { kind: 'tool', index: block, id: `toolu_step_${block}`, name },
      { kind: 'input', index: block, json: JSON.stringify(input ?? {}) },
    )
  }
  chunks.push({ kind: 'stop', stopReason: stopReason ?? null, usage: usage ?? null })
  return chunks
}

function parsed(json: string): unknown {
  try {
    return JSON.parse(json || '{}')
  } catch {
    // Arguments that do not parse leave the call without any, as a model's broken JSON would.
    return {}
  }
}

function resultOf(input: unknown, chunks: readonly unknown[]): unknown {
  let answer = ''
  const tools = new Map<unknown, { name: string; json: string }>()
  let stop: Fields | undefined
  for (const chunk of chunks.map(fields)) {
    if (chunk.kind === 'text' && typeof chunk.text === 'string') answer += chunk.text
    else if (chunk.kind === 'tool' && typeof chunk.name === 'string')
      tools.set(chunk.index, { name: chunk.name, json: '' })
    else if (chunk.kind === 'input' && typeof chunk.json === 'string') {
      const tool = tools.get(chunk.index)
      if (tool) tool.json += chunk.json
    } else if (chunk.kind === 'stop') stop = chunk
  }
  const toolUses = [...tools.values()].map((tool) => ({
    name: tool.name,
    input: parsed(tool.json),
  }))
  const { turnId, index } = fields(input)
  return {
    turnId,
    index,
    answer,
    toolUses,
    stopReason: stop ? (stop.stopReason ?? null) : toolUses.length > 0 ? 'tool_use' : 'end_turn',
    usage: stop?.usage ?? null,
  }
}

export const TURN_STEP_STREAM: StreamSite = { chunksOf, resultOf }

/** The events that stream, by name: their hooks are async generators. */
export const STREAMING_EVENTS: ReadonlyMap<string, StreamSite> = new Map([
  ['turn.step', TURN_STEP_STREAM],
])
