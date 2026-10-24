import {
  NO_USAGE,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModSessionMessage,
} from '../contracts'

/**
 * `$.model`, as Claude Code answers it. `complete` and `fork` resolve to a result that says what
 * happened — the reply and its usage, or `api-error`, `empty-reply` or `aborted` (a fork also
 * `nothing-to-fork`) — and never reject for what the model did; a request Claude Code refuses
 * (no prompt, an unknown effort, a cap past 64000) throws. `classify` names which of the labels a
 * text is (undefined when the model names none).
 */

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
/** One reply's cap, as Claude Code holds it. */
const MAX_TOKENS = 64_000
/** The longest wait a timer holds. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** The joined text of a `string | ModelTextBlock[]`. */
function textOf(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === false) return undefined
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .map((block) => (block as { text?: unknown } | null)?.text)
      .map((text) => (typeof text === 'string' ? text : ''))
      .join('')
  throw new Error(`model.complete: ${field} is a string or blocks of text`)
}

/** The request as the host sends it, refused as Claude Code refuses it. */
function requestOf(input: unknown): Omit<ModelCompletionRequest, 'signal'> {
  const ask = (input ?? {}) as Record<string, unknown>
  const prompt = textOf(ask.prompt, 'prompt')
  if (prompt === undefined) throw new Error('model.complete takes a prompt')
  const system = textOf(ask.system, 'system')
  const { maxTokens, effort, timeoutMs, model } = ask
  if (
    maxTokens !== undefined &&
    !(
      Number.isInteger(maxTokens) &&
      (maxTokens as number) > 0 &&
      (maxTokens as number) <= MAX_TOKENS
    )
  )
    throw new Error(`model.complete: maxTokens is a positive whole number up to ${MAX_TOKENS}`)
  if (effort !== undefined && !EFFORTS.has(effort as string))
    throw new Error('model.complete: effort is low, medium, high, xhigh or max')
  if (
    timeoutMs !== undefined &&
    !(
      Number.isInteger(timeoutMs) &&
      (timeoutMs as number) > 0 &&
      (timeoutMs as number) <= MAX_TIMEOUT_MS
    )
  )
    throw new Error('model.complete: timeoutMs is a positive whole number of milliseconds')
  return {
    prompt,
    ...(typeof model === 'string' && model ? { model } : {}),
    ...(system !== undefined ? { system } : {}),
    ...(maxTokens !== undefined ? { maxTokens: maxTokens as number } : {}),
    ...(effort !== undefined ? { effort: effort as ModelCompletionRequest['effort'] } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs: timeoutMs as number } : {}),
  }
}

/** The caller's signal and its time limit, as one. */
function signalOf(options: unknown, timeoutMs: number | undefined): AbortSignal | undefined {
  const own = (options as { signal?: unknown } | undefined)?.signal
  const signals = [
    ...(own instanceof AbortSignal ? [own] : []),
    ...(timeoutMs !== undefined ? [AbortSignal.timeout(timeoutMs)] : []),
  ]
  return signals.length === 0 ? undefined : AbortSignal.any(signals)
}

export function createModelApi(input: {
  complete: (request: ModelCompletionRequest) => Promise<ModelCompletion>
  messages: () => Promise<readonly ModSessionMessage[]>
}) {
  /** One completion, its empty reply and its abort named as Claude Code names them. */
  async function completion(request: ModelCompletionRequest): Promise<ModelCompletion> {
    if (request.signal?.aborted) return { isAnswered: false, reason: 'aborted', usage: NO_USAGE }
    const reply = await input.complete(request)
    if (request.signal?.aborted && reply.isAnswered)
      return { isAnswered: false, reason: 'aborted', usage: reply.usage }
    return reply.isAnswered && reply.text === ''
      ? { isAnswered: false, reason: 'empty-reply', usage: reply.usage }
      : reply
  }
  return {
    async complete(request: unknown, options?: unknown): Promise<ModelCompletion> {
      const ask = requestOf(request)
      const signal = signalOf(options, ask.timeoutMs)
      return completion({ ...ask, ...(signal ? { signal } : {}) })
    },
    // A fork asks one more question after the conversation so far; with none yet, it says so.
    async fork(request: unknown) {
      const ask = (request ?? {}) as { prompt?: unknown }
      if (typeof ask.prompt !== 'string') throw new Error('model.fork takes a prompt')
      const history = (await input.messages()).map(({ role, text }) => ({ role, text }))
      if (history.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
      return completion({ prompt: ask.prompt, history })
    },
    async classify(text: unknown, labels: unknown, options?: unknown): Promise<string | undefined> {
      if (typeof text !== 'string' || !Array.isArray(labels) || labels.length === 0)
        throw new Error('model.classify takes a text and its labels')
      const names = labels.filter((label): label is string => typeof label === 'string')
      const model = (options as { model?: unknown } | undefined)?.model
      const reply = await completion({
        ...(typeof model === 'string' ? { model } : {}),
        system: 'Answer with exactly one of the labels, as written, and nothing else.',
        prompt: `Labels: ${names.join(', ')}\n\nText:\n${text}`,
        maxTokens: 64,
      })
      if (!reply.isAnswered) throw new Error(`model.classify: ${reply.reason}`)
      const said = reply.text.trim().replace(/^["'`]|["'`.]$/g, '')
      return names.find((label) => label === said) ?? names.find((label) => said.includes(label))
    },
  }
}
