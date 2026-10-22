import { describe, it, expect, afterEach } from 'bun:test'

import { parseHooksBlock } from './config'
import { createCcHooksRuntime } from './run'
import { interpolateEnv } from './http'
import type { CcHookRegistry } from './contracts'
import type { SkippedHandler } from './config'
import type { AgentHookEvaluator } from './agent-hook'
import type { CcMcpToolCaller } from './mcp-tool-hook'

const silentLogger = { warn: () => {}, info: () => {} }

function runtimeWith(
  registry: CcHookRegistry,
  extra?: {
    callMcpTool?: CcMcpToolCaller
    runAgentHook?: AgentHookEvaluator
  },
) {
  return createCcHooksRuntime({
    registry,
    sessionId: 's1',
    projectDir: '/p',
    enabled: true,
    logger: silentLogger,
    ...extra,
  })
}

const block = (event: string, handler: Record<string, unknown>): CcHookRegistry =>
  parseHooksBlock({ [event]: [{ hooks: [handler] }] }, 'project', { projectDir: '/p' })

// ===========================================================================
// Config parsing + event×type support matrix
// ===========================================================================
describe('handler-type config parsing + support matrix', () => {
  it('http: parsed on PreToolUse, headers + allowedEnvVars retained, default timeout 600 s', () => {
    const reg = block('PreToolUse', {
      type: 'http',
      url: 'https://hook.example/verify',
      headers: { 'X-Token': '${API_TOKEN}' },
      allowedEnvVars: ['API_TOKEN'],
    })
    const h = reg.PreToolUse![0].handlers[0]
    expect(h.kind).toBe('http')
    expect(h.httpUrl).toBe('https://hook.example/verify')
    expect(h.httpHeaders).toEqual({ 'X-Token': '${API_TOKEN}' })
    expect(h.httpAllowedEnvVars).toEqual(['API_TOKEN'])
    expect(h.timeoutMs).toBe(600_000)
  })

  it('http: DROPPED on SessionStart (unsupported), recorded as skipped', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      { SessionStart: [{ hooks: [{ type: 'http', url: 'https://x' }] }] },
      'user',
      { projectDir: '/p' },
      skipped,
    )
    expect(reg.SessionStart).toBeUndefined()
    expect(skipped).toContainEqual({ source: 'user', event: 'SessionStart', type: 'http' })
  })

  it('mcp_tool: combines server + tool into the CC full name; supported on SessionStart', () => {
    const reg = block('SessionStart', { type: 'mcp_tool', server: 'mem', tool: 'check' })
    const h = reg.SessionStart![0].handlers[0]
    expect(h.kind).toBe('mcp_tool')
    expect(h.mcpTool).toBe('mcp__mem__check')
  })

  it('mcp_tool: a single full tool name passes through unchanged', () => {
    const reg = block('PostToolUse', { type: 'mcp_tool', tool: 'mcp_mem_check' })
    expect(reg.PostToolUse![0].handlers[0].mcpTool).toBe('mcp_mem_check')
  })

  it('agent: parsed on Stop with default timeout 60 s + maxTurns', () => {
    const reg = block('Stop', { type: 'agent', prompt: 'verify', model: 'haiku', maxTurns: 8 })
    const h = reg.Stop![0].handlers[0]
    expect(h.kind).toBe('agent')
    expect(h.prompt).toBe('verify')
    expect(h.promptModel).toBe('haiku')
    expect(h.agentMaxTurns).toBe(8)
    expect(h.timeoutMs).toBe(60_000)
  })

  it('agent: DROPPED on SessionEnd (unsupported), recorded as skipped', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      { SessionEnd: [{ hooks: [{ type: 'agent', prompt: 'p' }] }] },
      'project',
      { projectDir: '/p' },
      skipped,
    )
    expect(reg.SessionEnd).toBeUndefined()
    expect(skipped).toContainEqual({ source: 'project', event: 'SessionEnd', type: 'agent' })
  })

  it('http/mcp_tool ARE supported on SessionEnd (command+http+mcp_tool event)', () => {
    const skipped: SkippedHandler[] = []
    const reg = parseHooksBlock(
      {
        SessionEnd: [
          {
            hooks: [
              { type: 'http', url: 'https://x' },
              { type: 'mcp_tool', tool: 'mcp_a_b' },
            ],
          },
        ],
      },
      'user',
      { projectDir: '/p' },
      skipped,
    )
    expect(skipped).toHaveLength(0)
    expect(reg.SessionEnd?.[0].handlers.map((h) => h.kind)).toEqual(['http', 'mcp_tool'])
  })
})

