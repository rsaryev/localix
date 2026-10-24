import type { ModelCompletion, ModelCompletionRequest, ModSessionMessage } from '../contracts'

/**
 * `$.model`, as Claude Code answers it: `complete` resolves to the reply's text, `fork` asks one
 * more question after the conversation so far (`isAnswered: false` when it cannot), and
 * `classify` names which of the labels a text is (undefined when the model names none).
 */

const NO_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

export function createModelApi(input: {
  complete: (request: ModelCompletionRequest) => Promise<ModelCompletion>
  messages: () => Promise<readonly ModSessionMessage[]>
}) {
  const answered = async (request: ModelCompletionRequest) => {
    const reply = await input.complete(request)
    if (!reply.isAnswered) throw new Error(`model.complete: ${reply.reason}`)
    return reply
  }
  return {
    async complete(request: unknown): Promise<string> {
      const ask = (request ?? {}) as ModelCompletionRequest
      if (typeof ask.prompt !== 'string') throw new Error('model.complete takes a prompt')
      return (await answered(ask)).text
    },
    // Claude Code's shape since 2.1.310: never null; a mod reads `isAnswered`, and an unanswered
    // fork names why (`nothing-to-fork` with no conversation yet, `api-error` with the cause).
    async fork(request: unknown) {
      const ask = (request ?? {}) as { prompt?: unknown }
      if (typeof ask.prompt !== 'string') throw new Error('model.fork takes a prompt')
      const history = (await input.messages()).map(({ role, text }) => ({ role, text }))
      if (history.length === 0) return { isAnswered: false, reason: 'nothing-to-fork' }
      const reply = await input.complete({ prompt: ask.prompt, history })
      if (!reply.isAnswered)
        return {
          isAnswered: false,
          reason: 'api-error',
          status: null,
          error: reply.reason,
          usage: NO_USAGE,
        }
      const usage = reply.usage ?? NO_USAGE
      return reply.text === ''
        ? { isAnswered: false, reason: 'empty-reply', usage }
        : { isAnswered: true, text: reply.text, usage }
    },
    async classify(text: unknown, labels: unknown, options?: unknown): Promise<string | undefined> {
      if (typeof text !== 'string' || !Array.isArray(labels) || labels.length === 0)
        throw new Error('model.classify takes a text and its labels')
      const names = labels.filter((label): label is string => typeof label === 'string')
      const model = (options as { model?: unknown } | undefined)?.model
      const reply = await answered({
        ...(typeof model === 'string' ? { model } : {}),
        system: 'Answer with exactly one of the labels, as written, and nothing else.',
        prompt: `Labels: ${names.join(', ')}\n\nText:\n${text}`,
        maxTokens: 64,
      })
      const said = reply.text.trim().replace(/^["'`]|["'`.]$/g, '')
      return names.find((label) => label === said) ?? names.find((label) => said.includes(label))
    },
  }
}
