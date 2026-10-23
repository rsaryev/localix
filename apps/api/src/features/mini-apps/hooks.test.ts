import { describe, it, expect } from 'bun:test'
import { z } from 'zod'
import { defineAgentTool, type AgentTool } from '@localixai/agent/agents'

import {
  wrapToolsWithHooks,
  runSessionEndHooks,
  runUserMessageHooks,
  runAssistantMessageHooks,
  loadMemoryProviderContext,
  runMemoryProviderRunEnd,
  runSubagentStopHooks,
  runHitlRequestHooks,
  runHitlResolvedHooks,
  ToolCallBlockedError,
  POST_APPEND_CAP_BYTES,
} from './hooks'
import type { LoadedMiniAppHook } from './loader-contract'
import {
  ASSISTANT_BINDINGS_MAX,
  ASSISTANT_BINDING_DATA_CAP_BYTES,
  MEMORY_CONTEXT_CAP_CHARS,
  type MiniAppContext,
  type MiniAppHooks,
  type MemoryProvider,
} from './native'

/** Minimal hook entry — ctx is unused by the hook runner itself. */
function entry(app: string, hooks: MiniAppHooks): LoadedMiniAppHook {
  return { app, hooks, ctx: { miniAppName: app } as unknown as MiniAppContext }
}

function makeEchoTool(calls: unknown[] = []): AgentTool {
  return defineAgentTool({
    name: 'echo',
    description: 'echo the text back',
    activeVerb: 'Echoing',
    inputSchema: z.object({ text: z.string() }),
    async execute(_id, input) {
      calls.push(input)
      return { content: `echo: ${input.text}` }
    },
  }) as AgentTool
}

function warnCollector() {
  const warnings: string[] = []
  return { warnings, logger: { warn: (msg: string) => warnings.push(msg) } }
}

const OPTS = { sessionId: 's1' }

