import { describe, expect, test } from 'bun:test'
import { createModsEngine, type Hook } from './engine'

/** `turn.step` streams: its hooks are async generators and `next(e)` is the stream beneath. */

const STEP = { turnId: 't1', index: 0, model: 'model-a', messageCount: 2 }
const RESPONSE = {
  turnId: 't1',
  index: 0,
  answer: 'hello',
  toolUses: [{ name: 'Read', input: { file_path: 'a.md' } }],
  stopReason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 2 },
}

async function engineWith(...hooks: Hook[]) {
  const engine = createModsEngine()
  for (const [n, hook] of hooks.entries())
    await engine.load(`m${n}`, (on) => void on('turn.step', hook), {}, {})
  return engine
}

describe('a streaming event', () => {
  test('`yield* next(e)` forwards the response and evaluates to its result', async () => {
    const logged: unknown[] = []
    const engine = await engineWith(async function* (_$, e, next) {
      const result = yield* next(e) as AsyncGenerator<unknown, unknown>
      logged.push(result)
      return { ...(result as object) }
    } as Hook)
    let sent = 0
    const answer = await engine.dispatch('turn.step', STEP, () => (++sent, RESPONSE))
    expect(answer).toEqual(RESPONSE)
    expect(logged).toEqual([RESPONSE])
    expect(sent).toBe(1)
  })

  test('a hook above reads the chunks a hook beneath yields, and returning none lets next stand', async () => {
    const chunks: unknown[] = []
    const reader = async function* (_$: unknown, e: unknown, next: (e: unknown) => unknown) {
      const stream = next(e) as AsyncGenerator<unknown, unknown> & { result: Promise<unknown> }
      for await (const chunk of stream) {
        chunks.push(chunk)
        yield chunk
      }
      return { ...((await stream.result) as object), read: chunks.length }
    }
    const shouter = async function* (_$: unknown, e: unknown, next: (e: unknown) => unknown) {
      for await (const chunk of next(e) as AsyncGenerator<{ kind: string; text?: string }>)
        yield chunk.kind === 'text' ? { ...chunk, text: chunk.text!.toUpperCase() } : chunk
    }
    const engine = await engineWith(reader as Hook, shouter as Hook)
    const answer = await engine.dispatch('turn.step', STEP, () => RESPONSE)
    expect(chunks).toEqual([
      { kind: 'text', index: 0, text: 'HELLO' },
      { kind: 'tool', index: 1, id: 'toolu_step_1', name: 'Read' },
      { kind: 'input', index: 1, json: '{"file_path":"a.md"}' },
      { kind: 'stop', stopReason: 'tool_use', usage: RESPONSE.usage },
    ])
    expect(answer).toEqual({ ...RESPONSE, read: 4 })
  })

  test('a hook that yields its own chunks without next answers with the result they make', async () => {
    let sent = 0
    const engine = await engineWith(async function* () {
      yield { kind: 'text', index: 0, text: 'Off' }
      yield { kind: 'text', index: 0, text: 'line.' }
      yield { kind: 'tool', index: 1, id: 'x', name: 'Bash' }
      yield { kind: 'input', index: 1, json: '{"command":' }
      yield { kind: 'input', index: 1, json: '"ls"}' }
    } as Hook)
    expect(await engine.dispatch('turn.step', STEP, () => (++sent, RESPONSE))).toEqual({
      turnId: 't1',
      index: 0,
      answer: 'Offline.',
      toolUses: [{ name: 'Bash', input: { command: 'ls' } }],
      stopReason: 'tool_use',
      usage: null,
    })
    expect(sent).toBe(0)
  })

  test('a plain hook still awaits next(e) for the result, and each call sends again', async () => {
    let sent = 0
    const engine = await engineWith(async (_$, e, next) => {
      const first = (await next(e)) as { answer: string }
      return first.answer === 'try 1' ? next({ ...(e as object), model: 'model-b' }) : first
    })
    const models: unknown[] = []
    const answer = await engine.dispatch('turn.step', STEP, (e) => {
      models.push((e as { model: string }).model)
      return { ...RESPONSE, answer: `try ${++sent}` }
    })
    expect(answer).toMatchObject({ answer: 'try 2' })
    expect(models).toEqual(['model-a', 'model-b'])
  })

  test('a generator that fails mid-stream is left; the result beneath stands', async () => {
    const reports: string[] = []
    const engine = createModsEngine({ report: (_p, _e, reason) => reports.push(reason) })
    await engine.load(
      'm',
      (on) =>
        void on('turn.step', async function* (_$, e, next) {
          for await (const chunk of next(e) as AsyncGenerator<unknown>) {
            yield chunk
            throw new Error('mid-stream')
          }
        } as Hook),
      {},
      {},
    )
    expect(await engine.dispatch('turn.step', STEP, () => RESPONSE)).toEqual(RESPONSE)
    expect(reports).toEqual(['hook skipped: throw mid-stream'])
  })
})