// ===========================================================================
// interpolateEnv — allowedEnvVars gating
// ===========================================================================
describe('interpolateEnv (http header/url env interpolation)', () => {
  afterEach(() => {
    delete process.env.CC_HOOK_TEST_ALLOWED
    delete process.env.CC_HOOK_TEST_DENIED
  })

  it('expands ONLY allowlisted vars; unlisted refs become empty', () => {
    process.env.CC_HOOK_TEST_ALLOWED = 'secret-value'
    process.env.CC_HOOK_TEST_DENIED = 'should-not-leak'
    const out = interpolateEnv('a=${CC_HOOK_TEST_ALLOWED} b=$CC_HOOK_TEST_DENIED', [
      'CC_HOOK_TEST_ALLOWED',
    ])
    expect(out).toBe('a=secret-value b=')
  })

  it('undefined allowlist expands nothing', () => {
    process.env.CC_HOOK_TEST_ALLOWED = 'x'
    expect(interpolateEnv('${CC_HOOK_TEST_ALLOWED}', undefined)).toBe('')
  })
})

// ===========================================================================
// HTTP hooks — live local server
// ===========================================================================
describe('http hooks fire through the runtime (live server)', () => {
  let server: ReturnType<typeof Bun.serve> | null = null
  afterEach(async () => {
    await server?.stop(true)
    server = null
  })

  const serve = (handler: (req: Request) => Response | Promise<Response>) => {
    server = Bun.serve({ port: 0, fetch: handler })
    return `http://localhost:${server.port}`
  }

  it('2xx decision JSON denies a PreToolUse call', async () => {
    const url = serve(() =>
      Response.json({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked by endpoint',
        },
      }),
    )
    const rt = runtimeWith(block('PreToolUse', { type: 'http', url }))
    const res = await rt.runPreToolUse('bash', { command: 'rm -rf /' })
    expect(res.decision).toBe('deny')
    expect(res.reason).toBe('blocked by endpoint')
  })

  it('receives the POSTed hook input JSON and interpolated allowlisted header', async () => {
    process.env.CC_HOOK_HDR = 'tok-123'
    let seenBody: unknown = null
    // Recorder array, not a nullable `let`: a variable only assigned inside a callback
    // stays narrowed to `null` for the compiler. This also pins the call COUNT.
    const seenHeaders: (string | null)[] = []
    const url = serve(async (req) => {
      seenBody = await req.json()
      seenHeaders.push(req.headers.get('X-Token'))
      return new Response('', { status: 200 })
    })
    const rt = runtimeWith(
      block('PreToolUse', {
        type: 'http',
        url,
        headers: { 'X-Token': 'Bearer ${CC_HOOK_HDR}' },
        allowedEnvVars: ['CC_HOOK_HDR'],
      }),
    )
    await rt.runPreToolUse('bash', { command: 'ls' })
    expect((seenBody as { tool_name?: string }).tool_name).toBe('Bash')
    expect(seenHeaders).toEqual(['Bearer tok-123'])
    delete process.env.CC_HOOK_HDR
  })

  it('non-2xx is non-blocking (fail-open → proceed)', async () => {
    const url = serve(() => new Response('nope', { status: 500 }))
    const rt = runtimeWith(block('PreToolUse', { type: 'http', url }))
    const res = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(res.decision).toBe('proceed')
  })

  it('a slow endpoint past the timeout fails open (proceed)', async () => {
    const url = serve(async () => {
      await new Promise((r) => setTimeout(r, 200))
      return Response.json({ hookSpecificOutput: { permissionDecision: 'deny' } })
    })
    // 20 ms timeout → aborts before the 200 ms response.
    const reg = parseHooksBlock(
      { PreToolUse: [{ hooks: [{ type: 'http', url, timeout: 0.02 }] }] },
      'project',
      { projectDir: '/p' },
    )
    const rt = runtimeWith(reg)
    const res = await rt.runPreToolUse('bash', { command: 'ls' })
    expect(res.decision).toBe('proceed')
  })
})