describe('wrapToolsWithHooks', () => {
  it('zero hooks fast path: no tool-call hooks → tools behave identically', async () => {
    const calls: unknown[] = []
    const tools = [makeEchoTool(calls)]
    // onSessionStart/onSessionEnd only — not tool-call hooks, so no wrapping occurs.
    const wrapped = wrapToolsWithHooks(tools, [entry('p', { onSessionEnd: () => {} })], OPTS)
    // Referencing the unbound `execute` is the ASSERTION here: the fast path must hand back
    // the very same function, not a re-bound wrapper. `AgentTool.execute` is intentionally a
    // method (its bivariance is load-bearing for the tool registry), so this cannot be fixed
    // at the declaration, and there is no `this` to mis-scope.
    // oxlint-disable-next-line typescript/unbound-method
    expect(wrapped[0].execute).toBe(tools[0].execute)
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('echo: hi')
    expect(calls).toEqual([{ text: 'hi' }])
  })

  it('pre hook block throws ToolCallBlockedError and the tool never runs', async () => {
    const calls: unknown[] = []
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool(calls)],
      [entry('guard', { onPreToolCall: () => ({ block: 'not allowed' }) })],
      OPTS,
    )
    let thrown: unknown
    try {
      await wrapped[0].execute('tc1', { text: 'hi' })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(ToolCallBlockedError)
    expect((thrown as Error).message).toContain('guard')
    expect((thrown as Error).message).toContain('not allowed')
    expect(calls).toEqual([])
  })

  it('pre hook input rewrite is re-parsed against the schema and applied', async () => {
    const calls: unknown[] = []
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool(calls)],
      [entry('rewriter', { onPreToolCall: () => ({ input: { text: 'rewritten' } }) })],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', { text: 'original' })
    expect(result.content).toBe('echo: rewritten')
    expect(calls).toEqual([{ text: 'rewritten' }])
  })

  it('invalid rewrite (schema re-parse fails) is ignored with a warning', async () => {
    const calls: unknown[] = []
    const { warnings, logger } = warnCollector()
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool(calls)],
      // text: number — fails the zod schema, so the rewrite must be dropped.
      [entry('bad-rewriter', { onPreToolCall: () => ({ input: { text: 42 } }) })],
      { ...OPTS, logger },
    )
    const result = await wrapped[0].execute('tc1', { text: 'original' })
    expect(result.content).toBe('echo: original')
    expect(calls).toEqual([{ text: 'original' }])
    expect(
      warnings.some((w) => w.includes('bad-rewriter') && w.includes('schema re-parse failed')),
    ).toBe(true)
  })

  it('post hook appendContent is appended with mini app attribution', async () => {
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [entry('annotator', { onPostToolCall: () => ({ appendContent: 'note from the mini app' }) })],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('echo: hi\n\n[mini-app:annotator] note from the mini app')
  })

  it('post hook appendContent is capped at 1KB', async () => {
    const huge = 'x'.repeat(POST_APPEND_CAP_BYTES * 4)
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [entry('verbose', { onPostToolCall: () => ({ appendContent: huge }) })],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    const appended = result.content.split('[mini-app:verbose] ')[1]
    expect(appended.length).toBe(POST_APPEND_CAP_BYTES)
  })

  it('throwing hooks are isolated: execution proceeds, failure is logged', async () => {
    const { warnings, logger } = warnCollector()
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [
        entry('boom', {
          onPreToolCall: () => {
            throw new Error('pre exploded')
          },
          onPostToolCall: () => {
            throw new Error('post exploded')
          },
        }),
      ],
      { ...OPTS, logger },
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('echo: hi')
    expect(warnings.some((w) => w.includes('pre exploded'))).toBe(true)
    expect(warnings.some((w) => w.includes('post exploded'))).toBe(true)
  })

  it('slow hooks time out and are treated as observe-only', async () => {
    const { warnings, logger } = warnCollector()
    // Never settles — so it resolves to `never`, which satisfies BOTH the pre- and
    // post-hook result types. (It used to claim `{ block: string }`, a pre-hook-only
    // shape that a post-hook can never return.)
    const never = () => new Promise<never>(() => {})
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [entry('slow', { onPreToolCall: never, onPostToolCall: never })],
      { ...OPTS, logger, timeoutMs: 20 },
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('echo: hi')
    expect(warnings.filter((w) => w.includes('timed out')).length).toBe(2)
  })

  it('first block wins across mini apps; rewrites compose in mini app order', async () => {
    const calls: unknown[] = []
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool(calls)],
      [
        entry('a', {
          onPreToolCall: (e) => ({ input: { text: `${(e.input as { text: string }).text}-a` } }),
        }),
        entry('b', {
          onPreToolCall: (e) => ({ input: { text: `${(e.input as { text: string }).text}-b` } }),
        }),
      ],
      OPTS,
    )
    await wrapped[0].execute('tc1', { text: 'x' })
    expect(calls).toEqual([{ text: 'x-a-b' }])
  })

  it('a THROWING tool still runs the post hooks, against the converted error result', async () => {
    const seen: { isError?: boolean; content: string }[] = []
    const throwing = defineAgentTool({
      name: 'boom',
      description: 'always fails',
      activeVerb: 'Booming',
      inputSchema: z.object({}),
      execute() {
        return Promise.reject(new Error('disk on fire'))
      },
    }) as AgentTool
    const wrapped = wrapToolsWithHooks(
      [throwing],
      [
        entry('watcher', {
          onPostToolCall: (e) => {
            const r = e.result as { isError?: boolean; content: string }
            seen.push({ isError: r.isError, content: r.content })
            return { appendContent: 'observed' }
          },
        }),
      ],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', {})
    expect(seen).toEqual([{ isError: true, content: 'disk on fire' }])
    // Converted, not rethrown — and the hook's annotation rides on the error result.
    expect(result.isError).toBe(true)
    expect(result.error?.kind).toBe('execution')
    expect(result.content).toContain('disk on fire')
    expect(result.content).toContain('[mini-app:watcher] observed')
  })

  it('a pre-hook BLOCK still throws, so the failure guard can stamp kind:blocked', async () => {
    const posts: string[] = []
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [
        entry('guard', { onPreToolCall: () => ({ block: 'nope' }) }),
        entry('watcher', {
          onPostToolCall: () => {
            posts.push('ran')
          },
        }),
      ],
      OPTS,
    )
    await expect(wrapped[0].execute('tc1', { text: 'hi' })).rejects.toBeInstanceOf(
      ToolCallBlockedError,
    )
    expect(posts).toEqual([])
  })
})

