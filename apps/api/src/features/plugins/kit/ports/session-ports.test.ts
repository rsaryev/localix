import { describe, expect, test } from 'bun:test'
import { lateMcpCaller, lateModelRunner, type ModelBackend } from './session-ports'

const signal = new AbortController().signal

describe('the MCP caller, bound to the session that has the servers', () => {
  test('calls a tool by its full name with the input as arguments', async () => {
    const calls: unknown[] = []
    const mcp = lateMcpCaller(() => async (name, input) => {
      calls.push([name, input])
      return { text: 'done' }
    })
    expect(await mcp.ensureConnected('db', 1_000, signal)).toBe('connected')
    expect(await mcp.callTool({ server: 'db', tool: 'query', input: { q: 1 }, signal })).toEqual({
      isError: false,
      text: 'done',
    })
    expect(calls).toEqual([['mcp__db__query', { q: 1 }]])
  })

  test('a tool error is a result; a server that is not connected is a failure', async () => {
    const errors = lateMcpCaller(() => async () => ({ text: 'bad', isError: true }))
    expect(await errors.callTool({ server: 's', tool: 't', input: {}, signal })).toEqual({
      isError: true,
      text: 'bad',
    })
    const absent = lateMcpCaller(() => async () => ({ notConnected: true }))
    expect(await absent.callTool({ server: 's', tool: 't', input: {}, signal })).toMatchObject({
      failure: 'unavailable',
    })
  })

  test('before a session binds a caller, every server is unavailable', async () => {
    const mcp = lateMcpCaller(() => undefined)
    expect(await mcp.ensureConnected('db', 0, signal)).toBe('unavailable')
    expect(await mcp.callTool({ server: 's', tool: 't', input: {}, signal })).toMatchObject({
      failure: 'unavailable',
    })
  })
})

describe('the model runner, bound once the models are', () => {
  const backend: ModelBackend = {
    complete: async (request) => `said: ${request.prompt}`,
    runAgent: async (request) => `ran ${request.maxTurns} turns`,
  }

  test('gives the text of one prompt and of an agent run', async () => {
    const models = lateModelRunner(() => backend)
    expect(await models.evaluate({ prompt: 'hi', signal })).toEqual({ text: 'said: hi' })
    const agent = { prompt: 'x', tools: [], readOnly: true as const, maxTurns: 3, signal }
    expect(await models.runAgent(agent)).toEqual({ text: 'ran 3 turns' })
  })

  test('a model that fails, or none bound, is a failure, never a throw', async () => {
    const failing = lateModelRunner(() => ({
      complete: () => Promise.reject(new Error('overloaded')),
      runAgent: () => Promise.reject(new Error('overloaded')),
    }))
    expect(await failing.evaluate({ prompt: 'hi', signal })).toEqual({
      failure: 'model',
      message: 'overloaded',
    })
    expect(await lateModelRunner(() => undefined).evaluate({ prompt: 'hi', signal })).toMatchObject(
      {
        failure: 'unavailable',
      },
    )
  })

  test('a model that runs past the time it was given is stopped', async () => {
    const hangs = lateModelRunner(() => ({
      complete: (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('stopped'))),
        ),
      runAgent: () => Promise.resolve(''),
    }))
    expect(await hangs.evaluate({ prompt: 'hi', timeoutMs: 1, signal })).toMatchObject({
      failure: 'timeout',
    })
  })
})