// ===========================================================================
// mcp_tool hooks — stubbed injected caller
// ===========================================================================
describe('mcp_tool hooks fire through the runtime (stubbed caller)', () => {
  it('server+tool config → caller invoked with the CC full name; decision honored', async () => {
    const seenNames: string[] = []
    const caller: CcMcpToolCaller = async (name) => {
      seenNames.push(name)
      return {
        text: JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: 'mcp says no',
          },
        }),
      }
    }
    const rt = runtimeWith(
      block('PreToolUse', { type: 'mcp_tool', server: 'guard', tool: 'check' }),
      {
        callMcpTool: caller,
      },
    )
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(seenNames).toEqual(['mcp__guard__check'])
    expect(res.decision).toBe('deny')
    expect(res.reason).toBe('mcp says no')
  })

  it('full Localix-form tool name passes through to the caller', async () => {
    const seenNames: string[] = []
    const caller: CcMcpToolCaller = async (name) => {
      seenNames.push(name)
      return { text: '' }
    }
    const rt = runtimeWith(block('PreToolUse', { type: 'mcp_tool', tool: 'mcp_guard_check' }), {
      callMcpTool: caller,
    })
    await rt.runPreToolUse('bash', { command: 'x' })
    expect(seenNames).toEqual(['mcp_guard_check'])
  })

  it('receives the hook input JSON as tool arguments', async () => {
    let seenInput: unknown = null
    const caller: CcMcpToolCaller = async (_name, input) => {
      seenInput = input
      return { text: '' }
    }
    const rt = runtimeWith(block('PreToolUse', { type: 'mcp_tool', tool: 'mcp_g_c' }), {
      callMcpTool: caller,
    })
    await rt.runPreToolUse('write', { file_path: '/a.ts' })
    expect((seenInput as { tool_name?: string }).tool_name).toBe('Write')
  })

  it('notConnected fails open (proceed)', async () => {
    const caller: CcMcpToolCaller = async () => ({ notConnected: true })
    const rt = runtimeWith(block('PreToolUse', { type: 'mcp_tool', tool: 'mcp_g_c' }), {
      callMcpTool: caller,
    })
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })

  it('isError result fails open (proceed)', async () => {
    const caller: CcMcpToolCaller = async () => ({ text: '{"decision":"block"}', isError: true })
    const rt = runtimeWith(block('PreToolUse', { type: 'mcp_tool', tool: 'mcp_g_c' }), {
      callMcpTool: caller,
    })
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })

  it('fails open when NO caller is injected', async () => {
    const rt = runtimeWith(block('PreToolUse', { type: 'mcp_tool', tool: 'mcp_g_c' }))
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })
})

// ===========================================================================
// agent hooks — stubbed injected evaluator (verdict mapping per event)
// ===========================================================================
describe('agent hooks fire through the runtime (stubbed evaluator)', () => {
  it('PreToolUse ok:false denies the call', async () => {
    const stub: AgentHookEvaluator = async () => ({ ok: false, reason: 'verifier blocked' })
    const rt = runtimeWith(block('PreToolUse', { type: 'agent', prompt: 'verify' }), {
      runAgentHook: stub,
    })
    const res = await rt.runPreToolUse('bash', { command: 'rm -rf /' })
    expect(res.decision).toBe('deny')
    expect(res.reason).toBe('verifier blocked')
  })

  it('Stop ok:false requests continuation (blocked)', async () => {
    const stub: AgentHookEvaluator = async () => ({ ok: false, reason: 'not done' })
    const rt = runtimeWith(block('Stop', { type: 'agent', prompt: 'verify' }), {
      runAgentHook: stub,
    })
    const res = await rt.runStop()
    expect(res.blocked).toBe(true)
    expect(res.reason).toBe('not done')
  })

  it('UserPromptSubmit ok:false blocks the prompt', async () => {
    const stub: AgentHookEvaluator = async () => ({ ok: false, reason: 'off-limits' })
    const rt = runtimeWith(block('UserPromptSubmit', { type: 'agent', prompt: 'verify' }), {
      runAgentHook: stub,
    })
    const res = await rt.runUserPromptSubmit('hi')
    expect(res.blocked).toBe(true)
    expect(res.reason).toBe('off-limits')
  })

  it('threads maxTurns + timeout + input JSON into the evaluator', async () => {
    let seen: { timeoutMs: number; maxTurns?: number; inputJson: string } | null = null
    const stub: AgentHookEvaluator = async (opts) => {
      seen = { timeoutMs: opts.timeoutMs, maxTurns: opts.maxTurns, inputJson: opts.inputJson }
      return { ok: true }
    }
    const reg = parseHooksBlock(
      { PreToolUse: [{ hooks: [{ type: 'agent', prompt: 'verify', maxTurns: 12, timeout: 45 }] }] },
      'project',
      { projectDir: '/p' },
    )
    const rt = runtimeWith(reg, { runAgentHook: stub })
    await rt.runPreToolUse('bash', { command: 'echo hi' })
    expect(seen!.timeoutMs).toBe(45_000)
    expect(seen!.maxTurns).toBe(12)
    expect(JSON.parse(seen!.inputJson).tool_name).toBe('Bash')
  })

  it('fails open when NO evaluator is injected', async () => {
    const rt = runtimeWith(block('PreToolUse', { type: 'agent', prompt: 'verify' }))
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })

  it('fails open when the evaluator throws', async () => {
    const stub: AgentHookEvaluator = async () => {
      throw new Error('subagent crashed')
    }
    const rt = runtimeWith(block('PreToolUse', { type: 'agent', prompt: 'verify' }), {
      runAgentHook: stub,
    })
    const res = await rt.runPreToolUse('bash', { command: 'x' })
    expect(res.decision).toBe('proceed')
  })
})