describe('runSessionEndHooks', () => {
  it('fires every onSessionEnd hook with the session id', async () => {
    const seen: string[] = []
    await runSessionEndHooks(
      [
        entry('a', {
          onSessionEnd: (e) => {
            seen.push(`a:${e.sessionId}`)
          },
        }),
        entry('b', {
          onSessionEnd: (e) => {
            seen.push(`b:${e.sessionId}`)
          },
        }),
        entry('none', {}),
      ],
      OPTS,
    )
    expect(seen.sort()).toEqual(['a:s1', 'b:s1'])
  })

  it('a throwing onSessionEnd never propagates', async () => {
    const { warnings, logger } = warnCollector()
    await runSessionEndHooks(
      [
        entry('boom', {
          onSessionEnd: () => {
            throw new Error('end exploded')
          },
        }),
      ],
      { ...OPTS, logger },
    )
    expect(warnings.some((w) => w.includes('end exploded'))).toBe(true)
  })
})

describe('runUserMessageHooks', () => {
  const MSG = { messageId: 'm1', text: 'original prompt' }

  it('returns the text unchanged when no mini app declares the hook', async () => {
    const out = await runUserMessageHooks([entry('p', { onSessionEnd: () => {} })], MSG, OPTS)
    expect(out).toBe('original prompt')
  })

  it('rewrites compose in mini app order, each seeing the previous rewrite', async () => {
    const seen: string[] = []
    const out = await runUserMessageHooks(
      [
        entry('a', {
          onUserMessage: (e) => {
            seen.push(e.text)
            return { text: `${e.text} +a` }
          },
        }),
        entry('b', {
          onUserMessage: (e) => {
            seen.push(e.text)
            return { text: `${e.text} +b` }
          },
        }),
        entry('observer', {
          onUserMessage: (e) => {
            seen.push(e.text)
          },
        }),
      ],
      MSG,
      OPTS,
    )
    expect(out).toBe('original prompt +a +b')
    expect(seen).toEqual(['original prompt', 'original prompt +a', 'original prompt +a +b'])
  })

  it('rejects empty/non-string rewrites (logged) and keeps the prior text', async () => {
    const { warnings, logger } = warnCollector()
    const out = await runUserMessageHooks(
      [
        entry('empty', { onUserMessage: () => ({ text: '   ' }) }),
        entry('wrongtype', { onUserMessage: () => ({ text: 42 as unknown as string }) }),
      ],
      MSG,
      { ...OPTS, logger },
    )
    expect(out).toBe('original prompt')
    expect(warnings.length).toBe(2)
  })

  it('a throwing hook is isolated and later hooks still run', async () => {
    const { warnings, logger } = warnCollector()
    const out = await runUserMessageHooks(
      [
        entry('boom', {
          onUserMessage: () => {
            throw new Error('user hook exploded')
          },
        }),
        entry('ok', { onUserMessage: (e) => ({ text: `${e.text}!` }) }),
      ],
      MSG,
      { ...OPTS, logger },
    )
    expect(out).toBe('original prompt!')
    expect(warnings.some((w) => w.includes('user hook exploded'))).toBe(true)
  })
})

describe('runAssistantMessageHooks', () => {
  const MSG = { messageId: 'a1', content: 'final reply with /tmp/x.png' }
  const att = (name: string, dataLen = 8) => ({
    kind: 'image' as const,
    mediaType: 'image/png',
    data: 'x'.repeat(dataLen),
    name,
    size: dataLen,
  })

  it('returns {} when no mini app declares the hook', async () => {
    const out = await runAssistantMessageHooks([entry('p', {})], MSG, OPTS)
    expect(out).toEqual({})
  })

  it('collects validated bindings and composes content rewrites', async () => {
    const out = await runAssistantMessageHooks(
      [
        entry('deliver', { onAssistantMessage: () => ({ bindings: [att('x.png')] }) }),
        entry('strip', {
          onAssistantMessage: (e) => ({ content: e.content.replace(' with /tmp/x.png', '') }),
        }),
      ],
      MSG,
      OPTS,
    )
    expect(out.content).toBe('final reply')
    expect(out.bindings?.map((binding) => ('name' in binding ? binding.name : ''))).toEqual([
      'x.png',
    ])
  })

  it('later hooks see earlier content rewrites', async () => {
    const seen: string[] = []
    await runAssistantMessageHooks(
      [
        entry('first', {
          onAssistantMessage: (e) => {
            seen.push(e.content)
            return { content: 'rewritten' }
          },
        }),
        entry('second', {
          onAssistantMessage: (e) => {
            seen.push(e.content)
          },
        }),
      ],
      MSG,
      OPTS,
    )
    expect(seen).toEqual([MSG.content, 'rewritten'])
  })

  it('drops malformed and oversized bindings with a warning', async () => {
    const { warnings, logger } = warnCollector()
    const out = await runAssistantMessageHooks(
      [
        entry('bad', {
          onAssistantMessage: () => ({
            bindings: [
              { kind: 'image', name: 'no-data.png' } as never,
              att('too-big.png', ASSISTANT_BINDING_DATA_CAP_BYTES + 1),
              att('ok.png'),
            ],
          }),
        }),
      ],
      MSG,
      { ...OPTS, logger },
    )
    expect(out.bindings?.map((binding) => ('name' in binding ? binding.name : ''))).toEqual([
      'ok.png',
    ])
    expect(warnings.length).toBe(2)
  })

  it('caps total bindings across mini apps', async () => {
    const { warnings, logger } = warnCollector()
    const many = Array.from({ length: ASSISTANT_BINDINGS_MAX + 3 }, (_, i) => att(`f${i}.png`))
    const out = await runAssistantMessageHooks(
      [entry('flood', { onAssistantMessage: () => ({ bindings: many }) })],
      MSG,
      { ...OPTS, logger },
    )
    expect(out.bindings?.length).toBe(ASSISTANT_BINDINGS_MAX)
    expect(warnings.some((w) => w.includes('cap'))).toBe(true)
  })

  it('rejects empty content rewrites and keeps bindings flowing', async () => {
    const { warnings, logger } = warnCollector()
    const out = await runAssistantMessageHooks(
      [
        entry('empty', {
          onAssistantMessage: () => ({ content: '', bindings: [att('a.png')] }),
        }),
      ],
      MSG,
      { ...OPTS, logger },
    )
    expect(out.content).toBeUndefined()
    expect(out.bindings?.length).toBe(1)
    expect(warnings.length).toBe(1)
  })
})

describe('memory provider invocation', () => {
  const mem = (provider: Partial<MemoryProvider>, app = 'mem') => ({
    app,
    provider: provider as MemoryProvider,
    ctx: { miniAppName: app } as unknown as MiniAppContext,
  })
  const EVENT = {
    sessionId: 's1',
    projectId: null,
    prompt: 'question',
    builtinContext: 'builtin notes',
  }

  it('returns the builtin context when there is no provider', async () => {
    expect(await loadMemoryProviderContext(null, EVENT, {})).toBe('builtin notes')
  })

  it('replace mode (default) swaps the builtin notes out', async () => {
    const out = await loadMemoryProviderContext(
      mem({ loadContext: () => ({ context: 'provider context' }) }),
      EVENT,
      {},
    )
    expect(out).toBe('provider context')
  })

  it('append mode adds below the builtin notes', async () => {
    const out = await loadMemoryProviderContext(
      mem({ loadContext: () => ({ context: 'extra', mode: 'append' as const }) }),
      EVENT,
      {},
    )
    expect(out).toBe('builtin notes\n\nextra')
  })

  it('empty/void results and failures fall back to the builtin context', async () => {
    const { warnings, logger } = warnCollector()
    expect(
      await loadMemoryProviderContext(mem({ loadContext: () => undefined }), EVENT, { logger }),
    ).toBe('builtin notes')
    expect(
      await loadMemoryProviderContext(mem({ loadContext: () => ({ context: '  ' }) }), EVENT, {
        logger,
      }),
    ).toBe('builtin notes')
    expect(
      await loadMemoryProviderContext(
        mem({
          loadContext: () => {
            throw new Error('backend down')
          },
        }),
        EVENT,
        { logger },
      ),
    ).toBe('builtin notes')
    expect(warnings.some((w) => w.includes('backend down'))).toBe(true)
  })

  it('caps the provider context length', async () => {
    const out = await loadMemoryProviderContext(
      mem({ loadContext: () => ({ context: 'x'.repeat(MEMORY_CONTEXT_CAP_CHARS + 500) }) }),
      EVENT,
      {},
    )
    expect(out.length).toBe(MEMORY_CONTEXT_CAP_CHARS)
  })

  it('a hanging loadContext times out to the builtin context', async () => {
    const out = await loadMemoryProviderContext(
      mem({ loadContext: () => new Promise(() => {}) }),
      EVENT,
      { timeoutMs: 20 },
    )
    expect(out).toBe('builtin notes')
  })

  it('runMemoryProviderRunEnd fires the extraction pass and isolates throws', async () => {
    const seen: string[] = []
    const { warnings, logger } = warnCollector()
    runMemoryProviderRunEnd(
      mem({
        loadContext: () => {},
        onRunEnd: (e) => {
          seen.push(e.assistantText)
        },
      }),
      { sessionId: 's1', projectId: null, userText: 'q', assistantText: 'final' },
      {},
    )
    runMemoryProviderRunEnd(
      mem({
        loadContext: () => {},
        onRunEnd: () => {
          throw new Error('extract failed')
        },
      }),
      { sessionId: 's1', projectId: null, userText: 'q', assistantText: 'final' },
      { logger },
    )
    // Poll for the fire-and-forget onRunEnd callbacks rather than a fixed 10ms
    // sleep — that flakes under CPU load when the async callback is slow.
    for (let i = 0; i < 200 && (seen.length < 1 || warnings.length < 1); i++) {
      await new Promise((r) => setTimeout(r, 15))
    }
    expect(seen).toEqual(['final'])
    expect(warnings.some((w) => w.includes('extract failed'))).toBe(true)
  })
})

describe('onPostToolCall replaceContent', () => {
  it('replaces the model-facing result; later mini apps see the replacement', async () => {
    const seen: string[] = []
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [
        entry('redactor', { onPostToolCall: () => ({ replaceContent: '[REDACTED]' }) }),
        entry('observer', {
          onPostToolCall: (e) => {
            seen.push(e.result.content)
            return undefined
          },
        }),
      ],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', { text: 'secret' })
    expect(result.content).toBe('[REDACTED]')
    expect(seen).toEqual(['[REDACTED]'])
  })

  it('replaceContent must be a non-empty string; otherwise ignored with a warning', async () => {
    const { warnings, logger } = warnCollector()
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [entry('bad', { onPostToolCall: () => ({ replaceContent: '' }) })],
      { ...OPTS, logger },
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('echo: hi')
    expect(warnings.some((w) => w.includes('replaceContent'))).toBe(true)
  })

  it('replaceContent composes with appendContent from another mini app', async () => {
    const wrapped = wrapToolsWithHooks(
      [makeEchoTool()],
      [
        entry('replacer', { onPostToolCall: () => ({ replaceContent: 'clean' }) }),
        entry('annotator', { onPostToolCall: () => ({ appendContent: 'note' }) }),
      ],
      OPTS,
    )
    const result = await wrapped[0].execute('tc1', { text: 'hi' })
    expect(result.content).toBe('clean\n\n[mini-app:annotator] note')
  })
})

describe('lifecycle event hooks', () => {
  it('runSubagentStopHooks fires every declaring mini app and isolates throwers', async () => {
    const got: unknown[] = []
    const { warnings, logger } = warnCollector()
    await runSubagentStopHooks(
      [
        entry('a', {
          onSubagentStop: (e) => {
            got.push(e)
          },
        }),
        entry('boom', {
          onSubagentStop: () => {
            throw new Error('x')
          },
        }),
        entry('none', {}),
      ],
      {
        sessionId: 's1',
        childSessionId: 'c1',
        status: 'completed',
        durationMs: 1234,
        summary: 'done',
      },
      { sessionId: 's1', logger },
    )
    expect(got).toEqual([
      {
        sessionId: 's1',
        childSessionId: 'c1',
        status: 'completed',
        durationMs: 1234,
        summary: 'done',
      },
    ])
    expect(warnings.length).toBe(1)
  })

  it('runHitlRequestHooks / runHitlResolvedHooks deliver the event to declaring mini apps', async () => {
    const reqs: unknown[] = []
    const ress: unknown[] = []
    const entries = [
      entry('w', {
        onHitlRequest: (e) => {
          reqs.push(e)
        },
        onHitlResolved: (e) => {
          ress.push(e)
        },
      }),
    ]
    await runHitlRequestHooks(
      entries,
      {
        sessionId: 's1',
        requestId: 'r1',
        kind: 'confirm',
        toolName: 'bash',
        title: 'Approve bash?',
        payload: { command: 'ls' },
      },
      OPTS,
    )
    await runHitlResolvedHooks(
      entries,
      {
        sessionId: 's1',
        requestId: 'r1',
        kind: 'confirm',
        toolName: 'bash',
        response: { confirmed: true },
      },
      OPTS,
    )
    expect(reqs.length).toBe(1)
    expect(ress).toEqual([
      {
        sessionId: 's1',
        requestId: 'r1',
        kind: 'confirm',
        toolName: 'bash',
        response: { confirmed: true },
      },
    ])
  })
})
